import { describe, expect, it } from 'vitest';

import type { SimulationRevision } from '@preview/domain';

import { ShadowRevisionSession } from '../src/index.js';

function revision(): SimulationRevision {
  return {
    baseSnapshotId: 'snapshot-1',
    effectGraph: null,
    graphDigest: null,
    id: 'revision-1',
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'DRAFT',
    structuredConstraints: [],
    transactionId: 'transaction-1',
  };
}

describe('shadow revision session', () => {
  it('returns staged data from later reads without mutating base data', async () => {
    const base = { id: 'resource-1', value: 'before' };
    const session = new ShadowRevisionSession(revision());

    await session.stage('resource-1', () => Promise.resolve(base), (current) => {
      if (current === undefined) {
        throw new Error('Expected base resource');
      }
      return {
        effect: {
        adapterId: 'reference',
        dependencies: [],
        externalities: [],
        id: 'effect-1',
        operation: 'update',
        payload: { value: 'after' },
        preconditions: [],
        presentation: { summary: 'Update resource' },
        resourceKey: 'resource-1',
        risk: 'REVERSIBLE',
        verification: { expected: { value: 'after' }, kind: 'exact' },
        },
        resource: { ...current, value: 'after' },
      };
    });

    expect(await session.read('resource-1', () => Promise.resolve(base))).toEqual({
      id: 'resource-1',
      value: 'after',
    });
    expect(base).toEqual({ id: 'resource-1', value: 'before' });
  });

  it('appends neither overlay nor effect when simulation fails', async () => {
    const session = new ShadowRevisionSession(revision());

    await expect(
      session.stage('resource-1', () => Promise.resolve({ value: 'before' }), () => {
        throw new Error('simulation rejected');
      }),
    ).rejects.toThrow('simulation rejected');

    expect(session.inspectEffectGraph().effects).toEqual([]);
    expect(await session.read('resource-1', () => Promise.resolve({ value: 'before' }))).toEqual({
      value: 'before',
    });
  });
});
