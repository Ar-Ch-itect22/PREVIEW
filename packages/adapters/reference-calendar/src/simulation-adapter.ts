import type { Effect } from '@preview/domain';
import type { SimulationAdapter, StageContext, StagedOperation } from '@preview/adapter-sdk';

import type { CalendarReadPort } from './provider.js';
import {
  calendarEventSchema,
  MOVE_EVENT_OPERATION,
  moveEffectSchema,
  moveEffectPayloadSchema,
  moveEventInputSchema,
  moveVerificationSchema,
  REFERENCE_CALENDAR_ADAPTER_ID,
  versionPreconditionSchema,
  type CalendarEvent,
  type CalendarMoveDiff,
  type MoveEventInput,
} from './schemas.js';

export class ReferenceCalendarSimulationAdapter
implements SimulationAdapter<CalendarEvent, MoveEventInput, CalendarMoveDiff> {
  public readonly adapterId = REFERENCE_CALENDAR_ADAPTER_ID;
  readonly #readPort: CalendarReadPort;

  public constructor(readPort: CalendarReadPort) {
    this.#readPort = readPort;
  }

  public read(resourceKey: string): Promise<CalendarEvent | undefined> {
    return this.#readPort.readEvent(this.#eventId(resourceKey));
  }

  public stage(
    current: CalendarEvent | undefined,
    mutation: MoveEventInput,
    context: StageContext,
  ): StagedOperation<CalendarEvent, CalendarMoveDiff> {
    const before = calendarEventSchema.parse(current);
    const input = moveEventInputSchema.parse(mutation);
    if (before.id !== input.eventId) {
      throw new Error('Move input does not match the observed Calendar event');
    }
    if (Date.parse(input.end) <= Date.parse(input.start)) {
      throw new Error('Calendar event end must be after its start');
    }

    const after = calendarEventSchema.parse({ ...before, end: input.end, start: input.start });
    const diff: CalendarMoveDiff = {
      after: { end: after.end, id: after.id, start: after.start },
      before: { end: before.end, id: before.id, start: before.start },
    };
    const effect: Effect = moveEffectSchema.parse({
      adapterId: this.adapterId,
      dependencies: [],
      externalities: [],
      id: context.effectId,
      operation: MOVE_EVENT_OPERATION,
      payload: moveEffectPayloadSchema.parse(input),
      preconditions: [versionPreconditionSchema.parse({
        before,
        kind: 'VERSION_EQUALS',
        version: before.version,
      })],
      presentation: {
        summary: `Move ${before.id} from ${before.start} to ${after.start}`,
      },
      resourceKey: this.#resourceKey(before.id),
      risk: 'REVERSIBLE',
      verification: moveVerificationSchema.parse({
        expected: { end: after.end, eventId: after.id, start: after.start },
        kind: 'CALENDAR_EVENT_FIELDS_EQUAL',
      }),
    });
    return { diff, effect, resource: after };
  }

  public renderDiff(effect: Effect): CalendarMoveDiff {
    const parsed = moveEffectSchema.parse(effect);
    const payload = parsed.payload;
    const precondition = parsed.preconditions[0];
    return {
      after: { end: payload.end, id: payload.eventId, start: payload.start },
      before: {
        end: precondition.before.end,
        id: precondition.before.id,
        start: precondition.before.start,
      },
    };
  }

  #eventId(resourceKey: string): string {
    const prefix = `${this.adapterId}:event:`;
    if (!resourceKey.startsWith(prefix)) {
      throw new Error(`Invalid Reference Calendar resource key: ${resourceKey}`);
    }
    return resourceKey.slice(prefix.length);
  }

  #resourceKey(eventId: string): string {
    return `${this.adapterId}:event:${eventId}`;
  }
}
