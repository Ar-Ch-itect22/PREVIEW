import { describe, expect, it } from 'vitest';

import {
  InMemoryReferenceCrmProvider,
  ReferenceCrmSimulationAdapter,
  type CrmRecord,
} from '../src/index.js';

const original: CrmRecord = {
  followUpAt: '2026-07-20T10:00:00.000Z',
  id: 'record-1',
  label: 'Synthetic follow-up',
  version: 'v1',
};

describe('Reference CRM simulation adapter', () => {
  it('derives the exact follow-up effect from staged dependency provenance', async () => {
    const provider = new InMemoryReferenceCrmProvider([original]);
    const beforeBytes = provider.snapshotBytes();
    const adapter = new ReferenceCrmSimulationAdapter(provider.createReadPort());
    const current = await adapter.read('reference-crm:record:record-1');
    const staged = adapter.stage(current, {
      recordId: 'record-1',
      source: {
        field: 'start',
        resourceKey: 'reference-calendar:event:event-1',
      },
    }, {
      dependencies: [{
        effectId: 'effect-calendar',
        resource: { start: '2026-07-27T10:00:00.000Z' },
        resourceKey: 'reference-calendar:event:event-1',
      }],
      effectId: 'effect-crm',
    });

    expect(staged.resource.followUpAt).toBe('2026-07-27T10:00:00.000Z');
    expect(staged.effect).toMatchObject({
      dependencies: ['effect-calendar'],
      payload: {
        followUpAt: '2026-07-27T10:00:00.000Z',
        recordId: 'record-1',
      },
      preconditions: [{ before: original, kind: 'VERSION_EQUALS', version: 'v1' }],
      risk: 'REVERSIBLE',
    });
    expect(provider.snapshotBytes().equals(beforeBytes)).toBe(true);
  });

  it('rejects caller-asserted follow-up content without staged provenance', async () => {
    const provider = new InMemoryReferenceCrmProvider([original]);
    const adapter = new ReferenceCrmSimulationAdapter(provider.createReadPort());
    const current = await adapter.read('reference-crm:record:record-1');

    expect(() => adapter.stage(current, {
      recordId: 'record-1',
      source: {
        field: 'start',
        resourceKey: 'reference-calendar:event:event-1',
      },
    }, {
      dependencies: [],
      effectId: 'effect-crm',
    })).toThrow('exactly one staged dependency');
  });
});
