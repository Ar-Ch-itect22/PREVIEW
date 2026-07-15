import { describe, expect, it } from 'vitest';

import {
  ApprovalValidationError,
  ContentBoundApprovalAuthority,
  computeEffectGraphDigest,
} from '@preview/approval';
import type { CommitAdapter } from '@preview/adapter-sdk';
import type { Effect, SimulationRevision } from '@preview/domain';
import { ShadowRevisionSession } from '@preview/runtime';
import { CommitControlError, commitApprovedSingleEffect } from '@preview/worker';

import {
  InMemoryReferenceCalendarProvider,
  ReferenceCalendarCommitAdapter,
  ReferenceCalendarSimulationAdapter,
  type CalendarEvent,
} from '../src/index.js';

const originalEvent: CalendarEvent = {
  end: '2026-07-20T10:30:00.000Z',
  id: 'event-1',
  start: '2026-07-20T10:00:00.000Z',
  title: 'Synthetic planning session',
  version: 'v1',
};

const resourceKey = 'reference-calendar:event:event-1';

function revision(id: string): SimulationRevision {
  return {
    baseSnapshotId: 'snapshot-1',
    effectGraph: null,
    graphDigest: null,
    id,
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'DRAFT',
    structuredConstraints: [],
    transactionId: `transaction-${id}`,
  };
}

async function stageMove(
  provider: InMemoryReferenceCalendarProvider,
  revisionId: string,
): Promise<{
  session: ShadowRevisionSession;
  simulation: ReferenceCalendarSimulationAdapter;
}> {
  const simulation = new ReferenceCalendarSimulationAdapter(provider.createReadPort());
  const session = new ShadowRevisionSession(revision(revisionId));
  await session.read(resourceKey, () => simulation.read(resourceKey));
  await session.stage(
    resourceKey,
    () => simulation.read(resourceKey),
    { effectId: `effect-${revisionId}` },
    (current, context) => simulation.stage(current, {
      end: '2026-07-27T10:30:00.000Z',
      eventId: 'event-1',
      start: '2026-07-27T10:00:00.000Z',
    }, context),
  );
  return { session, simulation };
}

function expectedEffect(id: string): Effect {
  return {
    adapterId: 'reference-calendar',
    dependencies: [],
    externalities: [],
    id: `effect-${id}`,
    operation: 'move-event',
    payload: {
      end: '2026-07-27T10:30:00.000Z',
      eventId: 'event-1',
      start: '2026-07-27T10:00:00.000Z',
    },
    preconditions: [{ before: originalEvent, kind: 'VERSION_EQUALS', version: 'v1' }],
    presentation: {
      summary: 'Move event-1 from 2026-07-20T10:00:00.000Z to 2026-07-27T10:00:00.000Z',
    },
    resourceKey,
    risk: 'REVERSIBLE',
    verification: {
      expected: {
        end: '2026-07-27T10:30:00.000Z',
        eventId: 'event-1',
        start: '2026-07-27T10:00:00.000Z',
      },
      kind: 'CALENDAR_EVENT_FIELDS_EQUAL',
    },
  };
}

function onlyEffect(revision: Readonly<SimulationRevision>): Effect {
  const effect = revision.effectGraph?.effects[0];
  if (effect === undefined) {
    throw new Error('Expected a sealed revision with one effect');
  }
  return effect;
}

