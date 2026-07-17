import type {
  CommitAdapter,
  CommitResult,
  SnapshotRevalidationAdapter,
} from '@preview/adapter-sdk';
import {
  approvalSchema,
  simulationRevisionSchema,
  type Approval,
  type SimulationRevision,
} from '@preview/domain';

import {
  CommitControlError,
  type ApprovalVerificationContext,
  type ApprovalVerifier,
} from './approval-control.js';
import { preflightApprovedRevision } from './approved-preflight.js';

export async function commitApprovedSingleEffect<Resource>(input: {
  readonly adapter: CommitAdapter<Resource>;
  readonly approval: Approval;
  readonly approvalContext: ApprovalVerificationContext;
  readonly authority: ApprovalVerifier;
  readonly now: Date;
  readonly revalidationAdapters: readonly SnapshotRevalidationAdapter[];
  readonly revision: Readonly<SimulationRevision>;
}): Promise<CommitResult<Resource>> {
  const approval = deepFreeze(approvalSchema.parse(structuredClone(input.approval)));
  const revision = deepFreeze(simulationRevisionSchema.parse(structuredClone(input.revision)));
  input.authority.verify(approval, revision, input.approvalContext, input.now);

  const graph = revision.effectGraph;
  const digest = revision.graphDigest;
  if (graph === null || digest === null || graph.effects.length !== 1) {
    throw new CommitControlError('Gate 1 commit requires exactly one sealed effect');
  }
  const effect = graph.effects[0];
  if (effect?.adapterId !== input.adapter.adapterId) {
    throw new CommitControlError('Effect adapter does not match the commit adapter');
  }

  const idempotencyKey = `${digest}:${effect.id}`;
  const previous = await input.adapter.reconcile(effect, idempotencyKey);
  if (previous !== undefined) {
    await assertVerified(input.adapter, effect, previous);
    return previous;
  }

  await preflightApprovedRevision({
    adapters: input.revalidationAdapters,
    approval,
    authority: input.authority,
    context: input.approvalContext,
    now: input.now,
    revision,
  });

  const result = await input.adapter.commit(effect, idempotencyKey);
  await assertVerified(input.adapter, effect, result);
  return result;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

async function assertVerified<Resource>(
  adapter: CommitAdapter<Resource>,
  effect: NonNullable<SimulationRevision['effectGraph']>['effects'][number],
  result: CommitResult<Resource>,
): Promise<void> {
  const verification = await adapter.verify(effect, result);
  if (!verification.verified) {
    throw new CommitControlError(`Provider verification failed: ${verification.details}`);
  }
}
