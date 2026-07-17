import { z } from 'zod';

export const GOOGLE_CALENDAR_ADAPTER_ID = 'google-calendar';
export const GOOGLE_CALENDAR_MOVE_OPERATION = 'move-event';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';

export const googleCalendarEventSchema = z.object({
  calendarId: z.string().min(1),
  end: z.string().datetime({ offset: true }),
  endTimeZone: z.string().min(1).optional(),
  id: z.string().min(1),
  privateExtendedProperties: z.record(z.string(), z.string()),
  start: z.string().datetime({ offset: true }),
  startTimeZone: z.string().min(1).optional(),
  title: z.string().min(1),
  version: z.string().min(1),
});

export type GoogleCalendarEvent = z.infer<typeof googleCalendarEventSchema>;

export const googleCalendarMoveInputSchema = z.object({
  calendarId: z.string().min(1),
  end: z.string().datetime({ offset: true }),
  eventId: z.string().min(1),
  start: z.string().datetime({ offset: true }),
});

export type GoogleCalendarMoveInput = z.infer<typeof googleCalendarMoveInputSchema>;

export const googleCalendarMoveEffectSchema = z.object({
  adapterId: z.literal(GOOGLE_CALENDAR_ADAPTER_ID),
  dependencies: z.array(z.string()).length(0),
  externalities: z.tuple([z.literal('GOOGLE_CALENDAR_EVENT_HISTORY_PERSISTS')]),
  id: z.string().min(1),
  operation: z.literal(GOOGLE_CALENDAR_MOVE_OPERATION),
  payload: googleCalendarMoveInputSchema,
  preconditions: z.tuple([z.object({
    before: googleCalendarEventSchema,
    kind: z.literal('VERSION_EQUALS'),
    version: z.string().min(1),
  })]),
  presentation: z.object({ summary: z.string().min(1) }),
  resourceKey: z.string().min(1),
  risk: z.literal('COMPENSABLE'),
  verification: z.object({
    expected: googleCalendarMoveInputSchema,
    kind: z.literal('GOOGLE_CALENDAR_EVENT_FIELDS_EQUAL'),
  }),
}).superRefine((effect, context) => {
  const expectedKey = googleCalendarResourceKey(effect.payload.calendarId, effect.payload.eventId);
  const before = effect.preconditions[0].before;
  if (effect.resourceKey !== expectedKey) {
    context.addIssue({ code: 'custom', message: 'Google Calendar resource key does not match payload' });
  }
  if (
    before.calendarId !== effect.payload.calendarId
    || before.id !== effect.payload.eventId
    || effect.preconditions[0].version !== before.version
  ) {
    context.addIssue({ code: 'custom', message: 'Google Calendar precondition does not match payload' });
  }
  if (JSON.stringify(effect.verification.expected) !== JSON.stringify(effect.payload)) {
    context.addIssue({ code: 'custom', message: 'Google Calendar verification does not match payload' });
  }
});

export type GoogleCalendarMoveEffect = z.infer<typeof googleCalendarMoveEffectSchema>;

export interface GoogleCalendarMoveDiff {
  readonly after: Pick<GoogleCalendarEvent, 'calendarId' | 'end' | 'id' | 'start'>;
  readonly before: Pick<GoogleCalendarEvent, 'calendarId' | 'end' | 'id' | 'start'>;
}

export function googleCalendarResourceKey(calendarId: string, eventId: string): string {
  return `${GOOGLE_CALENDAR_ADAPTER_ID}:event/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`;
}

export function parseGoogleCalendarResourceKey(resourceKey: string): {
  readonly calendarId: string;
  readonly eventId: string;
} {
  const prefix = `${GOOGLE_CALENDAR_ADAPTER_ID}:event/`;
  if (!resourceKey.startsWith(prefix)) throw new TypeError('Invalid Google Calendar resource key');
  const segments = resourceKey.slice(prefix.length).split('/');
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
    throw new TypeError('Invalid Google Calendar resource key');
  }
  return {
    calendarId: decodeURIComponent(segments[0] ?? ''),
    eventId: decodeURIComponent(segments[1] ?? ''),
  };
}
