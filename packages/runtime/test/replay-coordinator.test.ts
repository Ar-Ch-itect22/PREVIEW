import { describe, expect, it, vi } from 'vitest';

import type { SimulationRevision } from '@preview/domain';

import { ReplayCoordinator } from '../src/index.js';

const prior: SimulationRevision = {
  baseSnapshotId: 'snapshot-1',
  effectGraph: { effects: [], version: 1 },
  graphDigest: `sha256:${'a'.repeat(64)}`,
  id: 'revision-1',
  replayOfRevisionId: null,
  revisionNumber: 1,
  status: 'SEALED',
  structuredConstraints: [],
  transactionId: 'transaction-1',
};

describe('replay coordinator', () => {
  it('invalidates the old approval path while returning the new lineage', () => {
    const invalidateRevision = vi.fn<(revisionId: string) => void>();
    const transition = new ReplayCoordinator({ invalidateRevision }).beginReplay(prior, {
      constraints: [{ kind: 'DENY_MUTATION', resourceKey: 'resource-1' }],
      revisionId: 'revision-2',
    });

    expect(invalidateRevision).toHaveBeenCalledExactlyOnceWith('revision-1');
    expect(transition.invalidatedRevision.status).toBe('INVALIDATED');
    expect(transition.replayRevision.replayOfRevisionId).toBe('revision-1');
  });
});
