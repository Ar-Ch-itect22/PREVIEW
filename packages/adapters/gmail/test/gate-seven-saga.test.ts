import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeEffectGraphDigest, ContentBoundApprovalAuthority } from '@preview/approval';
import {
  computeCanonicalDigest,
  createSnapshotManifest,
  simulationRevisionSchema,
} from '@preview/domain';
import {
  GoogleCalendarCommitAdapter,
  GoogleCalendarProvider,
  GoogleCalendarSimulationAdapter,
  googleCalendarResourceKey,
} from '@preview/google-calendar';
import { GoogleApiError, type GoogleApiRequest, type GoogleApiTransport } from '@preview/google-common';
import { FileSagaStore } from '@preview/persistence';
import { eraseDurableCommitAdapter, executeDurableSaga } from '@preview/worker';
import { describe, expect, it } from 'vitest';

import {
  GmailCommitAdapter,
  GmailProvider,
  GmailSimulationAdapter,
  gmailResourceKey,
} from '../src/index.js';

class WorkspaceTransport implements GoogleApiTransport {
  public calendarMutations = 0;
  public gmailMutations = 0;
  public calendarEvent: Record<string, unknown> = {
    attendees: [],
    end: { dateTime: '2026-07-20T10:30:00+05:30', timeZone: 'Asia/Kolkata' },
    etag: '"v1"',
    eventType: 'default',
    extendedProperties: { private: {} },
    id: 'event-1',
    organizer: { self: true },
    start: { dateTime: '2026-07-20T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
    status: 'confirmed',
    summary: 'Gate 7 synthetic event',
  };
  readonly #messages = new Map<string, { historyId: string; id: string; labelIds: string[]; raw: string }>();

  public async request<T>(request: GoogleApiRequest<T>): Promise<T> {
    await Promise.resolve();
    const url = new URL(request.url);
    if (url.hostname === 'www.googleapis.com') {
      if (request.method === 'GET') return request.parse(structuredClone(this.calendarEvent));
      if (request.method !== 'PATCH') throw new GoogleApiError(405, 'unsupported calendar request');
      if (request.headers?.['If-Match'] !== this.calendarEvent.etag) throw new GoogleApiError(412, 'drift');
      const body = request.body as {
        end: unknown;
        extendedProperties: { private: Record<string, string> };
        start: unknown;
      };
      this.calendarMutations += 1;
      this.calendarEvent = {
        ...this.calendarEvent,
        end: body.end,
        etag: `"v${String(this.calendarMutations + 1)}"`,
        extendedProperties: { private: body.extendedProperties.private },
        start: body.start,
      };
      return request.parse(structuredClone(this.calendarEvent));
    }
    if (url.pathname.endsWith('/profile')) return request.parse({ emailAddress: 'sender@example.test' });
    if (request.method === 'GET' && url.pathname.endsWith('/messages')) {
      return request.parse({ messages: [...this.#messages.values()].map(({ id }) => ({ id })) });
    }
    const messageMatch = /\/messages\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'GET' && messageMatch !== null) {
      const message = this.#messages.get(decodeURIComponent(messageMatch[1] ?? ''));
      if (message === undefined) throw new GoogleApiError(404, 'missing message');
      return request.parse(structuredClone(message));
    }
    if (request.method === 'POST' && url.pathname.endsWith('/messages/send')) {
      const id = `message-${String(this.gmailMutations + 1)}`;
      this.gmailMutations += 1;
      this.#messages.set(id, {
        historyId: String(this.gmailMutations),
        id,
        labelIds: ['SENT'],
        raw: (request.body as { raw: string }).raw,
      });
      return request.parse({ historyId: String(this.gmailMutations), id });
    }
    throw new GoogleApiError(405, `unsupported Gmail request ${request.method} ${url.pathname}`);
  }
}

describe('Gate 7 durable Google Workspace path', () => {
  it('preflights a content-bound graph, mutates Calendar then Gmail once, and verifies through the durable saga', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preview-gate7-saga-'));
    try {
      const transport = new WorkspaceTransport();
      const calendarProvider = new GoogleCalendarProvider(transport);
      const gmailProvider = new GmailProvider(transport);
      const calendarSimulation = new GoogleCalendarSimulationAdapter(calendarProvider);
      const gmailSimulation = new GmailSimulationAdapter(gmailProvider);
      const calendarBefore = await calendarSimulation.read(googleCalendarResourceKey('primary', 'event-1'));
      if (calendarBefore === undefined) throw new Error('calendar fixture missing');
      const calendar = calendarSimulation.stage(calendarBefore, {
        calendarId: 'primary',
        end: '2026-07-20T12:00:00+05:30',
        eventId: 'event-1',
        start: '2026-07-20T11:30:00+05:30',
      }, { dependencies: [], effectId: 'calendar-move' });
      const gmail = gmailSimulation.stage(undefined, {
        from: 'sender@example.test',
        logicalId: 'calendar-notice-1',
        operation: 'send-message-exact',
        recipients: ['recipient@example.test'],
        subject: 'Updated event time',
        textBody: `The approved new event start is ${calendar.resource.start}.`,
      }, {
        dependencies: [{
          effectId: calendar.effect.id,
          resource: calendar.resource,
          resourceKey: calendar.effect.resourceKey,
        }],
        effectId: 'gmail-send',
      });
      const graph = { effects: [calendar.effect, gmail.effect], version: 1 as const };
      const snapshot = createSnapshotManifest([
        {
          adapterId: 'google-calendar',
          observedAt: '2026-07-17T00:00:00.000Z',
          presence: 'PRESENT',
          resourceKey: calendar.effect.resourceKey,
          valueDigest: computeCanonicalDigest(calendarBefore),
          version: calendarBefore.version,
        },
        {
          adapterId: 'gmail',
          observedAt: '2026-07-17T00:00:00.000Z',
          presence: 'ABSENT',
          resourceKey: gmailResourceKey('message', 'calendar-notice-1'),
          valueDigest: null,
          version: null,
        },
      ]);
      const revision = simulationRevisionSchema.parse({
        baseSnapshotDigest: snapshot.digest,
        baseSnapshotId: 'gate7-snapshot',
        effectGraph: graph,
        graphDigest: computeEffectGraphDigest(graph),
        id: 'gate7-revision',
        replayOfRevisionId: null,
        revisionNumber: 1,
        status: 'SEALED',
        structuredConstraints: [],
        transactionId: 'gate7-transaction',
      });
      const authority = new ContentBoundApprovalAuthority('gate-seven-signing-key');
      const approvalContext = {
        adapterVersions: { gmail: '1.0.0', 'google-calendar': '1.0.0' },
        approverId: 'aru',
        policyVersions: { transaction: 'gate-7' },
        snapshot,
        tenantId: 'tenant-1',
      };
      const approval = authority.approve(revision, {
        ...approvalContext,
        expiresAt: '2026-07-20T00:00:00.000Z',
      });
      const receipt = await executeDurableSaga({
        adapters: [
          eraseDurableCommitAdapter(new GoogleCalendarCommitAdapter(calendarProvider)),
          eraseDurableCommitAdapter(new GmailCommitAdapter(gmailProvider)),
        ],
        authority,
        now: () => new Date('2026-07-17T00:00:00.000Z'),
        ownerId: 'gate7-worker',
        seed: {
          approval,
          approvalContext,
          authorizedAt: '2026-07-17T00:00:00.000Z',
          createdAt: '2026-07-17T00:00:00.000Z',
          revision,
          runId: 'gate7-run',
        },
        store: new FileSagaStore(directory),
      });
      if (receipt.terminalStatus !== 'COMMITTED_VERIFIED') {
        throw new Error(`Unexpected Gate 7 receipt: ${JSON.stringify(receipt)}`);
      }
      expect(receipt.effects.map(({ adapterId, status }) => ({ adapterId, status }))).toEqual([
        { adapterId: 'google-calendar', status: 'committed_verified' },
        { adapterId: 'gmail', status: 'committed_verified' },
      ]);
      expect(transport.calendarMutations).toBe(1);
      expect(transport.gmailMutations).toBe(1);
      expect(gmail.effect.dependencies).toEqual([calendar.effect.id]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
