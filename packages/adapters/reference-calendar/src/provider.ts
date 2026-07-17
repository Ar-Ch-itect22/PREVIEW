import { createHash } from 'node:crypto';

import { DefinitelyNotAppliedError } from '@preview/adapter-sdk';

import { calendarEventSchema, type CalendarEvent, type MoveEventInput } from './schemas.js';

export interface CalendarReadPort {
  readEvent(eventId: string): Promise<CalendarEvent | undefined>;
}

export interface CalendarProviderCommitResult {
  readonly applied: boolean;
  readonly event: CalendarEvent;
}

export interface CalendarCommitPort extends CalendarReadPort {
  commitMove(
    input: MoveEventInput,
    expectedVersion: string,
    idempotencyKey: string,
  ): Promise<CalendarProviderCommitResult>;
  compensateMove(
    before: CalendarEvent,
    expectedVersion: string,
    idempotencyKey: string,
  ): Promise<CalendarProviderCommitResult>;
  reconcile(idempotencyKey: string): Promise<CalendarProviderCommitResult | undefined>;
}

interface StoredAttempt {
  readonly fingerprint: string;
  readonly result: CalendarProviderCommitResult;
}

export class InMemoryReferenceCalendarProvider {
  readonly #attempts = new Map<string, StoredAttempt>();
  readonly #events = new Map<string, CalendarEvent>();
  #mutationCount = 0;

  public constructor(events: readonly CalendarEvent[]) {
    for (const event of events) {
      const parsed = calendarEventSchema.parse(event);
      this.#events.set(parsed.id, structuredClone(parsed));
    }
  }

  public createReadPort(): CalendarReadPort {
    return Object.freeze({
      readEvent: (eventId: string) => Promise.resolve(this.#readEvent(eventId)),
    });
  }

  public createCommitPort(): CalendarCommitPort {
    return Object.freeze({
      commitMove: (input: MoveEventInput, expectedVersion: string, idempotencyKey: string) =>
        Promise.resolve(this.#commitMove(input, expectedVersion, idempotencyKey)),
      compensateMove: (before: CalendarEvent, expectedVersion: string, idempotencyKey: string) =>
        Promise.resolve(this.#compensateMove(before, expectedVersion, idempotencyKey)),
      readEvent: (eventId: string) => Promise.resolve(this.#readEvent(eventId)),
      reconcile: (idempotencyKey: string) => Promise.resolve(this.#reconcile(idempotencyKey)),
    });
  }

  public get mutationCount(): number {
    return this.#mutationCount;
  }

  public snapshotBytes(): Buffer {
    const events = [...this.#events.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((event) => structuredClone(event));
    return Buffer.from(JSON.stringify(events), 'utf8');
  }

  #readEvent(eventId: string): CalendarEvent | undefined {
    const event = this.#events.get(eventId);
    return event === undefined ? undefined : structuredClone(event);
  }

  #commitMove(
    input: MoveEventInput,
    expectedVersion: string,
    idempotencyKey: string,
  ): CalendarProviderCommitResult {
    const fingerprint = this.#fingerprint({ input, expectedVersion, operation: 'move' });
    const previous = this.#attempts.get(idempotencyKey);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error('Idempotency key was reused with different Calendar content');
      }
      return { applied: false, event: structuredClone(previous.result.event) };
    }

    const current = this.#events.get(input.eventId);
    if (current === undefined) {
      throw new DefinitelyNotAppliedError(`Calendar event not found: ${input.eventId}`);
    }
    if (current.version !== expectedVersion) {
      throw new DefinitelyNotAppliedError('Calendar event version drifted before mutation');
    }
    const next = calendarEventSchema.parse({
      ...current,
      end: input.end,
      start: input.start,
      version: this.#nextVersion(current.version),
    });
    this.#events.set(next.id, structuredClone(next));
    this.#mutationCount += 1;
    const result = { applied: true, event: structuredClone(next) };
    this.#attempts.set(idempotencyKey, { fingerprint, result: structuredClone(result) });
    return result;
  }

  #compensateMove(
    before: CalendarEvent,
    expectedVersion: string,
    idempotencyKey: string,
  ): CalendarProviderCommitResult {
    const fingerprint = this.#fingerprint({ before, expectedVersion, operation: 'compensate' });
    const previous = this.#attempts.get(idempotencyKey);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error('Idempotency key was reused with different compensation content');
      }
      return { applied: false, event: structuredClone(previous.result.event) };
    }
    const current = this.#events.get(before.id);
    if (current === undefined) {
      throw new DefinitelyNotAppliedError(`Calendar event not found: ${before.id}`);
    }
    if (current.version !== expectedVersion) {
      throw new DefinitelyNotAppliedError('Calendar event drifted after commit; compensation refused');
    }
    const restored = calendarEventSchema.parse({
      ...before,
      version: this.#nextVersion(current.version),
    });
    this.#events.set(restored.id, structuredClone(restored));
    this.#mutationCount += 1;
    const result = { applied: true, event: structuredClone(restored) };
    this.#attempts.set(idempotencyKey, { fingerprint, result: structuredClone(result) });
    return result;
  }

  #reconcile(idempotencyKey: string): CalendarProviderCommitResult | undefined {
    const attempt = this.#attempts.get(idempotencyKey);
    if (attempt === undefined) {
      return undefined;
    }
    return { applied: false, event: structuredClone(attempt.result.event) };
  }

  #fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  #nextVersion(version: string): string {
    const numeric = Number.parseInt(version.replace(/^v/u, ''), 10);
    return `v${String(Number.isNaN(numeric) ? 1 : numeric + 1)}`;
  }
}
