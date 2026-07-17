import type { GoogleApiTransport } from '@preview/google-common';
import { z } from 'zod';

import {
  googleCalendarEventSchema,
  type GoogleCalendarEvent,
  type GoogleCalendarMoveInput,
} from './schemas.js';

const apiEventSchema = z.object({
  attendees: z.array(z.unknown()).max(0).optional(),
  end: z.object({ dateTime: z.string().datetime({ offset: true }), timeZone: z.string().optional() }),
  etag: z.string().min(1),
  extendedProperties: z.object({
    private: z.record(z.string(), z.string()).optional(),
  }).optional(),
  id: z.string().min(1),
  eventType: z.literal('default').optional(),
  organizer: z.object({ self: z.literal(true) }),
  recurringEventId: z.string().optional(),
  start: z.object({ dateTime: z.string().datetime({ offset: true }), timeZone: z.string().optional() }),
  status: z.literal('confirmed'),
  summary: z.string().min(1),
});

export interface GoogleCalendarCommitResult {
  readonly applied: boolean;
  readonly event: GoogleCalendarEvent;
}

export interface GoogleCalendarReadPort {
  readEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent | undefined>;
}

export interface GoogleCalendarCommitPort extends GoogleCalendarReadPort {
  commitMove(
    input: GoogleCalendarMoveInput,
    before: GoogleCalendarEvent,
    idempotencyKey: string,
  ): Promise<GoogleCalendarCommitResult>;
  compensateMove(
    before: GoogleCalendarEvent,
    expectedVersion: string,
    idempotencyKey: string,
  ): Promise<GoogleCalendarCommitResult>;
  reconcileMove(
    calendarId: string,
    eventId: string,
    idempotencyKey: string,
  ): Promise<GoogleCalendarCommitResult | undefined>;
  reconcileCompensation(
    before: GoogleCalendarEvent,
    idempotencyKey: string,
  ): Promise<GoogleCalendarCommitResult | undefined>;
}

export class GoogleCalendarProvider implements GoogleCalendarCommitPort {
  readonly #transport: GoogleApiTransport;

  public constructor(transport: GoogleApiTransport) {
    this.#transport = transport;
  }

  public async readEvent(
    calendarId: string,
    eventId: string,
  ): Promise<GoogleCalendarEvent | undefined> {
    try {
      const event = await this.#transport.request({
        method: 'GET',
        parse: (value) => apiEventSchema.parse(value),
        url: this.#eventUrl(calendarId, eventId),
      });
      return this.#toResource(calendarId, event);
    } catch (error) {
      if (isGoogleNotFound(error)) return undefined;
      throw error;
    }
  }

  public async commitMove(
    input: GoogleCalendarMoveInput,
    before: GoogleCalendarEvent,
    idempotencyKey: string,
  ): Promise<GoogleCalendarCommitResult> {
    const event = await this.#patch(
      input.calendarId,
      input.eventId,
      before.version,
      {
        end: { dateTime: input.end, ...(before.endTimeZone === undefined ? {} : { timeZone: before.endTimeZone }) },
        extendedProperties: {
          private: { ...before.privateExtendedProperties, previewCommit: idempotencyKey },
        },
        start: { dateTime: input.start, ...(before.startTimeZone === undefined ? {} : { timeZone: before.startTimeZone }) },
      },
    );
    return { applied: true, event };
  }

  public async compensateMove(
    before: GoogleCalendarEvent,
    expectedVersion: string,
    idempotencyKey: string,
  ): Promise<GoogleCalendarCommitResult> {
    const event = await this.#patch(before.calendarId, before.id, expectedVersion, {
      end: { dateTime: before.end, ...(before.endTimeZone === undefined ? {} : { timeZone: before.endTimeZone }) },
      extendedProperties: {
        private: {
          ...before.privateExtendedProperties,
          previewCommit: null,
          previewCompensation: idempotencyKey,
        },
      },
      start: { dateTime: before.start, ...(before.startTimeZone === undefined ? {} : { timeZone: before.startTimeZone }) },
    });
    return { applied: true, event };
  }

  public async reconcileMove(
    calendarId: string,
    eventId: string,
    idempotencyKey: string,
  ): Promise<GoogleCalendarCommitResult | undefined> {
    const event = await this.readEvent(calendarId, eventId);
    return event?.privateExtendedProperties.previewCommit === idempotencyKey
      ? { applied: false, event }
      : undefined;
  }

  public async reconcileCompensation(
    before: GoogleCalendarEvent,
    idempotencyKey: string,
  ): Promise<GoogleCalendarCommitResult | undefined> {
    const event = await this.readEvent(before.calendarId, before.id);
    return event?.privateExtendedProperties.previewCompensation === idempotencyKey
      ? { applied: false, event }
      : undefined;
  }

  async #patch(
    calendarId: string,
    eventId: string,
    expectedVersion: string,
    body: unknown,
  ): Promise<GoogleCalendarEvent> {
    const event = await this.#transport.request({
      body,
      headers: { 'If-Match': expectedVersion },
      method: 'PATCH',
      parse: (value) => apiEventSchema.parse(value),
      url: `${this.#eventUrl(calendarId, eventId)}?sendUpdates=none`,
    });
    return this.#toResource(calendarId, event);
  }

  #toResource(calendarId: string, event: z.infer<typeof apiEventSchema>): GoogleCalendarEvent {
    if (event.recurringEventId !== undefined) {
      throw new TypeError('Recurring Google Calendar event instances are not certified');
    }
    return googleCalendarEventSchema.parse({
      calendarId,
      end: event.end.dateTime,
      endTimeZone: event.end.timeZone,
      id: event.id,
      privateExtendedProperties: event.extendedProperties?.private ?? {},
      start: event.start.dateTime,
      startTimeZone: event.start.timeZone,
      title: event.summary,
      version: event.etag,
    });
  }

  #eventUrl(calendarId: string, eventId: string): string {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  }
}

function isGoogleNotFound(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 404;
}
