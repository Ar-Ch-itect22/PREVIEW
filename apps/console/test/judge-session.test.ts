import { describe, expect, it } from 'vitest';

import { JudgeSession, JudgeSessionError } from '../src/judge-session.js';

const NOW = new Date('2026-07-18T12:00:00.000Z');
const createSession = () => new JudgeSession(() => new Date(NOW));

describe('Gate 8 Judge Mode', () => {
  it('stages six deterministic effects without provider mutation', async () => {
    const session = createSession();
    const view = await session.stage();

    expect(view.phase).toBe('REVIEW');
    expect(view.effectCount).toBe(6);
    expect(view.effects.filter(({ risk }) => risk === 'IRREVERSIBLE')).toHaveLength(2);
    expect(view.providerState).toEqual({
      calendarMutations: 0,
      crmMutations: 0,
      mailMutations: 0,
      totalMutations: 0,
      unchangedFromBase: true,
    });
  });

  it('replays a structured protection and removes the full Acme causal group', async () => {
    const session = createSession();
    const first = await session.stage();
    const replay = await session.protectAcme();

    expect(replay.phase).toBe('REPLAYED');
    expect(replay.revisionNumber).toBe(2);
    expect(replay.invalidatedGraphDigest).toBe(first.graphDigest);
    expect(replay.graphDigest).not.toBe(first.graphDigest);
    expect(replay.effects).toHaveLength(3);
    expect(replay.effects.every(({ customerName }) => customerName === 'Globex')).toBe(true);
    expect(replay.providerState.totalMutations).toBe(0);
    expect(replay.providerState.unchangedFromBase).toBe(true);
  });

  it('binds approval to Revision 2 and commits a verified durable receipt', async () => {
    const session = createSession();
    await session.stage();
    const replay = await session.protectAcme();
    const approved = await session.approve();
    const committed = await session.commit();

    expect(approved.approval?.graphDigest).toBe(replay.graphDigest);
    expect(approved.approval?.revisionId).toBe(replay.revisionId);
    expect(committed.phase).toBe('COMMITTED');
    expect(committed.receipt).toMatchObject({
      graphDigest: replay.graphDigest,
      knownResidualCount: 0,
      terminalStatus: 'COMMITTED_VERIFIED',
      unresolvedCount: 0,
    });
    expect(committed.receipt?.effects.map(({ status }) => status)).toEqual([
      'committed_verified',
      'committed_verified',
      'committed_verified',
    ]);
    expect(committed.providerState).toMatchObject({
      calendarMutations: 1,
      crmMutations: 1,
      mailMutations: 1,
      totalMutations: 3,
      unchangedFromBase: false,
    });
    expect(committed.journal.length).toBeGreaterThan(10);
  });

  it('fails closed when commit is requested without approval', async () => {
    const session = createSession();
    await session.stage();
    await expect(session.commit()).rejects.toBeInstanceOf(JudgeSessionError);
    expect((await session.view()).providerState.totalMutations).toBe(0);
  });

  it('aborts a staged run byte-identically', async () => {
    const session = createSession();
    await session.stage();
    const aborted = await session.abort();

    expect(aborted.phase).toBe('ABORTED');
    expect(aborted.providerState.totalMutations).toBe(0);
    expect(aborted.providerState.unchangedFromBase).toBe(true);
  });
});
