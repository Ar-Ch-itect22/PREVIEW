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

import type { CalendarCommitPort } from './provider.js';
import {
  calendarEventSchema,
  moveEffectSchema,
  type MoveEventEffect,
  type CalendarEvent,
} from './schemas.js';
import { REFERENCE_CALENDAR_ADAPTER_ID } from './schemas.js';

export class ReferenceCalendarCommitAdapter implements DurableCommitAdapter<CalendarEvent> {
  public readonly adapterId = REFERENCE_CALENDAR_ADAPTER_ID;
  public readonly adapterVersion = '1.0.0';
  readonly #commitPort: CalendarCommitPort;

  public constructor(commitPort: CalendarCommitPort) {
    this.#commitPort = commitPort;
  }

  public async revalidate(effect: Effect): Promise<RevalidationResult> {
    const { payload, precondition } = this.#parseEffect(effect);
    const current = await this.#commitPort.readEvent(payload.eventId);
    if (current === undefined) {
      return { currentVersion: undefined, status: 'MISSING' };
    }
    return {
      currentVersion: current.version,
      status: current.version === precondition.version ? 'UNCHANGED' : 'DRIFTED',
    };
  }

  public async revalidateObservation(observation: Observation): Promise<RevalidationResult> {
    const prefix = `${this.adapterId}:event:`;
    if (observation.adapterId !== this.adapterId || !observation.resourceKey.startsWith(prefix)) {
      throw new TypeError('Calendar observation does not match this adapter');
    }
    const eventId = observation.resourceKey.slice(prefix.length);
    const current = await this.#commitPort.readEvent(eventId);
    if (observation.presence === 'ABSENT') {
      return {
        currentVersion: current?.version,
        status: current === undefined ? 'UNCHANGED' : 'APPEARED',
      };
    }
    if (current === undefined) {
      return { currentVersion: undefined, status: 'MISSING' };
    }
    const currentValueDigest = computeCanonicalDigest(current);
    return {
      currentValueDigest,
      currentVersion: current.version,
      status: current.version === observation.version
        && currentValueDigest === observation.valueDigest
        ? 'UNCHANGED'
        : 'DRIFTED',
    };
  }

  public async commit(effect: Effect, idempotencyKey: string): Promise<CommitResult<CalendarEvent>> {
    const { payload, precondition } = this.#parseEffect(effect);
    const result = await this.#commitPort.commitMove(payload, precondition.version, idempotencyKey);
    return { applied: result.applied, resource: result.event };
  }

  public async reconcile(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CommitResult<CalendarEvent> | undefined> {
    this.#parseEffect(effect);
    const result = await this.#commitPort.reconcile(idempotencyKey);
    return result === undefined ? undefined : { applied: result.applied, resource: result.event };
  }

  public async reconcileCommit(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<ReconciliationResult<CalendarEvent>> {
    const result = await this.reconcile(effect, idempotencyKey);
    return result === undefined
      ? { status: 'AUTHORITATIVELY_NOT_APPLIED' }
      : { result, status: 'APPLIED' };
  }

  public parseCommitResult(value: unknown): CommitResult<CalendarEvent> {
    return z.object({ applied: z.boolean(), resource: calendarEventSchema }).parse(value);
  }

  public async reconcileCompensation(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CompensationReconciliationResult> {
    const { precondition } = this.#parseEffect(effect);
    const result = await this.#commitPort.reconcile(idempotencyKey);
    if (result === undefined) return { status: 'AUTHORITATIVELY_NOT_APPLIED' };
    const actual = await this.#commitPort.readEvent(precondition.before.id);
    const verified = actual?.start === precondition.before.start
      && actual.end === precondition.before.end;
    return {
      status: 'APPLIED',
      verification: {
        details: verified ? 'Calendar event compensation verified' : 'Calendar compensation differs',
        verified,
      },
    };
  }

  public async verify(
    effect: Effect,
  ): Promise<VerificationResult> {
    const { payload } = this.#parseEffect(effect);
    const predicate = this.#parseEffect(effect).verification;
    const actual = await this.#commitPort.readEvent(payload.eventId);
    const verified = actual?.id === predicate.expected.eventId
      && actual.start === predicate.expected.start
      && actual.end === predicate.expected.end;
    return {
      details: verified ? 'Calendar event fields match the approved effect' : 'Calendar event fields differ',
      verified,
    };
  }

  public async compensate(
    effect: Effect,
    result: CommitResult<CalendarEvent>,
    idempotencyKey: string,
  ): Promise<VerificationResult> {
    const { precondition } = this.#parseEffect(effect);
    const compensation = await this.#commitPort.compensateMove(
      precondition.before,
      result.resource.version,
      idempotencyKey,
    );
    const restored = calendarEventSchema.parse(compensation.event);
    const verified = restored.start === precondition.before.start
      && restored.end === precondition.before.end;
    return { details: verified ? 'Calendar event restored' : 'Calendar event was not restored', verified };
  }

  #parseEffect(effect: Effect): {
    payload: MoveEventEffect['payload'];
    precondition: MoveEventEffect['preconditions'][0];
    verification: MoveEventEffect['verification'];
  } {
    const parsed = moveEffectSchema.parse(effect);
    return {
      payload: parsed.payload,
      precondition: parsed.preconditions[0],
      verification: parsed.verification,
    };
  }
}
