import type { SimulationAdapter, StageContext, StagedOperation } from '@preview/adapter-sdk';
import type { Effect } from '@preview/domain';
import { z } from 'zod';

import type { CrmReadPort } from './provider.js';
import {
  crmRecordSchema,
  MOVE_FOLLOW_UP_OPERATION,
  moveFollowUpEffectSchema,
  moveFollowUpPayloadSchema,
  REFERENCE_CRM_ADAPTER_ID,
  stageFollowUpInputSchema,
  type CrmFollowUpDiff,
  type CrmRecord,
  type StageFollowUpInput,
} from './schemas.js';

export class ReferenceCrmSimulationAdapter
implements SimulationAdapter<CrmRecord, StageFollowUpInput, CrmFollowUpDiff> {
  public readonly adapterId = REFERENCE_CRM_ADAPTER_ID;
  readonly #readPort: CrmReadPort;

  public constructor(readPort: CrmReadPort) {
    this.#readPort = readPort;
  }

  public read(resourceKey: string): Promise<CrmRecord | undefined> {
    return this.#readPort.readRecord(this.#recordId(resourceKey));
  }

  public stage(
    current: CrmRecord | undefined,
    mutation: StageFollowUpInput,
    context: StageContext,
  ): StagedOperation<CrmRecord, CrmFollowUpDiff> {
    const before = crmRecordSchema.parse(current);
    const input = stageFollowUpInputSchema.parse(mutation);
    if (before.id !== input.recordId) {
      throw new Error('Follow-up input does not match the observed CRM record');
    }
    const dependency = context.dependencies.find(
      (candidate) => candidate.resourceKey === input.source.resourceKey,
    );
    if (dependency === undefined || context.dependencies.length !== 1) {
      throw new Error('CRM follow-up source must be exactly one staged dependency');
    }
    const source = z.record(z.string(), z.unknown()).parse(dependency.resource);
    const followUpAt = z.string().datetime({ offset: true }).parse(source[input.source.field]);
    const payload = moveFollowUpPayloadSchema.parse({ followUpAt, recordId: input.recordId });
    const resource = crmRecordSchema.parse({ ...before, followUpAt });
    const effect: Effect = moveFollowUpEffectSchema.parse({
      adapterId: this.adapterId,
      dependencies: [dependency.effectId],
      externalities: [],
      id: context.effectId,
      operation: MOVE_FOLLOW_UP_OPERATION,
      payload,
      preconditions: [{ before, kind: 'VERSION_EQUALS', version: before.version }],
      presentation: { summary: `Move follow-up for ${before.label} to ${followUpAt}` },
      resourceKey: this.#resourceKey(before.id),
      risk: 'REVERSIBLE',
      verification: { expected: payload, kind: 'CRM_FOLLOW_UP_FIELDS_EQUAL' },
    });
    return { diff: this.renderDiff(effect), effect, resource };
  }

  public renderDiff(effect: Effect): CrmFollowUpDiff {
    const parsed = moveFollowUpEffectSchema.parse(effect);
    return {
      after: { followUpAt: parsed.payload.followUpAt, id: parsed.payload.recordId },
      before: {
        followUpAt: parsed.preconditions[0].before.followUpAt,
        id: parsed.preconditions[0].before.id,
      },
    };
  }

  #recordId(resourceKey: string): string {
    const prefix = `${this.adapterId}:record:`;
    if (!resourceKey.startsWith(prefix)) {
      throw new Error(`Invalid Reference CRM resource key: ${resourceKey}`);
    }
    return resourceKey.slice(prefix.length);
  }

  #resourceKey(recordId: string): string {
    return `${this.adapterId}:record:${recordId}`;
  }
}
