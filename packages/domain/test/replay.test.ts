import { describe, expect, it } from 'vitest';

import { createReplayRevision, DomainInvariantError } from '../src/index.js';
import { digest, makeEffect, makeRevision } from './fixtures.js';

function sealedRevision() {
  return {
    ...makeRevision(),
    baseSnapshotDigest: digest,
    effectGraph: { effects: [makeEffect()], version: 1 as const },
    graphDigest: digest,
    status: 'SEALED' as const,
  };
}

describe('replay revision lineage', () => {
  it('preserves prior effects while creating a clean constrained revision', () => {
    const prior = sealedRevision();
    const priorBytes = JSON.stringify(prior.effectGraph);
    const transition = createReplayRevision(prior, {
      constraints: [{ kind: 'DENY_MUTATION', resourceKey: 'resource-1' }],
      revisionId: 'revision-2',
    });

    expect(transition.invalidatedRevision).toMatchObject({
      effectGraph: prior.effectGraph,
      graphDigest: digest,
      id: 'revision-1',
      status: 'INVALIDATED',
    });
    expect(transition.replayRevision).toEqual({
      baseSnapshotDigest: null,
      baseSnapshotId: 'snapshot-1',
      effectGraph: null,
      graphDigest: null,
      id: 'revision-2',
      replayOfRevisionId: 'revision-1',
      revisionNumber: 2,
      status: 'DRAFT',
      structuredConstraints: [{ kind: 'DENY_MUTATION', resourceKey: 'resource-1' }],
      transactionId: 'transaction-1',
    });
    expect(JSON.stringify(prior.effectGraph)).toBe(priorBytes);
    expect(prior.status).toBe('SEALED');
    expect(Object.isFrozen(transition.invalidatedRevision.effectGraph?.effects[0])).toBe(true);
    expect(Object.isFrozen(transition.replayRevision.structuredConstraints)).toBe(true);
  });

  it('rejects replay without a sealed source, new ID, and constraint', () => {
    expect(() => createReplayRevision(makeRevision(), {
      constraints: [{ kind: 'DENY_MUTATION', resourceKey: 'resource-1' }],
      revisionId: 'revision-2',
    })).toThrow(DomainInvariantError);
    expect(() => createReplayRevision(sealedRevision(), {
      constraints: [{ kind: 'DENY_MUTATION', resourceKey: 'resource-1' }],
      revisionId: 'revision-1',
    })).toThrow('new ID');
    expect(() => createReplayRevision(sealedRevision(), {
      constraints: [],
      revisionId: 'revision-2',
    })).toThrow('at least one structured constraint');
  });
});
