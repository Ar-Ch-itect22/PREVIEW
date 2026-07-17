import type { FunctionTool } from 'openai/resources/responses/responses';
import { z } from 'zod';

export const CALENDAR_READ_EVENT_TOOL = 'calendar_read_event';
export const CALENDAR_STAGE_MOVE_TOOL = 'calendar_stage_move';
export const MAIL_READ_MESSAGE_TOOL = 'mail_read_message';
export const MAIL_STAGE_ATTENDEE_MESSAGE_TOOL = 'mail_stage_attendee_message';

export const calendarReadEventArgumentsSchema = z.object({
  eventId: z.string().min(1),
}).strict();

export const calendarStageMoveArgumentsSchema = z.object({
  end: z.string().datetime({ offset: true }),
  eventId: z.string().min(1),
  start: z.string().datetime({ offset: true }),
}).strict();

export const mailReadMessageArgumentsSchema = z.object({
  messageId: z.string().min(1),
}).strict();

export const mailStageAttendeeMessageArgumentsSchema = z.object({
  calendarEventId: z.string().min(1),
  messageId: z.string().min(1),
  recipients: z.array(z.string().email()).min(1).refine(
    (recipients) => new Set(recipients).size === recipients.length,
    'Recipients must be unique',
  ),
}).strict();

const singleIdentifierParameters = (property: 'eventId' | 'messageId') => ({
  additionalProperties: false,
  properties: {
    [property]: { type: 'string' },
  },
  required: [property],
  type: 'object',
});

export const PREVIEW_SIMULATION_TOOLS: readonly FunctionTool[] = Object.freeze([
  {
    description: 'Read one Reference Calendar event through the active PREVIEW simulation revision.',
    name: CALENDAR_READ_EVENT_TOOL,
    parameters: singleIdentifierParameters('eventId'),
    strict: true,
    type: 'function',
  },
  {
    description: 'Stage a Reference Calendar event move in the PREVIEW shadow revision. This never changes the provider.',
    name: CALENDAR_STAGE_MOVE_TOOL,
    parameters: {
      additionalProperties: false,
      properties: {
        end: { format: 'date-time', type: 'string' },
        eventId: { type: 'string' },
        start: { format: 'date-time', type: 'string' },
      },
      required: ['end', 'eventId', 'start'],
      type: 'object',
    },
    strict: true,
    type: 'function',
  },
  {
    description: 'Read one Reference Mail message through the active PREVIEW simulation revision.',
    name: MAIL_READ_MESSAGE_TOOL,
    parameters: singleIdentifierParameters('messageId'),
    strict: true,
    type: 'function',
  },
  {
    description: 'Stage an attendee message derived from a reread staged Calendar event. Subject and body are generated deterministically by PREVIEW; this never delivers mail.',
    name: MAIL_STAGE_ATTENDEE_MESSAGE_TOOL,
    parameters: {
      additionalProperties: false,
      properties: {
        calendarEventId: { type: 'string' },
        messageId: { type: 'string' },
        recipients: {
          items: { format: 'email', type: 'string' },
          minItems: 1,
          type: 'array',
        },
      },
      required: ['calendarEventId', 'messageId', 'recipients'],
      type: 'object',
    },
    strict: true,
    type: 'function',
  },
]);

export type PreviewSimulationToolName =
  | typeof CALENDAR_READ_EVENT_TOOL
  | typeof CALENDAR_STAGE_MOVE_TOOL
  | typeof MAIL_READ_MESSAGE_TOOL
  | typeof MAIL_STAGE_ATTENDEE_MESSAGE_TOOL;
