import type {
  CommitResult,
  CompensationReconciliationResult,
  DurableCommitAdapter,
  ReconciliationResult,
  RevalidationResult,
  VerificationResult,
} from '@preview/adapter-sdk';
import { computeCanonicalDigest, type Effect, type Observation } from '@preview/domain';
import { z } from 'zod';

import type { CrmCommitPort } from './provider.js';
import {
  crmRecordSchema,
  moveFollowUpEffectSchema,
  REFERENCE_CRM_ADAPTER_ID,
  type CrmRecord,
} from './schemas.js';

export class ReferenceCrmCommitAdapter implements DurableCommitAdapter<CrmRecord> {
  public readonly adapterId = REFERENCE_CRM_ADAPTER_ID;
  public readonly adapterVersion = '1.0.0';
  readonly #port: CrmCommitPort;

  public constructor(port: CrmCommitPort) {
    this.#port = port;
  }

  public async revalidate(effect: Effect): Promise<RevalidationResult> {
    const parsed = moveFollowUpEffectSchema.parse(effect);
    const current = await this.#port.readRecord(parsed.payload.recordId);
    if (current === undefined) return { currentVersion: undefined, status: 'MISSING' };
    return {
      currentVersion: current.version,
      status: current.version === parsed.preconditions[0].version ? 'UNCHANGED' : 'DRIFTED',
    };
  }

  public async revalidateObservation(observation: Observation): Promise<RevalidationResult> {
    const prefix = `${this.adapterId}:record:`;
    if (observation.adapterId !== this.adapterId || !observation.resourceKey.startsWith(prefix)) {
      throw new TypeError('CRM observation does not match this adapter');
    }
    const current = await this.#port.readRecord(observation.resourceKey.slice(prefix.length));
    if (observation.presence === 'ABSENT') {
      return { currentVersion: current?.version, status: current === undefined ? 'UNCHANGED' : 'APPEARED' };
    }
    if (current === undefined) return { currentVersion: undefined, status: 'MISSING' };
    const currentValueDigest = computeCanonicalDigest(current);
    return {
      currentValueDigest,
      currentVersion: current.version,
      status: current.version === observation.version && currentValueDigest === observation.valueDigest
        ? 'UNCHANGED'
        : 'DRIFTED',
    };
  }

  public async commit(effect: Effect, idempotencyKey: string): Promise<CommitResult<CrmRecord>> {
    const parsed = moveFollowUpEffectSchema.parse(effect);
    const result = await this.#port.commitFollowUp(
      parsed.payload,
      parsed.preconditions[0].version,
      idempotencyKey,
    );
    return { applied: result.applied, resource: result.record };
  }

  public async reconcile(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CommitResult<CrmRecord> | undefined> {
    moveFollowUpEffectSchema.parse(effect);
    const result = await this.#port.reconcile(idempotencyKey);
    return result === undefined ? undefined : { applied: result.applied, resource: result.record };
  }

  public async reconcileCommit(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<ReconciliationResult<CrmRecord>> {
    const result = await this.reconcile(effect, idempotencyKey);
    return result === undefined
      ? { status: 'AUTHORITATIVELY_NOT_APPLIED' }
      : { result, status: 'APPLIED' };
  }

  public parseCommitResult(value: unknown): CommitResult<CrmRecord> {
    return z.object({ applied: z.boolean(), resource: crmRecordSchema }).parse(value);
  }

  public async verify(effect: Effect): Promise<VerificationResult> {
    const parsed = moveFollowUpEffectSchema.parse(effect);
    const current = await this.#port.readRecord(parsed.payload.recordId);
    const verified = current?.followUpAt === parsed.payload.followUpAt;
    return { details: verified ? 'CRM follow-up verified' : 'CRM follow-up differs', verified };
  }

  public async compensate(
    effect: Effect,
    result: CommitResult<CrmRecord>,
    idempotencyKey: string,
  ): Promise<VerificationResult> {
    const parsed = moveFollowUpEffectSchema.parse(effect);
    await this.#port.compensateFollowUp(
      parsed.preconditions[0].before,
      result.resource.version,
      idempotencyKey,
    );
    const current = await this.#port.readRecord(parsed.payload.recordId);
    const verified = current?.followUpAt === parsed.preconditions[0].before.followUpAt;
    return { details: verified ? 'CRM follow-up restored' : 'CRM compensation differs', verified };
  }

  public async reconcileCompensation(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CompensationReconciliationResult> {
    const parsed = moveFollowUpEffectSchema.parse(effect);
    const attempt = await this.#port.reconcile(idempotencyKey);
    if (attempt === undefined) return { status: 'AUTHORITATIVELY_NOT_APPLIED' };
    const current = await this.#port.readRecord(parsed.payload.recordId);
    const verified = current?.followUpAt === parsed.preconditions[0].before.followUpAt;
    return {
      status: 'APPLIED',
      verification: { details: verified ? 'CRM compensation verified' : 'CRM compensation differs', verified },
    };
  }
}
