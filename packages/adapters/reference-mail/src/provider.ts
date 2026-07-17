import { createHash } from 'node:crypto';

import {
  AmbiguousProviderError,
  DefinitelyNotAppliedError,
} from '@preview/adapter-sdk';

import {
  mailMessageSchema,
  sendMessagePayloadSchema,
  type MailMessage,
} from './schemas.js';

export interface MailReadPort {
  readMessage(messageId: string): Promise<MailMessage | undefined>;
}

export interface MailProviderCommitResult {
  readonly applied: boolean;
  readonly message: MailMessage;
}

export type MailProviderReconciliation =
  | { readonly result: MailProviderCommitResult; readonly status: 'APPLIED' }
  | { readonly status: 'AUTHORITATIVELY_NOT_APPLIED' }
  | { readonly details: string; readonly status: 'UNKNOWN' };

export type MailCommitFault =
  | 'NONE'
  | 'FAIL_BEFORE_WRITE'
  | 'AMBIGUOUS_AFTER_WRITE'
  | 'AMBIGUOUS_UNKNOWN'
  | 'AMBIGUOUS_NOT_APPLIED_ALWAYS';

export interface MailCommitPort extends MailReadPort {
  deliver(
    payload: {
      readonly messageId: string;
      readonly recipients: readonly string[];
      readonly subject: string;
      readonly textBody: string;
    },
    idempotencyKey: string,
  ): Promise<MailProviderCommitResult>;
  reconcileDelivery(idempotencyKey: string): Promise<MailProviderReconciliation>;
}

interface StoredAttempt {
  readonly fingerprint: string;
  readonly result: MailProviderCommitResult;
}

export class InMemoryReferenceMailProvider {
  readonly #attempts = new Map<string, StoredAttempt>();
  readonly #messages = new Map<string, MailMessage>();
  readonly #unknownAttempts = new Set<string>();
  #mutationCount = 0;
  #nextFault: MailCommitFault = 'NONE';

  public constructor(messages: readonly MailMessage[]) {
    for (const message of messages) {
      const parsed = mailMessageSchema.parse(message);
      this.#messages.set(parsed.id, structuredClone(parsed));
    }
  }

  public createReadPort(): MailReadPort {
    return Object.freeze({
      readMessage: (messageId: string) => Promise.resolve(this.#readMessage(messageId)),
    });
  }

  public createCommitPort(): MailCommitPort {
    return Object.freeze({
      deliver: (
        payload: {
          readonly messageId: string;
          readonly recipients: readonly string[];
          readonly subject: string;
          readonly textBody: string;
        },
        idempotencyKey: string,
      ) => Promise.resolve(this.#deliver(payload, idempotencyKey)),
      readMessage: (messageId: string) => Promise.resolve(this.#readMessage(messageId)),
      reconcileDelivery: (idempotencyKey: string) => Promise.resolve(
        this.#reconcileDelivery(idempotencyKey),
      ),
    });
  }

  public injectNextCommitFault(fault: Exclude<MailCommitFault, 'NONE'>): void {
    this.#nextFault = fault;
  }

  public get mutationCount(): number {
    return this.#mutationCount;
  }

  public snapshotBytes(): Buffer {
    const messages = [...this.#messages.values()]
      .sort((left, right) => {
        if (left.id < right.id) return -1;
        if (left.id > right.id) return 1;
        return 0;
      })
      .map((message) => structuredClone(message));
    return Buffer.from(JSON.stringify(messages), 'utf8');
  }

  #deliver(
    rawPayload: {
      readonly messageId: string;
      readonly recipients: readonly string[];
      readonly subject: string;
      readonly textBody: string;
    },
    idempotencyKey: string,
  ): MailProviderCommitResult {
    const payload = sendMessagePayloadSchema.parse(rawPayload);
    const fingerprint = this.#fingerprint(payload);
    const previous = this.#attempts.get(idempotencyKey);
    if (previous !== undefined) return this.#repeat(previous, fingerprint);
    const fault = this.#nextFault;
    if (fault !== 'AMBIGUOUS_NOT_APPLIED_ALWAYS') this.#nextFault = 'NONE';
    if (fault === 'FAIL_BEFORE_WRITE') {
      throw new DefinitelyNotAppliedError('Injected Mail failure before delivery');
    }
    if (fault === 'AMBIGUOUS_UNKNOWN') {
      this.#unknownAttempts.add(idempotencyKey);
      throw new AmbiguousProviderError('Injected Mail outcome is unknown');
    }
    if (fault === 'AMBIGUOUS_NOT_APPLIED_ALWAYS') {
      throw new AmbiguousProviderError('Injected Mail call is ambiguously not applied');
    }
    if (this.#messages.has(payload.messageId)) {
      throw new DefinitelyNotAppliedError('Mail message ID already exists');
    }
    const delivered = mailMessageSchema.parse({
      ...payload,
      id: payload.messageId,
      state: 'DELIVERED',
      version: 'v1',
    });
    this.#messages.set(delivered.id, structuredClone(delivered));
    this.#mutationCount += 1;
    const result = { applied: true, message: structuredClone(delivered) };
    this.#attempts.set(idempotencyKey, { fingerprint, result: structuredClone(result) });
    if (fault === 'AMBIGUOUS_AFTER_WRITE') {
      throw new AmbiguousProviderError('Mail delivered but provider response was ambiguous');
    }
    return result;
  }

  #readMessage(messageId: string): MailMessage | undefined {
    const message = this.#messages.get(messageId);
    return message === undefined ? undefined : structuredClone(message);
  }

  #reconcileDelivery(idempotencyKey: string): MailProviderReconciliation {
    const attempt = this.#attempts.get(idempotencyKey);
    if (attempt !== undefined) {
      return {
        result: { applied: false, message: structuredClone(attempt.result.message) },
        status: 'APPLIED',
      };
    }
    if (this.#unknownAttempts.has(idempotencyKey)) {
      return { details: 'Reference Mail cannot determine whether delivery occurred', status: 'UNKNOWN' };
    }
    return { status: 'AUTHORITATIVELY_NOT_APPLIED' };
  }

  #repeat(attempt: StoredAttempt, fingerprint: string): MailProviderCommitResult {
    if (attempt.fingerprint !== fingerprint) {
      throw new Error('Idempotency key was reused with different Mail content');
    }
    return { applied: false, message: structuredClone(attempt.result.message) };
  }

  #fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
