import type { SimulationAdapter, StageContext, StagedOperation } from '@preview/adapter-sdk';
import type { Effect } from '@preview/domain';

import type { GoogleCalendarReadPort } from './provider.js';
import {
  GOOGLE_CALENDAR_ADAPTER_ID,
  GOOGLE_CALENDAR_MOVE_OPERATION,
  googleCalendarEventSchema,
  googleCalendarMoveEffectSchema,
  googleCalendarMoveInputSchema,
  googleCalendarResourceKey,
  parseGoogleCalendarResourceKey,
  type GoogleCalendarEvent,
  type GoogleCalendarMoveDiff,
  type GoogleCalendarMoveInput,
} from './schemas.js';

export class GoogleCalendarSimulationAdapter implements
SimulationAdapter<GoogleCalendarEvent, GoogleCalendarMoveInput, GoogleCalendarMoveDiff> {
  public readonly adapterId = GOOGLE_CALENDAR_ADAPTER_ID;
  readonly #port: GoogleCalendarReadPort;

  public constructor(port: GoogleCalendarReadPort) {
    this.#port = port;
  }

  public read(resourceKey: string): Promise<GoogleCalendarEvent | undefined> {
    const parsed = parseGoogleCalendarResourceKey(resourceKey);
    return this.#port.readEvent(parsed.calendarId, parsed.eventId);
  }

  public stage(
    current: GoogleCalendarEvent | undefined,
    mutation: GoogleCalendarMoveInput,
    context: StageContext,
  ): StagedOperation<GoogleCalendarEvent, GoogleCalendarMoveDiff> {
    const before = googleCalendarEventSchema.parse(current);
    const input = googleCalendarMoveInputSchema.parse(mutation);
    if (before.calendarId !== input.calendarId || before.id !== input.eventId) {
      throw new TypeError('Google Calendar mutation does not match observed event');
    }
    if (Date.parse(input.end) <= Date.parse(input.start)) {
      throw new TypeError('Google Calendar event end must be after start');
    }
    const resource = googleCalendarEventSchema.parse({ ...before, end: input.end, start: input.start });
    const effect: Effect = googleCalendarMoveEffectSchema.parse({
      adapterId: this.adapterId,
      dependencies: [],
      externalities: ['GOOGLE_CALENDAR_EVENT_HISTORY_PERSISTS'],
      id: context.effectId,
      operation: GOOGLE_CALENDAR_MOVE_OPERATION,
      payload: input,
      preconditions: [{ before, kind: 'VERSION_EQUALS', version: before.version }],
      presentation: { summary: `Move Google Calendar event ${before.id} to ${input.start}` },
      resourceKey: googleCalendarResourceKey(before.calendarId, before.id),
      risk: 'COMPENSABLE',
      verification: { expected: input, kind: 'GOOGLE_CALENDAR_EVENT_FIELDS_EQUAL' },
    });
    return { diff: this.renderDiff(effect), effect, resource };
  }

  public renderDiff(effect: Effect): GoogleCalendarMoveDiff {
    const parsed = googleCalendarMoveEffectSchema.parse(effect);
    const before = parsed.preconditions[0].before;
    return {
      after: {
        calendarId: parsed.payload.calendarId,
        end: parsed.payload.end,
        id: parsed.payload.eventId,
        start: parsed.payload.start,
      },
      before: { calendarId: before.calendarId, end: before.end, id: before.id, start: before.start },
    };
  }
}
