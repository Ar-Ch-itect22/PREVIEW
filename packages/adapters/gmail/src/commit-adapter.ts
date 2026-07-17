import {
  AmbiguousProviderError,
  DefinitelyNotAppliedError,
  type CommitResult,
  type CompensationReconciliationResult,
  type DurableCommitAdapter,
  type ReconciliationResult,
  type RevalidationResult,
  type VerificationResult,
} from '@preview/adapter-sdk';
import { computeCanonicalDigest, type Effect, type Observation } from '@preview/domain';
import { GoogleApiError } from '@preview/google-common';
import { z } from 'zod';

import type { GmailCommitPort } from './provider.js';
import {
  GMAIL_ADAPTER_ID,
  GMAIL_CREATE_DRAFT_OPERATION,
  gmailExactEffectSchema,
  gmailResourceSchema,
  parseGmailResourceKey,
  type GmailExactEffect,
  type GmailResource,
} from './schemas.js';

export class GmailCommitAdapter implements DurableCommitAdapter<GmailResource> {
  public readonly adapterId = GMAIL_ADAPTER_ID;
  public readonly adapterVersion = '1.0.0';
  readonly #port: GmailCommitPort;

  public constructor(port: GmailCommitPort) {
    this.#port = port;
  }

  public async revalidate(effect: Effect): Promise<RevalidationResult> {
    const parsed = gmailExactEffectSchema.parse(effect);
    const matches = await this.#matches(parsed);
    return { currentVersion: matches[0]?.version, status: matches.length === 0 ? 'UNCHANGED' : 'APPEARED' };
  }

  public async revalidateObservation(observation: Observation): Promise<RevalidationResult> {
    if (observation.adapterId !== this.adapterId) throw new TypeError('Gmail observation adapter mismatch');
    const key = parseGmailResourceKey(observation.resourceKey);
    const matches = await this.#port.findExact(key.kind, key.logicalId);
    if (observation.presence === 'ABSENT') {
      return { currentVersion: matches[0]?.version, status: matches.length === 0 ? 'UNCHANGED' : 'APPEARED' };
    }
    if (matches.length !== 1) {
      return { currentVersion: matches[0]?.version, status: matches.length === 0 ? 'MISSING' : 'DRIFTED' };
    }
    const current = matches[0];
    if (current === undefined) throw new TypeError('Gmail observation cardinality changed unexpectedly');
    const digest = computeCanonicalDigest(current);
    return {
      currentValueDigest: digest,
      currentVersion: current.version,
      status: current.version === observation.version && digest === observation.valueDigest ? 'UNCHANGED' : 'DRIFTED',
    };
  }

  public async commit(effect: Effect, idempotencyKey: string): Promise<CommitResult<GmailResource>> {
    void idempotencyKey;
    const parsed = gmailExactEffectSchema.parse(effect);
    try {
      const resource = parsed.operation === GMAIL_CREATE_DRAFT_OPERATION
        ? await this.#port.createDraft(parsed.payload)
        : await this.#port.sendMessage(parsed.payload);
      return { applied: true, resource };
    } catch (error) {
      throw classifyMutationError(error);
    }
  }

