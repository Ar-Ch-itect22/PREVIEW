import { describe, expect, it } from 'vitest';

import type { EffectGraph, SimulationRevision } from '@preview/domain';

import {
  ApprovalValidationError,
  ContentBoundApprovalAuthority,
  canonicalize,
  computeEffectGraphDigest,
  createSnapshotManifest,
} from '../src/index.js';

const graph: EffectGraph = {
  effects: [{
    adapterId: 'reference',
    dependencies: [],
    externalities: [],
    id: 'effect-1',
    operation: 'send',
    payload: { recipients: ['first@example.test'], textBody: 'A' },
    preconditions: [],
    presentation: { summary: 'Send exact content' },
    resourceKey: 'resource-1',
    risk: 'IRREVERSIBLE',
    verification: { expected: { value: 'after' }, kind: 'exact' },
  }],
  version: 1,
};

const snapshot = createSnapshotManifest([{
  adapterId: 'reference',
  observedAt: '2026-07-17T00:00:00.000Z',
  presence: 'ABSENT',
  resourceKey: 'resource-1',
  valueDigest: null,
  version: null,
}]);

const request = {
  adapterVersions: { reference: '1.0.0' },
  approverId: 'aru',
  expiresAt: '2026-07-18T00:00:00.000Z',
  policyVersions: { transaction: 'gate-5' },
  snapshot,
  tenantId: 'tenant-1',
} as const;

function sealedRevision(): SimulationRevision {
  return {
    baseSnapshotDigest: snapshot.digest,
    baseSnapshotId: 'snapshot-1',
    effectGraph: graph,
    graphDigest: computeEffectGraphDigest(graph),
    id: 'revision-1',
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'SEALED',
    structuredConstraints: [{ kind: 'DENY_MUTATION', resourceKey: 'protected-resource' }],
    transactionId: 'transaction-1',
  };
}

function verificationContext(overrides: Partial<{
  adapterVersions: Readonly<Record<string, string>>;
  approverId: string;
  policyVersions: Readonly<Record<string, string>>;
  snapshot: typeof snapshot;
  tenantId: string;
}> = {}) {
  const value = { ...request, ...overrides };
  return {
    adapterVersions: value.adapterVersions,
    approverId: value.approverId,
    policyVersions: value.policyVersions,
    snapshot: value.snapshot,
    tenantId: value.tenantId,
  };
}

describe('content-bound approval', () => {
  it('uses locale-independent UTF-16 key ordering', () => {
    expect(canonicalize({ é: 3, a: 2, A: 1 })).toBe('{"A":1,"a":2,"é":3}');
  });

  it('produces stable graph and snapshot digests independent of object insertion order', () => {
    const reordered = structuredClone(graph);
    const effect = reordered.effects[0];
    if (effect === undefined) throw new Error('Expected fixture effect');
    effect.payload = { textBody: 'A', recipients: ['first@example.test'] };
    expect(computeEffectGraphDigest(reordered)).toBe(computeEffectGraphDigest(graph));
    expect(snapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(snapshot.observations[0])).toBe(true);
  });

  it('binds graph, snapshot, constraints, versions, effect order, identity, tenant, and expiry', () => {
    const authority = new ContentBoundApprovalAuthority('gate-five-test-signing-key');
    const revision = sealedRevision();
    const approval = authority.approve(revision, request);

    expect(approval.effectOrder).toEqual(['effect-1']);
    expect(approval.snapshotDigest).toBe(snapshot.digest);
    expect(() => authority.verify(
      approval,
      revision,
      verificationContext(),
      new Date('2026-07-17T00:00:00.000Z'),
    )).not.toThrow();

    const changedConstraint = structuredClone(revision);
    changedConstraint.structuredConstraints[0] = {
      kind: 'DENY_MUTATION',
      resourceKey: 'different-resource',
    };
    expect(() => authority.verify(
      approval,
      changedConstraint,
      verificationContext(),
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow('content digest');
    expect(() => authority.verify(
      approval,
      revision,
      verificationContext({ adapterVersions: { reference: '2.0.0' } }),
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow('adapter versions are stale');
    expect(() => authority.verify(
      approval,
      revision,
      verificationContext({ policyVersions: { transaction: 'gate-6' } }),
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow('policy versions are stale');
  });

  it.each([
    ['recipient', (effect: EffectGraph['effects'][number]) => {
      (effect.payload as { recipients: string[] }).recipients[0] = 'other@example.test';
    }],
    ['payload byte', (effect: EffectGraph['effects'][number]) => {
      (effect.payload as { textBody: string }).textBody = 'B';
    }],
  ] as const)('invalidates approval after changing one %s', (_label, mutate) => {
    const authority = new ContentBoundApprovalAuthority('gate-five-test-signing-key');
    const revision = sealedRevision();
    const approval = authority.approve(revision, request);
    const tampered = structuredClone(revision);
    const effect = tampered.effectGraph?.effects[0];
    if (effect === undefined || tampered.effectGraph === null) throw new Error('Expected effect');
    mutate(effect);
    tampered.graphDigest = computeEffectGraphDigest(tampered.effectGraph);

    expect(() => authority.verify(
      approval,
      tampered,
      verificationContext(),
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow(ApprovalValidationError);
  });

  it('rejects wrong-user, wrong-tenant, expired, wrong-snapshot, and replayed approvals', () => {
    const authority = new ContentBoundApprovalAuthority('gate-five-test-signing-key');
    const revision = sealedRevision();
    const approval = authority.approve(revision, request);

    expect(() => authority.verify(
      approval,
      revision,
      verificationContext({ approverId: 'mallory' }),
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow('identity or tenant');
    expect(() => authority.verify(
      approval,
      revision,
      verificationContext({ tenantId: 'tenant-2' }),
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow('identity or tenant');
    expect(() => authority.verify(
      approval,
      revision,
      verificationContext(),
      new Date(request.expiresAt),
    )).toThrow('expired');
    const firstObservation = snapshot.observations[0];
    if (firstObservation === undefined) throw new Error('Expected snapshot observation');
    const otherSnapshot = createSnapshotManifest([{
      ...firstObservation,
      observedAt: '2026-07-17T00:00:01.000Z',
    }]);
    expect(() => authority.verify(
      approval,
      revision,
      verificationContext({ snapshot: otherSnapshot }),
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow('Snapshot');

    authority.invalidateRevision(revision.id);
    expect(() => authority.approve(revision, request)).toThrow('approval path is invalidated');
    expect(() => authority.verify(
      approval,
      revision,
      verificationContext(),
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow('approval path is invalidated');
  });
});