describe('Gate 1 Reference Calendar', () => {
  it('stages, reads its write, inspects the exact effect, and aborts without changing base bytes', async () => {
    const provider = new InMemoryReferenceCalendarProvider([originalEvent]);
    const beforeBytes = provider.snapshotBytes();
    const { session, simulation } = await stageMove(provider, 'abort');

    expect(await session.read(resourceKey, () => simulation.read(resourceKey))).toEqual({
      ...originalEvent,
      end: '2026-07-27T10:30:00.000Z',
      start: '2026-07-27T10:00:00.000Z',
    });
    expect(session.inspectEffectGraph()).toEqual({ effects: [expectedEffect('abort')], version: 1 });
    expect(simulation.renderDiff(expectedEffect('abort'))).toEqual({
      after: {
        end: '2026-07-27T10:30:00.000Z',
        id: 'event-1',
        start: '2026-07-27T10:00:00.000Z',
      },
      before: {
        end: '2026-07-20T10:30:00.000Z',
        id: 'event-1',
        start: '2026-07-20T10:00:00.000Z',
      },
    });

    session.abort();

    expect(provider.snapshotBytes().equals(beforeBytes)).toBe(true);
    expect(provider.mutationCount).toBe(0);
  });

  it('commits only the approved effect once and verifies repeated commit idempotently', async () => {
    const provider = new InMemoryReferenceCalendarProvider([originalEvent]);
    const { session } = await stageMove(provider, 'commit');
    const sealed = session.seal(computeEffectGraphDigest);
    const authority = new ContentBoundApprovalAuthority('gate-one-test-signing-key');
    const approval = authority.approve(sealed, {
      approverId: 'aru',
      expiresAt: '2026-07-16T00:00:00.000Z',
      policyVersion: 'gate-1',
      tenantId: 'tenant-1',
    });
    const commit = new ReferenceCalendarCommitAdapter(provider.createCommitPort());
    const request = {
      adapter: commit,
      approval,
      authority,
      identity: { approverId: 'aru', tenantId: 'tenant-1' },
      now: new Date('2026-07-15T00:00:00.000Z'),
      revision: sealed,
    };

    const first = await commitApprovedSingleEffect(request);
    const repeated = await commitApprovedSingleEffect(request);

    expect(first.applied).toBe(true);
    expect(repeated.applied).toBe(false);
    expect(provider.mutationCount).toBe(1);
    expect(first.resource).toEqual(repeated.resource);
    expect(await commit.verify(onlyEffect(sealed))).toEqual({
      details: 'Calendar event fields match the approved effect',
      verified: true,
    });
  });

  it('rejects an invalid approval before any provider mutation', async () => {
    const provider = new InMemoryReferenceCalendarProvider([originalEvent]);
    const { session } = await stageMove(provider, 'invalid-approval');
    const sealed = session.seal(computeEffectGraphDigest);
    const authority = new ContentBoundApprovalAuthority('gate-one-test-signing-key');
    const approval = authority.approve(sealed, {
      approverId: 'aru',
      expiresAt: '2026-07-16T00:00:00.000Z',
      policyVersion: 'gate-1',
      tenantId: 'tenant-1',
    });
    const firstCharacter = approval.signature.startsWith('0') ? '1' : '0';
    const invalidApproval = {
      ...approval,
      signature: `${firstCharacter}${approval.signature.slice(1)}`,
    };

    await expect(commitApprovedSingleEffect({
      adapter: new ReferenceCalendarCommitAdapter(provider.createCommitPort()),
      approval: invalidApproval,
      authority,
      identity: { approverId: 'aru', tenantId: 'tenant-1' },
      now: new Date('2026-07-15T00:00:00.000Z'),
      revision: sealed,
    })).rejects.toThrow(ApprovalValidationError);
    expect(provider.mutationCount).toBe(0);
  });

  it('uses an immutable approved snapshot across asynchronous commit boundaries', async () => {
    const provider = new InMemoryReferenceCalendarProvider([originalEvent]);
    const { session } = await stageMove(provider, 'immutable-snapshot');
    const mutableRevision = structuredClone(session.seal(computeEffectGraphDigest));
    const authority = new ContentBoundApprovalAuthority('gate-one-test-signing-key');
    const approval = authority.approve(mutableRevision, {
      approverId: 'aru',
      expiresAt: '2026-07-16T00:00:00.000Z',
      policyVersion: 'gate-1',
      tenantId: 'tenant-1',
    });
    const delegate = new ReferenceCalendarCommitAdapter(provider.createCommitPort());
    const mutatingAdapter: CommitAdapter<CalendarEvent> = {
      adapterId: delegate.adapterId,
      commit: (effect, key) => delegate.commit(effect, key),
      compensate: (effect) => delegate.compensate(effect),
      reconcile: (effect, key) => {
        const original = mutableRevision.effectGraph?.effects[0];
        if (original !== undefined) {
          (original.payload as { start: string }).start = '2026-08-03T10:00:00.000Z';
        }
        return delegate.reconcile(effect, key);
      },
      revalidate: (effect) => delegate.revalidate(effect),
      verify: (effect) => delegate.verify(effect),
    };

    const result = await commitApprovedSingleEffect({
      adapter: mutatingAdapter,
      approval,
      authority,
      identity: { approverId: 'aru', tenantId: 'tenant-1' },
      now: new Date('2026-07-15T00:00:00.000Z'),
      revision: mutableRevision,
    });

    expect(result.resource.start).toBe('2026-07-27T10:00:00.000Z');
    expect(provider.mutationCount).toBe(1);
  });

  it('rejects cross-field-inconsistent approved effects before provider access', async () => {
    const provider = new InMemoryReferenceCalendarProvider([originalEvent]);
    const { session } = await stageMove(provider, 'inconsistent-effect');
    const inconsistent: SimulationRevision = structuredClone(
      session.seal(computeEffectGraphDigest),
    );
    const graph = inconsistent.effectGraph;
    const effect = graph?.effects[0];
    const precondition = effect?.preconditions[0] as { version?: string } | undefined;
    if (graph === null || effect === undefined || precondition === undefined) {
      throw new Error('Expected staged effect fixture');
    }
    precondition.version = 'v2';
    inconsistent.graphDigest = computeEffectGraphDigest(graph);
    const authority = new ContentBoundApprovalAuthority('gate-one-test-signing-key');
    const approval = authority.approve(inconsistent, {
      approverId: 'aru',
      expiresAt: '2026-07-16T00:00:00.000Z',
      policyVersion: 'gate-1',
      tenantId: 'tenant-1',
    });

    await expect(commitApprovedSingleEffect({
      adapter: new ReferenceCalendarCommitAdapter(provider.createCommitPort()),
      approval,
      authority,
      identity: { approverId: 'aru', tenantId: 'tenant-1' },
      now: new Date('2026-07-15T00:00:00.000Z'),
      revision: inconsistent,
    })).rejects.toThrow('Precondition version does not match observed event');
    expect(provider.mutationCount).toBe(0);
  });

  it('deduplicates concurrent approved commit requests', async () => {
    const provider = new InMemoryReferenceCalendarProvider([originalEvent]);
    const { session } = await stageMove(provider, 'concurrent');
    const sealed = session.seal(computeEffectGraphDigest);
    const authority = new ContentBoundApprovalAuthority('gate-one-test-signing-key');
    const approval = authority.approve(sealed, {
      approverId: 'aru',
      expiresAt: '2026-07-16T00:00:00.000Z',
      policyVersion: 'gate-1',
      tenantId: 'tenant-1',
    });
    const request = {
      adapter: new ReferenceCalendarCommitAdapter(provider.createCommitPort()),
      approval,
      authority,
      identity: { approverId: 'aru', tenantId: 'tenant-1' },
      now: new Date('2026-07-15T00:00:00.000Z'),
      revision: sealed,
    };

    const results = await Promise.all([
      commitApprovedSingleEffect(request),
      commitApprovedSingleEffect(request),
    ]);

    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(provider.mutationCount).toBe(1);
    expect(results[0].resource).toEqual(results[1].resource);
  });

  it('blocks relevant provider drift before the approved mutation', async () => {
    const provider = new InMemoryReferenceCalendarProvider([originalEvent]);
    const { session } = await stageMove(provider, 'drift');
    const sealed = session.seal(computeEffectGraphDigest);
    const authority = new ContentBoundApprovalAuthority('gate-one-test-signing-key');
    const approval = authority.approve(sealed, {
      approverId: 'aru',
      expiresAt: '2026-07-16T00:00:00.000Z',
      policyVersion: 'gate-1',
      tenantId: 'tenant-1',
    });
    await provider.createCommitPort().commitMove({
      end: '2026-07-20T11:30:00.000Z',
      eventId: 'event-1',
      start: '2026-07-20T11:00:00.000Z',
    }, 'v1', 'external-drift-fixture');
    const mutationsBeforeAttempt = provider.mutationCount;

    await expect(commitApprovedSingleEffect({
      adapter: new ReferenceCalendarCommitAdapter(provider.createCommitPort()),
      approval,
      authority,
      identity: { approverId: 'aru', tenantId: 'tenant-1' },
      now: new Date('2026-07-15T00:00:00.000Z'),
      revision: sealed,
    })).rejects.toThrow(CommitControlError);
    expect(provider.mutationCount).toBe(mutationsBeforeAttempt);
  });
});
