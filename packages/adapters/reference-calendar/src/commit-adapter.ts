import type {
  CommitAdapter,
  CommitResult,
  RevalidationResult,
  VerificationResult,
} from '@preview/adapter-sdk';
import type { Effect } from '@preview/domain';

import type { CalendarCommitPort } from './provider.js';
import {
  calendarEventSchema,
  moveEffectSchema,
  type MoveEventEffect,
  type CalendarEvent,
} from './schemas.js';
import { REFERENCE_CALENDAR_ADAPTER_ID } from './schemas.js';

export class ReferenceCalendarCommitAdapter implements CommitAdapter<CalendarEvent> {
  public readonly adapterId = REFERENCE_CALENDAR_ADAPTER_ID;
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
  ): Promise<VerificationResult> {
    const { precondition } = this.#parseEffect(effect);
    const compensation = await this.#commitPort.compensateMove(
      precondition.before,
      `compensate:${effect.id}`,
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
