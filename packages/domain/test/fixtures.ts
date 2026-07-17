import type { Effect, SimulationRevision } from '../src/index.js';

export const digest = `sha256:${'a'.repeat(64)}`;

export function makeRevision(): SimulationRevision {
  return {
    baseSnapshotDigest: null,
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

export function makeEffect(): Effect {
  return {
    adapterId: 'reference-adapter',
    dependencies: [],
    externalities: [],
    id: 'effect-1',
    operation: 'update-resource',
    payload: { value: 'after' },
    preconditions: [{ version: 'v1' }],
    presentation: { summary: 'Update resource' },
    resourceKey: 'resource-1',
    risk: 'REVERSIBLE',
    verification: { expected: { value: 'after' }, kind: 'exact-match' },
  };
}
