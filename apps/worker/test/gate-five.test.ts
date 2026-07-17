import { describe, expect, it } from 'vitest';

import type { SnapshotRevalidationAdapter } from '@preview/adapter-sdk';
import {
  ContentBoundApprovalAuthority,
  computeCanonicalDigest,
  computeEffectGraphDigest,
  createSnapshotManifest,
} from '@preview/approval';
import type { Effect, Observation, SimulationRevision } from '@preview/domain';

import { CommitControlError, preflightApprovedRevision } from '../src/index.js';

interface Resource {
  readonly value: string;
  readonly version: string;
}

class ReadOnlyFixtureProvider {
  readonly #resources = new Map<string, Resource>();
  public previewMutationCount = 0;

  public constructor(resources: Readonly<Record<string, Resource>>) {
    for (const [key, value] of Object.entries(resources)) {
      this.#resources.set(key, structuredClone(value));
    }
  }

  public externalSet(key: string, value: Resource): void {
    this.#resources.set(key, structuredClone(value));
  }

  public previewWrite(key: string, value: Resource): void {
    this.#resources.set(key, structuredClone(value));
    this.previewMutationCount += 1;
  }

  public read(key: string): Resource | undefined {
    const value = this.#resources.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  public snapshotBytes(): Buffer {
    return Buffer.from(JSON.stringify([...this.#resources.entries()].sort()), 'utf8');
  }
}

function effect(
  id: string,
  adapterId: string,
  resourceKey: string,
  dependencies: readonly string[],
): Effect {
  return {
    adapterId,
    dependencies: [...dependencies],
    externalities: [],
    id,
    operation: 'update',
    payload: { value: 'after' },
    preconditions: [],
    presentation: { summary: `Update ${resourceKey}` },
    resourceKey,
    risk: 'REVERSIBLE',
    verification: { expected: { value: 'after' }, kind: 'exact' },
  };
}

const effects = [
  effect('effect-calendar', 'calendar', 'calendar:event:1', []),
  effect('effect-mail', 'mail', 'mail:message:1', ['effect-calendar']),
  effect('effect-crm', 'crm', 'crm:record:1', ['effect-calendar']),
];

const calendarBase = { value: '10:00', version: 'v1' };
const crmBase = { value: '2026-07-20', version: 'v1' };
const snapshot = createSnapshotManifest([
  presentObservation('calendar', 'calendar:event:1', calendarBase),
  absentObservation('mail', 'mail:message:1'),
  presentObservation('crm', 'crm:record:1', crmBase),
]);
const adapterVersions = { calendar: '1.0.0', crm: '1.0.0', mail: '1.0.0' } as const;
const policyVersions = { transaction: 'gate-5' } as const;

function sealedRevision(): SimulationRevision {
  const effectGraph = { effects, version: 1 as const };
  return {
    baseSnapshotDigest: snapshot.digest,
    baseSnapshotId: 'snapshot-gate-5',
    effectGraph,
    graphDigest: computeEffectGraphDigest(effectGraph),
    id: 'revision-gate-5',
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'SEALED',
    structuredConstraints: [],
    transactionId: 'transaction-gate-5',
  };
}

function presentObservation(
  adapterId: string,
  resourceKey: string,
  resource: Resource,
): Observation {
  return {
    adapterId,
    observedAt: '2026-07-17T00:00:00.000Z',
    presence: 'PRESENT',
    resourceKey,
    valueDigest: computeCanonicalDigest(resource),
    version: resource.version,
  };
}

function absentObservation(adapterId: string, resourceKey: string): Observation {
  return {
    adapterId,
    observedAt: '2026-07-17T00:00:00.000Z',
    presence: 'ABSENT',
    resourceKey,
    valueDigest: null,
    version: null,
  };
}

function revalidator(
  adapterId: string,
  provider: ReadOnlyFixtureProvider,
  reads: string[],
): SnapshotRevalidationAdapter {
  return {
    adapterId,
    adapterVersion: adapterVersions[adapterId as keyof typeof adapterVersions],
    revalidateObservation: (observation) => {
      reads.push(observation.resourceKey);
      const current = provider.read(observation.resourceKey);
      if (observation.presence === 'ABSENT') {
        return Promise.resolve({
          currentVersion: current?.version,
          status: current === undefined ? 'UNCHANGED' : 'APPEARED',
        });
      }
      if (current === undefined) {
        return Promise.resolve({ currentVersion: undefined, status: 'MISSING' });
      }
      const currentValueDigest = computeCanonicalDigest(current);
      return Promise.resolve({
        currentValueDigest,
        currentVersion: current.version,
        status: current.version === observation.version
          && currentValueDigest === observation.valueDigest
          ? 'UNCHANGED'
          : 'DRIFTED',
      });
    },
  };
}

function fixture() {
  const authority = new ContentBoundApprovalAuthority('gate-five-worker-signing-key');
  const revision = sealedRevision();
  const approval = authority.approve(revision, {
    adapterVersions,
    approverId: 'aru',
    expiresAt: '2026-07-18T00:00:00.000Z',
    policyVersions,
    snapshot,
    tenantId: 'tenant-1',
  });
  const providers = {
    calendar: new ReadOnlyFixtureProvider({ 'calendar:event:1': calendarBase }),
    crm: new ReadOnlyFixtureProvider({ 'crm:record:1': crmBase }),
    mail: new ReadOnlyFixtureProvider({}),
  };
  const reads: string[] = [];
  const adapters = Object.entries(providers).map(([adapterId, provider]) =>
    revalidator(adapterId, provider, reads)
  );
  const context = {
    adapterVersions,
    approverId: 'aru',
    policyVersions,
    snapshot,
    tenantId: 'tenant-1',
  } as const;
  return { adapters, approval, authority, context, providers, reads, revision };
}

describe('Gate 5 approved preflight', () => {
  it('revalidates the complete present and absent read set and returns an immutable plan', async () => {
    const value = fixture();
    const before = Object.values(value.providers).map((provider) => provider.snapshotBytes());
    const plan = await preflightApprovedRevision({
      adapters: value.adapters,
      approval: value.approval,
      authority: value.authority,
      context: value.context,
      now: new Date('2026-07-17T01:00:00.000Z'),
      revision: value.revision,
    });

    expect(value.reads.toSorted()).toEqual([
      'calendar:event:1',
      'crm:record:1',
      'mail:message:1',
    ]);
    expect(plan.effects.map((candidate) => candidate.id)).toEqual(
      value.approval.effectOrder,
    );
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.effects[0]?.payload)).toBe(true);
    expect(Object.values(value.providers).every((provider) => provider.previewMutationCount === 0))
      .toBe(true);
    expect(Object.values(value.providers).map((provider) => provider.snapshotBytes()))
      .toEqual(before);
  });

  it('blocks every PREVIEW write when any provider state drifts after preview', async () => {
    const value = fixture();
    value.providers.calendar.externalSet('calendar:event:1', { value: '11:00', version: 'v2' });
    const afterExternalDrift = Object.values(value.providers).map(
      (provider) => provider.snapshotBytes(),
    );

    await expect(preflightApprovedRevision({
      adapters: value.adapters,
      approval: value.approval,
      authority: value.authority,
      context: value.context,
      now: new Date('2026-07-17T01:00:00.000Z'),
      revision: value.revision,
    })).rejects.toThrow(CommitControlError);

    expect(value.reads).toHaveLength(3);
    expect(Object.values(value.providers).every((provider) => provider.previewMutationCount === 0))
      .toBe(true);
    expect(Object.values(value.providers).map((provider) => provider.snapshotBytes()))
      .toEqual(afterExternalDrift);
  });

  it('treats an absent resource appearing after preview as drift', async () => {
    const value = fixture();
    value.providers.mail.externalSet('mail:message:1', { value: 'already exists', version: 'v1' });

    await expect(preflightApprovedRevision({
      adapters: value.adapters,
      approval: value.approval,
      authority: value.authority,
      context: value.context,
      now: new Date('2026-07-17T01:00:00.000Z'),
      revision: value.revision,
    })).rejects.toThrow('appeared provider state');
    expect(Object.values(value.providers).every((provider) => provider.previewMutationCount === 0))
      .toBe(true);
  });
});
