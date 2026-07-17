import { describe, expect, it } from 'vitest';

import { ConstraintViolationError, type SimulationRevision } from '@preview/domain';

import { ShadowRevisionSession } from '../src/index.js';

function revision(): SimulationRevision {
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

const observation = {
  adapterId: 'reference',
  observedAt: '2026-07-17T00:00:00.000Z',
} as const;

describe('shadow revision session', () => {
  it('returns staged data from later reads without mutating base data', async () => {
    const base = { id: 'resource-1', value: 'before' };
    const session = new ShadowRevisionSession(revision());

    await session.stage(
      'resource-1',
      () => Promise.resolve(base),
      { effectId: 'effect-1', observation },
      (current, context) => {
        if (current === undefined) {
          throw new Error('Expected base resource');
        }
        return {
          effect: {
            adapterId: 'reference',
            dependencies: [],
            externalities: [],
            id: context.effectId,
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
      },
    );

    expect(await session.read('resource-1', () => Promise.resolve(base), observation)).toEqual({
      id: 'resource-1',
      value: 'after',
    });
    expect(base).toEqual({ id: 'resource-1', value: 'before' });
  });

  it('captures immutable present and absent base observations, never overlay values', async () => {
    const session = new ShadowRevisionSession(revision());
    const present = { id: 'resource-1', value: 'before', version: 'v1' };
    await session.read('resource-1', () => Promise.resolve(present), {
      ...observation,
      version: (resource) => resource.version,
    });
    await session.read('missing', () => Promise.resolve(undefined), observation);

    const observations = session.inspectObservations();
    expect(observations.map((observation) => observation.presence)).toEqual(['ABSENT', 'PRESENT']);
    expect(Object.isFrozen(observations)).toBe(true);
    expect(Object.isFrozen(observations[0])).toBe(true);
  });

  it('appends neither overlay nor effect when simulation fails', async () => {
    const session = new ShadowRevisionSession(revision());

    await expect(
      session.stage<{ value: string }>(
        'resource-1',
        () => Promise.resolve({ value: 'before' }),
        { effectId: 'effect-1', observation },
        () => {
          throw new Error('simulation rejected');
        },
      ),
    ).rejects.toThrow('simulation rejected');

    expect(session.inspectEffectGraph().effects).toEqual([]);
    expect(await session.read(
      'resource-1',
      () => Promise.resolve({ value: 'before' }),
      observation,
    )).toEqual({
      value: 'before',
    });
  });

  it('fails atomically when a dependency resource is not staged', async () => {
    const session = new ShadowRevisionSession(revision());

    await expect(
      session.stage<{ value: string }>(
        'resource-1',
        () => Promise.resolve(undefined),
        {
          dependencyResourceKeys: ['missing-resource'],
          effectId: 'effect-1',
          observation,
        },
        (_current, context) => ({
          effect: {
            adapterId: 'reference',
            dependencies: context.dependencies.map((dependency) => dependency.effectId),
            externalities: [],
            id: 'effect-1',
            operation: 'create',
            payload: { value: 'staged' },
            preconditions: [],
            presentation: { summary: 'Create resource' },
            resourceKey: 'resource-1',
            risk: 'REVERSIBLE',
            verification: { expected: { value: 'staged' }, kind: 'exact' },
          },
          resource: { value: 'staged' },
        }),
      ),
    ).rejects.toThrow('Dependency resource missing-resource is not staged');

    expect(session.inspectEffectGraph().effects).toEqual([]);
    expect(await session.read(
      'resource-1',
      () => Promise.resolve(undefined),
      observation,
    )).toBeUndefined();
  });

  it('enforces deny and preserve constraints before appending an effect', async () => {
    const deniedRevision = revision();
    deniedRevision.structuredConstraints = [{
      kind: 'DENY_MUTATION',
      resourceKey: 'resource-1',
    }];
    const denied = new ShadowRevisionSession(deniedRevision);
    await expect(denied.stage(
      'resource-1',
      () => Promise.resolve({ protected: true }),
      { effectId: 'effect-denied', observation },
      () => {
        throw new Error('Simulation must not run for denied resources');
      },
    )).rejects.toBeInstanceOf(ConstraintViolationError);
    expect(denied.inspectEffectGraph().effects).toEqual([]);

    const preservedRevision = revision();
    preservedRevision.structuredConstraints = [{
      field: 'protected',
      kind: 'PRESERVE_FIELD',
      resourceKey: 'resource-1',
    }];
    const preserved = new ShadowRevisionSession(preservedRevision);
    await expect(preserved.stage(
      'resource-1',
      () => Promise.resolve({ protected: 'before', value: 'before' }),
      { effectId: 'effect-preserve', observation },
      (_current, context) => ({
        effect: {
          adapterId: 'reference',
          dependencies: [],
          externalities: [],
          id: context.effectId,
          operation: 'update',
          payload: {},
          preconditions: [],
          presentation: { summary: 'Change protected field' },
          resourceKey: 'resource-1',
          risk: 'REVERSIBLE',
          verification: { expected: {}, kind: 'exact' },
        },
        resource: { protected: 'after', value: 'before' },
      }),
    )).rejects.toThrow('field protected changed');
    expect(preserved.inspectEffectGraph().effects).toEqual([]);
  });
});
