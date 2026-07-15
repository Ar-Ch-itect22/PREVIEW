import { describe, expect, it } from 'vitest';

import {
  RevisionDraft,
  effectGraphSchema,
  type Effect,
  type SimulationRevision,
} from '../src/index.js';

function effect(id: string, dependencies: readonly string[] = []): Effect {
  return {
    adapterId: 'reference',
    dependencies: [...dependencies],
    externalities: [],
    id,
    operation: 'update',
    payload: { value: id },
    preconditions: [],
    presentation: { summary: `Effect ${id}` },
    resourceKey: `resource-${id}`,
    risk: 'REVERSIBLE',
    verification: { expected: { value: id }, kind: 'exact' },
  };
}

describe('effect graph causality', () => {
  it('accepts an acyclic graph even when effects are not topologically ordered', () => {
    expect(effectGraphSchema.parse({
      effects: [effect('dependent', ['source']), effect('source')],
      version: 1,
    }).effects).toHaveLength(2);
  });

  it.each([
    {
      effects: [effect('duplicate'), effect('duplicate')],
      message: 'Duplicate effect ID',
    },
    {
      effects: [effect('dependent', ['missing'])],
      message: 'depends on unknown effect',
    },
    {
      effects: [effect('one', ['two']), effect('two', ['one'])],
      message: 'dependency cycle',
    },
  ])('rejects invalid graph causality: $message', ({ effects, message }) => {
    expect(() => effectGraphSchema.parse({ effects, version: 1 })).toThrow(message);
  });

  it('fails the revision sealing boundary for an unknown dependency', () => {
    const revision: SimulationRevision = {
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
    const draft = new RevisionDraft(revision);
    draft.appendEffect(effect('dependent', ['missing']));

    expect(() => draft.seal(`sha256:${'a'.repeat(64)}`)).toThrow('depends on unknown effect');
  });
});