  public async reconcile(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CommitResult<GmailResource> | undefined> {
    const outcome = await this.reconcileCommit(effect, idempotencyKey);
    return outcome.status === 'APPLIED' ? outcome.result : undefined;
  }

  public async reconcileCommit(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<ReconciliationResult<GmailResource>> {
    void idempotencyKey;
    const parsed = gmailExactEffectSchema.parse(effect);
    const matches = await this.#matches(parsed);
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match !== undefined && resourceMatches(match, parsed)) {
      return { result: { applied: false, resource: match }, status: 'APPLIED' };
    }
    return {
      details: matches.length === 0
        ? 'No exact Gmail Message-ID match is visible; indexing or request outcome may be delayed'
        : 'Gmail Message-ID matches are duplicate or differ from approved controlled content',
      status: 'UNKNOWN',
    };
  }

  public parseCommitResult(value: unknown): CommitResult<GmailResource> {
    return z.object({ applied: z.boolean(), resource: gmailResourceSchema }).parse(value);
  }

  public async verify(effect: Effect, result: CommitResult<GmailResource>): Promise<VerificationResult> {
    const parsed = gmailExactEffectSchema.parse(effect);
    const current = parsed.operation === GMAIL_CREATE_DRAFT_OPERATION
      ? result.resource.providerDraftId === undefined
        ? undefined
        : await this.#port.readDraft(result.resource.providerDraftId)
      : await this.#port.readMessage(result.resource.providerMessageId);
    const verified = current !== undefined && resourceMatches(current, parsed);
    return { details: verified ? 'Gmail controlled MIME content verified' : 'Gmail controlled MIME differs', verified };
  }

  public async compensate(
    effect: Effect,
    result: CommitResult<GmailResource>,
    idempotencyKey: string,
  ): Promise<VerificationResult> {
    void idempotencyKey;
    const parsed = gmailExactEffectSchema.parse(effect);
    if (parsed.operation !== GMAIL_CREATE_DRAFT_OPERATION || result.resource.providerDraftId === undefined) {
      return { details: 'Gmail message delivery is irreversible', verified: false };
    }
    try {
      const beforeDelete = await this.#port.readDraft(result.resource.providerDraftId);
      if (beforeDelete === undefined) {
        return {
          details: 'Gmail draft was already absent',
          residuals: ['Gmail mailbox history and provider mutation records may remain changed'],
          verified: true,
        };
      }
      if (beforeDelete.version !== result.resource.version || !resourceMatches(beforeDelete, parsed)) {
        throw new DefinitelyNotAppliedError('Post-commit Gmail draft drift blocks compensation');
      }
      await this.#port.deleteDraft(result.resource.providerDraftId);
    } catch (error) {
      throw classifyMutationError(error);
    }
    const current = await this.#port.readDraft(result.resource.providerDraftId);
    const verified = current === undefined;
    return {
      details: verified ? 'Gmail draft removed' : 'Gmail draft remains',
      residuals: verified ? ['Gmail mailbox history and provider mutation records remain changed'] : [],
      verified,
    };
  }

  public async reconcileCompensation(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CompensationReconciliationResult> {
    void idempotencyKey;
    const parsed = gmailExactEffectSchema.parse(effect);
    if (parsed.operation !== GMAIL_CREATE_DRAFT_OPERATION) {
      return { details: 'Gmail message delivery is irreversible', status: 'UNKNOWN' };
    }
    const matches = await this.#matches(parsed);
    if (matches.length === 0) {
      return {
        details: 'No exact Gmail draft is visible; search indexing cannot prove an ambiguous delete applied',
        status: 'UNKNOWN',
      };
    }
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match !== undefined && resourceMatches(match, parsed)) {
      return { status: 'AUTHORITATIVELY_NOT_APPLIED' };
    }
    return { details: 'Gmail draft compensation state is ambiguous', status: 'UNKNOWN' };
  }

  #matches(effect: GmailExactEffect): Promise<readonly GmailResource[]> {
    return this.#port.findExact(
      effect.operation === GMAIL_CREATE_DRAFT_OPERATION ? 'draft' : 'message',
      effect.payload.logicalId,
    );
  }
}

function resourceMatches(resource: GmailResource, effect: GmailExactEffect): boolean {
  const payload = effect.payload;
  const expectedState = effect.operation === GMAIL_CREATE_DRAFT_OPERATION ? 'DRAFT' : 'SENT';
  return resource.state === expectedState
    && resource.rfcMessageId === payload.rfcMessageId
    && resource.rawDigest === payload.rawDigest
    && resource.from.toLowerCase() === payload.from.toLowerCase()
    && resource.subject === payload.subject
    && resource.textBody === payload.textBody
    && resource.recipients.length === payload.recipients.length
    && resource.recipients.every((recipient, index) => (
      recipient.toLowerCase() === payload.recipients[index]?.toLowerCase()
    ));
}

function classifyMutationError(error: unknown): Error {
  if (error instanceof GoogleApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
    return new DefinitelyNotAppliedError(error.message);
  }
  if (error instanceof DefinitelyNotAppliedError || error instanceof AmbiguousProviderError) return error;
  return new AmbiguousProviderError('Gmail mutation outcome is ambiguous');
}
