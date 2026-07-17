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

import type { GoogleCalendarCommitPort } from './provider.js';
import {
  GOOGLE_CALENDAR_ADAPTER_ID,
  googleCalendarEventSchema,
  googleCalendarMoveEffectSchema,
  parseGoogleCalendarResourceKey,
  type GoogleCalendarEvent,
} from './schemas.js';

export class GoogleCalendarCommitAdapter implements DurableCommitAdapter<GoogleCalendarEvent> {
  public readonly adapterId = GOOGLE_CALENDAR_ADAPTER_ID;
  public readonly adapterVersion = '1.0.0';
  readonly #port: GoogleCalendarCommitPort;

  public constructor(port: GoogleCalendarCommitPort) {
    this.#port = port;
  }

  public async revalidate(effect: Effect): Promise<RevalidationResult> {
    const parsed = googleCalendarMoveEffectSchema.parse(effect);
    const current = await this.#port.readEvent(parsed.payload.calendarId, parsed.payload.eventId);
    if (current === undefined) return { currentVersion: undefined, status: 'MISSING' };
    return {
      currentVersion: current.version,
      status: current.version === parsed.preconditions[0].version ? 'UNCHANGED' : 'DRIFTED',
    };
  }

  public async revalidateObservation(observation: Observation): Promise<RevalidationResult> {
    if (observation.adapterId !== this.adapterId) throw new TypeError('Observation adapter mismatch');
    const key = parseGoogleCalendarResourceKey(observation.resourceKey);
    const current = await this.#port.readEvent(key.calendarId, key.eventId);
    if (observation.presence === 'ABSENT') {
      return { currentVersion: current?.version, status: current === undefined ? 'UNCHANGED' : 'APPEARED' };
    }
    if (current === undefined) return { currentVersion: undefined, status: 'MISSING' };
    const digest = computeCanonicalDigest(current);
    return {
      currentValueDigest: digest,
      currentVersion: current.version,
      status: current.version === observation.version && digest === observation.valueDigest
        ? 'UNCHANGED'
        : 'DRIFTED',
    };
  }

  public async commit(effect: Effect, idempotencyKey: string): Promise<CommitResult<GoogleCalendarEvent>> {
    const parsed = googleCalendarMoveEffectSchema.parse(effect);
    try {
      const result = await this.#port.commitMove(
        parsed.payload,
        parsed.preconditions[0].before,
        idempotencyKey,
      );
      return { applied: result.applied, resource: result.event };
    } catch (error) {
      throw classifyMutationError(error);
    }
  }

  public async reconcile(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CommitResult<GoogleCalendarEvent> | undefined> {
    const parsed = googleCalendarMoveEffectSchema.parse(effect);
    const result = await this.#port.reconcileMove(
      parsed.payload.calendarId,
      parsed.payload.eventId,
      idempotencyKey,
    );
    return result === undefined ? undefined : { applied: result.applied, resource: result.event };
  }

  public async reconcileCommit(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<ReconciliationResult<GoogleCalendarEvent>> {
    const parsed = googleCalendarMoveEffectSchema.parse(effect);
    const result = await this.reconcile(effect, idempotencyKey);
    if (result !== undefined) {
      return result.resource.start === parsed.payload.start && result.resource.end === parsed.payload.end
        ? { result, status: 'APPLIED' }
        : { details: 'Calendar event changed after the PREVIEW commit marker was written', status: 'UNKNOWN' };
    }
    const current = await this.#port.readEvent(parsed.payload.calendarId, parsed.payload.eventId);
    return current?.version === parsed.preconditions[0].version
      && computeCanonicalDigest(current) === computeCanonicalDigest(parsed.preconditions[0].before)
      ? { status: 'AUTHORITATIVELY_NOT_APPLIED' }
      : { details: 'Calendar event changed without the PREVIEW commit marker', status: 'UNKNOWN' };
  }

  public parseCommitResult(value: unknown): CommitResult<GoogleCalendarEvent> {
    return z.object({ applied: z.boolean(), resource: googleCalendarEventSchema }).parse(value);
  }

  public async verify(effect: Effect): Promise<VerificationResult> {
    const parsed = googleCalendarMoveEffectSchema.parse(effect);
    const current = await this.#port.readEvent(parsed.payload.calendarId, parsed.payload.eventId);
    const verified = current?.start === parsed.payload.start && current.end === parsed.payload.end;
    return { details: verified ? 'Google Calendar move verified' : 'Google Calendar move differs', verified };
  }

  public async compensate(
    effect: Effect,
    result: CommitResult<GoogleCalendarEvent>,
    idempotencyKey: string,
  ): Promise<VerificationResult> {
    const parsed = googleCalendarMoveEffectSchema.parse(effect);
    try {
      const current = await this.#port.readEvent(parsed.payload.calendarId, parsed.payload.eventId);
      if (current === undefined) {
        throw new DefinitelyNotAppliedError('Post-commit Calendar drift blocks compensation');
      }
      if (
        current.version !== result.resource.version
        || current.start !== parsed.payload.start
        || current.end !== parsed.payload.end
      ) {
        throw new DefinitelyNotAppliedError('Post-commit Calendar drift blocks compensation');
      }
      await this.#port.compensateMove(
        parsed.preconditions[0].before,
        result.resource.version,
        idempotencyKey,
      );
    } catch (error) {
      throw classifyMutationError(error);
    }
    return this.#verifyBefore(parsed.preconditions[0].before);
  }

  public async reconcileCompensation(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CompensationReconciliationResult> {
    const parsed = googleCalendarMoveEffectSchema.parse(effect);
    const result = await this.#port.reconcileCompensation(parsed.preconditions[0].before, idempotencyKey);
    if (result === undefined) {
      const current = await this.#port.readEvent(parsed.payload.calendarId, parsed.payload.eventId);
      return current?.version === parsed.preconditions[0].version
        ? { status: 'AUTHORITATIVELY_NOT_APPLIED' }
        : { details: 'Calendar compensation outcome cannot be determined', status: 'UNKNOWN' };
    }
    return { status: 'APPLIED', verification: await this.#verifyBefore(parsed.preconditions[0].before) };
  }

  async #verifyBefore(before: GoogleCalendarEvent): Promise<VerificationResult> {
    const current = await this.#port.readEvent(before.calendarId, before.id);
    const verified = current?.start === before.start && current.end === before.end;
    return {
      details: verified ? 'Google Calendar event fields restored' : 'Google Calendar restoration differs',
      residuals: verified
        ? ['Google Calendar update metadata and provider revision history remain changed']
        : [],
      verified,
    };
  }
}

function classifyMutationError(error: unknown): Error {
  if (error instanceof GoogleApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
    return new DefinitelyNotAppliedError(error.message);
  }
  if (error instanceof DefinitelyNotAppliedError || error instanceof AmbiguousProviderError) return error;
  return new AmbiguousProviderError('Google Calendar mutation outcome is ambiguous');
}
