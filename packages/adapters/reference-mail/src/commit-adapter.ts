import type {
  CommitResult,
  CompensationReconciliationResult,
  DurableCommitAdapter,
  ReconciliationResult,
  RevalidationResult,
  VerificationResult,
} from '@preview/adapter-sdk';
import { computeCanonicalDigest, type Effect, type Observation } from '@preview/domain';
import type { MailCommitPort } from './provider.js';
import {
  mailMessageSchema,
  REFERENCE_MAIL_ADAPTER_ID,
  sendMessageEffectSchema,
  type MailMessage,
} from './schemas.js';

export class ReferenceMailCommitAdapter implements DurableCommitAdapter<MailMessage> {
  public readonly adapterId = REFERENCE_MAIL_ADAPTER_ID;
  public readonly adapterVersion = '1.0.0';
  readonly #port: MailCommitPort;

  public constructor(port: MailCommitPort) {
    this.#port = port;
  }

  public async revalidate(effect: Effect): Promise<RevalidationResult> {
    const parsed = sendMessageEffectSchema.parse(effect);
    const current = await this.#port.readMessage(parsed.payload.messageId);
    return {
      currentVersion: current?.version ?? undefined,
      status: current === undefined ? 'UNCHANGED' : 'APPEARED',
    };
  }

  public async revalidateObservation(observation: Observation): Promise<RevalidationResult> {
    const prefix = `${this.adapterId}:message:`;
    if (observation.adapterId !== this.adapterId || !observation.resourceKey.startsWith(prefix)) {
      throw new TypeError('Mail observation does not match this adapter');
    }
    const current = await this.#port.readMessage(observation.resourceKey.slice(prefix.length));
    if (observation.presence === 'ABSENT') {
      return {
        currentVersion: current?.version ?? undefined,
        status: current === undefined ? 'UNCHANGED' : 'APPEARED',
      };
    }
    if (current === undefined) return { currentVersion: undefined, status: 'MISSING' };
    const currentValueDigest = computeCanonicalDigest(current);
    return {
      currentValueDigest,
      currentVersion: current.version ?? undefined,
      status: current.version === observation.version && currentValueDigest === observation.valueDigest
        ? 'UNCHANGED'
        : 'DRIFTED',
    };
  }

  public async commit(effect: Effect, idempotencyKey: string): Promise<CommitResult<MailMessage>> {
    const parsed = sendMessageEffectSchema.parse(effect);
    const result = await this.#port.deliver(parsed.payload, idempotencyKey);
    return { applied: result.applied, resource: result.message };
  }

  public async reconcile(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CommitResult<MailMessage> | undefined> {
    sendMessageEffectSchema.parse(effect);
    const outcome = await this.#port.reconcileDelivery(idempotencyKey);
    return outcome.status === 'APPLIED'
      ? { applied: outcome.result.applied, resource: outcome.result.message }
      : undefined;
  }

  public async reconcileCommit(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<ReconciliationResult<MailMessage>> {
    sendMessageEffectSchema.parse(effect);
    const outcome = await this.#port.reconcileDelivery(idempotencyKey);
    if (outcome.status === 'APPLIED') {
      return {
        result: { applied: outcome.result.applied, resource: outcome.result.message },
        status: 'APPLIED',
      };
    }
    return outcome;
  }

  public parseCommitResult(value: unknown): CommitResult<MailMessage> {
    if (value === null || typeof value !== 'object') {
      throw new TypeError('Mail commit result must be an object');
    }
    const candidate = value as { readonly applied?: unknown; readonly resource?: unknown };
    if (typeof candidate.applied !== 'boolean') {
      throw new TypeError('Mail commit result requires an applied flag');
    }
    return { applied: candidate.applied, resource: mailMessageSchema.parse(candidate.resource) };
  }

  public async verify(effect: Effect): Promise<VerificationResult> {
    const parsed = sendMessageEffectSchema.parse(effect);
    const current = await this.#port.readMessage(parsed.payload.messageId);
    const verified = current?.state === 'DELIVERED'
      && current.recipients.length === parsed.payload.recipients.length
      && current.recipients.every((recipient, index) => recipient === parsed.payload.recipients[index])
      && current.subject === parsed.payload.subject
      && current.textBody === parsed.payload.textBody;
    return { details: verified ? 'Mail delivery exactly reconciled' : 'Mail delivery differs', verified };
  }

  public compensate(): Promise<VerificationResult> {
    return Promise.resolve({ details: 'Mail delivery is irreversible', verified: false });
  }

  public reconcileCompensation(): Promise<CompensationReconciliationResult> {
    return Promise.resolve({ details: 'Mail delivery is irreversible', status: 'UNKNOWN' });
  }
}
