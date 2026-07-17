import {
  assertCommitLifecycle,
  assertDeterministicSimulation,
  assertObservationConformance,
  assertUnknownWriteFailsClosed,
} from '@preview/adapter-testkit';
import { DefinitelyNotAppliedError } from '@preview/adapter-sdk';
import { computeCanonicalDigest, createSnapshotManifest } from '@preview/domain';
import {
  GoogleApiError,
  GoogleTransportError,
  type GoogleApiRequest,
  type GoogleApiTransport,
} from '@preview/google-common';
import { describe, expect, it } from 'vitest';

import {
  GoogleCalendarCommitAdapter,
  GoogleCalendarProvider,
  GoogleCalendarSimulationAdapter,
  googleCalendarResourceKey,
} from '../src/index.js';

const BASE = {
  attendees: [],
  end: { dateTime: '2026-07-20T10:30:00+05:30', timeZone: 'Asia/Kolkata' },
  etag: '"v1"',
  eventType: 'default',
  extendedProperties: { private: {} as Record<string, string> },
  id: 'event-1',
  organizer: { self: true },
  start: { dateTime: '2026-07-20T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
  status: 'confirmed',
  summary: 'Synthetic PREVIEW fixture',
};

class CalendarTransport implements GoogleApiTransport {
  public event: Record<string, unknown> = structuredClone(BASE);
  public mutations = 0;
  public requests: GoogleApiRequest<unknown>[] = [];
  public failAfterApply = false;

  public async request<T>(request: GoogleApiRequest<T>): Promise<T> {
    await Promise.resolve();
    this.requests.push(request);
    if (request.method === 'GET') return request.parse(structuredClone(this.event));
    if (request.method !== 'PATCH') throw new GoogleApiError(405, 'unsupported');
    if (request.headers?.['If-Match'] !== this.event.etag) throw new GoogleApiError(412, 'etag drift');
    const body = request.body as {
      readonly end: unknown;
      readonly extendedProperties: { readonly private: Readonly<Record<string, string | null>> };
      readonly start: unknown;
    };
    const priorPrivate = (this.event.extendedProperties as { private: Record<string, string> }).private;
    const removed = new Set(Object.entries(body.extendedProperties.private)
      .filter(([, value]) => value === null)
      .map(([key]) => key));
    const privateProperties: Record<string, string> = {
      ...Object.fromEntries(Object.entries(priorPrivate).filter(([key]) => !removed.has(key))),
      ...Object.fromEntries(Object.entries(body.extendedProperties.private)
        .filter((entry): entry is [string, string] => entry[1] !== null)),
    };
    this.mutations += 1;
    this.event = {
      ...this.event,
      end: body.end,
      etag: `"v${String(this.mutations + 1)}"`,
      extendedProperties: { private: privateProperties },
      start: body.start,
    };
    if (this.failAfterApply) {
      this.failAfterApply = false;
      throw new GoogleTransportError('connection dropped after apply');
    }
    return request.parse(structuredClone(this.event));
  }
}

async function fixture() {
  const transport = new CalendarTransport();
  const provider = new GoogleCalendarProvider(transport);
  const simulation = new GoogleCalendarSimulationAdapter(provider);
  const commit = new GoogleCalendarCommitAdapter(provider);
  const current = await simulation.read(googleCalendarResourceKey('primary', 'event-1'));
  if (current === undefined) throw new Error('fixture event missing');
  const effect = assertDeterministicSimulation({
    adapter: simulation,
    context: { dependencies: [], effectId: 'calendar-move-1' },
    current,
    mutation: {
      calendarId: 'primary',
      end: '2026-07-20T12:00:00+05:30',
      eventId: 'event-1',
      start: '2026-07-20T11:30:00+05:30',
    },
  });
  return { commit, current, effect, simulation, transport };
}

describe('Google Calendar certified adapter', () => {
  it('stages deterministically without provider mutation and binds compensable history residuals', async () => {
    const { effect, simulation, transport } = await fixture();
    expect(transport.mutations).toBe(0);
    expect(effect.risk).toBe('COMPENSABLE');
    expect(effect.externalities).toEqual(['GOOGLE_CALENDAR_EVENT_HISTORY_PERSISTS']);
    expect(simulation.renderDiff(effect)).toEqual({
      after: {
        calendarId: 'primary',
        end: '2026-07-20T12:00:00+05:30',
        id: 'event-1',
        start: '2026-07-20T11:30:00+05:30',
      },
      before: {
        calendarId: 'primary',
        end: '2026-07-20T10:30:00+05:30',
        id: 'event-1',
        start: '2026-07-20T10:00:00+05:30',
      },
    });
  });

  it('commits exactly once, verifies, reconciles, and compensates with declared residuals', async () => {
    const { commit, effect, transport } = await fixture();
    await assertCommitLifecycle({
      adapter: commit,
      effect,
      idempotencyKey: 'run:calendar:commit',
      mutationCount: () => transport.mutations,
    });
    const patch = transport.requests.find((request) => request.method === 'PATCH');
    expect(patch?.headers).toEqual({ 'If-Match': '"v1"' });
    expect(patch?.url.endsWith('?sendUpdates=none')).toBe(true);
    expect(patch?.body).toEqual({
      end: { dateTime: '2026-07-20T12:00:00+05:30', timeZone: 'Asia/Kolkata' },
      extendedProperties: { private: { previewCommit: 'run:calendar:commit' } },
      start: { dateTime: '2026-07-20T11:30:00+05:30', timeZone: 'Asia/Kolkata' },
    });
    const reconciled = await commit.reconcileCommit(effect, 'run:calendar:commit');
    if (reconciled.status !== 'APPLIED') throw new Error('expected applied reconciliation');
    const compensation = await commit.compensate(effect, reconciled.result, 'run:calendar:compensate');
    expect(compensation).toEqual({
      details: 'Google Calendar event fields restored',
      residuals: ['Google Calendar update metadata and provider revision history remain changed'],
      verified: true,
    });
    expect(transport.mutations).toBe(2);
  });

  it('reconciles a timeout after apply without issuing a second mutation', async () => {
    const { commit, effect, transport } = await fixture();
    transport.failAfterApply = true;
    await expect(commit.commit(effect, 'run:ambiguous')).rejects.toThrow('ambiguous');
    const outcome = await commit.reconcileCommit(effect, 'run:ambiguous');
    expect(outcome.status).toBe('APPLIED');
    expect(transport.mutations).toBe(1);
  });

  it('refuses compensation and applied reconciliation after post-commit event drift', async () => {
    const { commit, effect, transport } = await fixture();
    const applied = await commit.commit(effect, 'run:drift-after-commit');
    transport.event = {
      ...transport.event,
      etag: '"external-v3"',
      start: { dateTime: '2026-07-20T13:00:00+05:30', timeZone: 'Asia/Kolkata' },
    };
    expect(await commit.reconcileCommit(effect, 'run:drift-after-commit')).toMatchObject({ status: 'UNKNOWN' });
    await expect(commit.compensate(effect, applied, 'run:drift-after-commit:compensate'))
      .rejects.toBeInstanceOf(DefinitelyNotAppliedError);
    expect(transport.mutations).toBe(1);
  });

  it('performs observation preflight and fails closed on drift and unknown writes', async () => {
    const { commit, current, effect, transport } = await fixture();
    const snapshot = createSnapshotManifest([{
      adapterId: 'google-calendar',
      observedAt: '2026-07-17T10:00:00+05:30',
      presence: 'PRESENT',
      resourceKey: googleCalendarResourceKey('primary', 'event-1'),
      valueDigest: computeCanonicalDigest(current),
      version: current.version,
    }]);
    const observation = snapshot.observations[0];
    if (observation === undefined) throw new Error('fixture observation missing');
    await assertObservationConformance({ adapter: commit, observation });
    transport.event = { ...transport.event, etag: '"drift"' };
    expect(await commit.revalidate(effect)).toMatchObject({ status: 'DRIFTED' });
    await expect(commit.commit(effect, 'run:drift')).rejects.toBeInstanceOf(DefinitelyNotAppliedError);
    await assertUnknownWriteFailsClosed({
      adapter: commit,
      effect: { ...effect, operation: 'delete-everything' },
      mutationCount: () => transport.mutations,
    });
    expect(transport.mutations).toBe(0);
  });

  it('rejects all-day, recurring, attendee, special, and non-owned events', async () => {
    for (const invalid of [
      { ...BASE, start: { date: '2026-07-20' } },
      { ...BASE, recurringEventId: 'series-1' },
      { ...BASE, attendees: [{ email: 'guest@example.test' }] },
      { ...BASE, eventType: 'outOfOffice' },
      { ...BASE, organizer: { self: false } },
    ]) {
      const transport = new CalendarTransport();
      transport.event = invalid;
      const provider = new GoogleCalendarProvider(transport);
      await expect(provider.readEvent('primary', 'event-1')).rejects.toThrow();
      expect(transport.mutations).toBe(0);
    }
  });
});
