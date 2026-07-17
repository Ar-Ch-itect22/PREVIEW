import { createHash } from 'node:crypto';

import { DefinitelyNotAppliedError } from '@preview/adapter-sdk';

import {
  crmRecordSchema,
  moveFollowUpPayloadSchema,
  type CrmRecord,
} from './schemas.js';

export interface CrmReadPort {
  readRecord(recordId: string): Promise<CrmRecord | undefined>;
}

export interface CrmProviderCommitResult {
  readonly applied: boolean;
  readonly record: CrmRecord;
}

export interface CrmCommitPort extends CrmReadPort {
  commitFollowUp(
    payload: { readonly followUpAt: string; readonly recordId: string },
    expectedVersion: string,
    idempotencyKey: string,
  ): Promise<CrmProviderCommitResult>;
  compensateFollowUp(
    before: CrmRecord,
    expectedVersion: string,
    idempotencyKey: string,
  ): Promise<CrmProviderCommitResult>;
  reconcile(idempotencyKey: string): Promise<CrmProviderCommitResult | undefined>;
}

interface StoredAttempt {
  readonly fingerprint: string;
  readonly result: CrmProviderCommitResult;
}

export class InMemoryReferenceCrmProvider {
  readonly #attempts = new Map<string, StoredAttempt>();
  readonly #records = new Map<string, CrmRecord>();
  #failureMode: 'ALWAYS' | 'NEXT' | 'NONE' = 'NONE';
  #mutationCount = 0;

  public constructor(records: readonly CrmRecord[]) {
    for (const record of records) {
      const parsed = crmRecordSchema.parse(record);
      this.#records.set(parsed.id, structuredClone(parsed));
    }
  }

  public createReadPort(): CrmReadPort {
    return Object.freeze({
      readRecord: (recordId: string) => Promise.resolve(this.#readRecord(recordId)),
    });
  }

  public createCommitPort(): CrmCommitPort {
    return Object.freeze({
      commitFollowUp: (
        payload: { readonly followUpAt: string; readonly recordId: string },
        expectedVersion: string,
        idempotencyKey: string,
      ) => Promise.resolve(
        this.#commitFollowUp(payload, expectedVersion, idempotencyKey),
      ),
      compensateFollowUp: (
        before: CrmRecord,
        expectedVersion: string,
        idempotencyKey: string,
      ) => Promise.resolve(
        this.#compensateFollowUp(before, expectedVersion, idempotencyKey),
      ),
      readRecord: (recordId: string) => Promise.resolve(this.#readRecord(recordId)),
      reconcile: (idempotencyKey: string) => Promise.resolve(this.#reconcile(idempotencyKey)),
    });
  }

  public failNextCommitBeforeWrite(): void {
    this.#failureMode = 'NEXT';
  }

  public failAllCommitsBeforeWrite(): void {
    this.#failureMode = 'ALWAYS';
  }

  public get mutationCount(): number {
    return this.#mutationCount;
  }

  public snapshotBytes(): Buffer {
    const records = [...this.#records.values()]
      .sort((left, right) => {
        if (left.id < right.id) return -1;
        if (left.id > right.id) return 1;
        return 0;
      })
      .map((record) => structuredClone(record));
    return Buffer.from(JSON.stringify(records), 'utf8');
  }

  #commitFollowUp(
    rawPayload: { readonly followUpAt: string; readonly recordId: string },
    expectedVersion: string,
    idempotencyKey: string,
  ): CrmProviderCommitResult {
    const payload = moveFollowUpPayloadSchema.parse(rawPayload);
    const fingerprint = this.#fingerprint({ expectedVersion, operation: 'commit', payload });
    const previous = this.#attempts.get(idempotencyKey);
    if (previous !== undefined) return this.#repeat(previous, fingerprint);
    if (this.#failureMode !== 'NONE') {
      if (this.#failureMode === 'NEXT') this.#failureMode = 'NONE';
      throw new DefinitelyNotAppliedError('Injected CRM failure before provider write');
    }
    const current = this.#records.get(payload.recordId);
    if (current === undefined) throw new DefinitelyNotAppliedError('CRM record is missing');
    if (current.version !== expectedVersion) {
      throw new DefinitelyNotAppliedError('CRM record version drifted before mutation');
    }
    const next = crmRecordSchema.parse({
      ...current,
      followUpAt: payload.followUpAt,
      version: this.#nextVersion(current.version),
    });
    this.#records.set(next.id, structuredClone(next));
    this.#mutationCount += 1;
    return this.#store(idempotencyKey, fingerprint, next);
  }

  #compensateFollowUp(
    before: CrmRecord,
    expectedVersion: string,
    idempotencyKey: string,
  ): CrmProviderCommitResult {
    const parsedBefore = crmRecordSchema.parse(before);
    const fingerprint = this.#fingerprint({ before: parsedBefore, expectedVersion, operation: 'compensate' });
    const previous = this.#attempts.get(idempotencyKey);
    if (previous !== undefined) return this.#repeat(previous, fingerprint);
    const current = this.#records.get(parsedBefore.id);
    if (current?.version !== expectedVersion) {
      throw new DefinitelyNotAppliedError('CRM compensation refused because provider state drifted');
    }
    const restored = crmRecordSchema.parse({
      ...parsedBefore,
      version: this.#nextVersion(current.version),
    });
    this.#records.set(restored.id, structuredClone(restored));
    this.#mutationCount += 1;
    return this.#store(idempotencyKey, fingerprint, restored);
  }

  #readRecord(recordId: string): CrmRecord | undefined {
    const record = this.#records.get(recordId);
    return record === undefined ? undefined : structuredClone(record);
  }

  #reconcile(idempotencyKey: string): CrmProviderCommitResult | undefined {
    const attempt = this.#attempts.get(idempotencyKey);
    return attempt === undefined
      ? undefined
      : { applied: false, record: structuredClone(attempt.result.record) };
  }

  #store(idempotencyKey: string, fingerprint: string, record: CrmRecord): CrmProviderCommitResult {
    const result = { applied: true, record: structuredClone(record) };
    this.#attempts.set(idempotencyKey, { fingerprint, result: structuredClone(result) });
    return result;
  }

  #repeat(attempt: StoredAttempt, fingerprint: string): CrmProviderCommitResult {
    if (attempt.fingerprint !== fingerprint) {
      throw new Error('Idempotency key was reused with different CRM content');
    }
    return { applied: false, record: structuredClone(attempt.result.record) };
  }

  #fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  #nextVersion(version: string): string {
    const numeric = Number.parseInt(version.replace(/^v/u, ''), 10);
    return `v${String(Number.isNaN(numeric) ? 1 : numeric + 1)}`;
  }
}
