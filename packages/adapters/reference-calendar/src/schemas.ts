import { z } from 'zod';

export const REFERENCE_CALENDAR_ADAPTER_ID = 'reference-calendar';
export const MOVE_EVENT_OPERATION = 'move-event';

export const calendarEventSchema = z.object({
  end: z.string().datetime({ offset: true }),
  id: z.string().min(1),
  start: z.string().datetime({ offset: true }),
  title: z.string().min(1),
  version: z.string().min(1),
});

export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const moveEventInputSchema = z.object({
  end: z.string().datetime({ offset: true }),
  eventId: z.string().min(1),
  start: z.string().datetime({ offset: true }),
});

export type MoveEventInput = z.infer<typeof moveEventInputSchema>;

export const moveEffectPayloadSchema = moveEventInputSchema;

export const versionPreconditionSchema = z.object({
  before: calendarEventSchema,
  kind: z.literal('VERSION_EQUALS'),
  version: z.string().min(1),
});

export const moveVerificationSchema = z.object({
  expected: z.object({
    end: z.string().datetime({ offset: true }),
    eventId: z.string().min(1),
    start: z.string().datetime({ offset: true }),
  }),
  kind: z.literal('CALENDAR_EVENT_FIELDS_EQUAL'),
});

export const moveEffectSchema = z.object({
  adapterId: z.literal(REFERENCE_CALENDAR_ADAPTER_ID),
  dependencies: z.array(z.string()).length(0),
  externalities: z.array(z.string()).length(0),
  id: z.string().min(1),
  operation: z.literal(MOVE_EVENT_OPERATION),
  payload: moveEffectPayloadSchema,
  preconditions: z.tuple([versionPreconditionSchema]),
  presentation: z.object({ summary: z.string().min(1) }),
  resourceKey: z.string().min(1),
  risk: z.literal('REVERSIBLE'),
  verification: moveVerificationSchema,
}).superRefine((effect, context) => {
  const expectedResourceKey = `${REFERENCE_CALENDAR_ADAPTER_ID}:event:${effect.payload.eventId}`;
  if (effect.resourceKey !== expectedResourceKey) {
    context.addIssue({ code: 'custom', message: 'Resource key does not match payload event' });
  }
  const precondition = effect.preconditions[0];
  if (precondition.before.id !== effect.payload.eventId) {
    context.addIssue({ code: 'custom', message: 'Observed event does not match payload event' });
  }
  if (precondition.version !== precondition.before.version) {
    context.addIssue({ code: 'custom', message: 'Precondition version does not match observed event' });
  }
  if (
    effect.verification.expected.eventId !== effect.payload.eventId
    || effect.verification.expected.start !== effect.payload.start
    || effect.verification.expected.end !== effect.payload.end
  ) {
    context.addIssue({ code: 'custom', message: 'Verification predicate does not match commit payload' });
  }
});

export type MoveEventEffect = z.infer<typeof moveEffectSchema>;

export interface CalendarMoveDiff {
  readonly after: Pick<CalendarEvent, 'end' | 'id' | 'start'>;
  readonly before: Pick<CalendarEvent, 'end' | 'id' | 'start'>;
}
