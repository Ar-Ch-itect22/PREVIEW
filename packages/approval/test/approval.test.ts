import { describe, expect, it } from 'vitest';

import type { EffectGraph, SimulationRevision } from '@preview/domain';

import {
  ApprovalValidationError,
  ContentBoundApprovalAuthority,
  canonicalize,
  computeEffectGraphDigest,
} from '../src/index.js';

const graph: EffectGraph = {
  effects: [{
    adapterId: 'reference',
    dependencies: [],
    externalities: [],
    id: 'effect-1',
    operation: 'update',
    payload: { b: 2, a: 1 },
    preconditions: [],
    presentation: { summary: 'Update resource' },
    resourceKey: 'resource-1',
    risk: 'REVERSIBLE',
    verification: { expected: { value: 'after' }, kind: 'exact' },
  }],
  version: 1,
};

function sealedRevision(): SimulationRevision {
  return {
    baseSnapshotId: 'snapshot-1',
    effectGraph: graph,
    graphDigest: computeEffectGraphDigest(graph),
    id: 'revision-1',
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'SEALED',
    structuredConstraints: [],
    transactionId: 'transaction-1',
  };
}

describe('content-bound approval', () => {
  it('uses locale-independent UTF-16 key ordering', () => {
    expect(canonicalize({ é: 3, a: 2, A: 1 })).toBe('{"A":1,"a":2,"é":3}');
  });

  it('produces a stable digest independent of object key insertion order', () => {
    const reordered = structuredClone(graph);
    const effect = reordered.effects[0];
    if (effect === undefined) {
      throw new Error('Expected fixture effect');
    }
    effect.payload = { a: 1, b: 2 };
    expect(computeEffectGraphDigest(reordered)).toBe(computeEffectGraphDigest(graph));
  });

  it('verifies an approval only for its exact sealed revision', () => {
    const authority = new ContentBoundApprovalAuthority('gate-one-test-signing-key');
    const revision = sealedRevision();
    const approval = authority.approve(revision, {
      approverId: 'aru',
      expiresAt: '2026-07-16T00:00:00.000Z',
      policyVersion: 'gate-1',
      tenantId: 'tenant-1',
    });

    expect(() => authority.verify(
      approval,
      revision,
      { approverId: 'aru', tenantId: 'tenant-1' },
      new Date('2026-07-15T00:00:00.000Z'),
    )).not.toThrow();

    const tampered = structuredClone(revision);
    const effect = tampered.effectGraph?.effects[0];
    if (effect === undefined) {
      throw new Error('Expected fixture effect');
    }
    (effect.payload as { b: number }).b = 3;
    expect(() => authority.verify(
      approval,
      tampered,
      { approverId: 'aru', tenantId: 'tenant-1' },
      new Date('2026-07-15T00:00:00.000Z'),
    )).toThrow(ApprovalValidationError);
  });
});
