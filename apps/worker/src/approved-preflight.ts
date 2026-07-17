import type { SnapshotRevalidationAdapter } from '@preview/adapter-sdk';
import {
  approvalSchema,
  simulationRevisionSchema,
  snapshotManifestSchema,
  type Approval,
  type Effect,
  type SimulationRevision,
} from '@preview/domain';

import {
  CommitControlError,
  type ApprovalVerificationContext,
  type ApprovalVerifier,
} from './approval-control.js';

export interface ApprovedCommitPlan {
  readonly approvalDigest: string;
  readonly effects: readonly Readonly<Effect>[];
  readonly graphDigest: string;
  readonly revisionId: string;
  readonly snapshotDigest: string;
}

export async function preflightApprovedRevision(input: {
  readonly adapters: readonly SnapshotRevalidationAdapter[];
  readonly approval: Approval;
  readonly authority: ApprovalVerifier;
  readonly context: ApprovalVerificationContext;
  readonly now: Date;
  readonly revision: Readonly<SimulationRevision>;
}): Promise<Readonly<ApprovedCommitPlan>> {
  const approval = deepFreeze(approvalSchema.parse(structuredClone(input.approval)));
  const revision = deepFreeze(simulationRevisionSchema.parse(structuredClone(input.revision)));
  const snapshot = deepFreeze(snapshotManifestSchema.parse(
    structuredClone(input.context.snapshot),
  ));
  input.authority.verify(approval, revision, input.context, input.now);

  const graph = revision.effectGraph;
  const graphDigest = revision.graphDigest;
  if (graph === null || graphDigest === null) {
    throw new CommitControlError('Preflight requires a sealed effect graph');
  }

  const adapters = new Map<string, SnapshotRevalidationAdapter>();
  for (const adapter of input.adapters) {
    if (adapters.has(adapter.adapterId)) {
      throw new CommitControlError(`Duplicate revalidation adapter: ${adapter.adapterId}`);
    }
    adapters.set(adapter.adapterId, adapter);
  }
  for (const [adapterId, expectedVersion] of Object.entries(approval.adapterVersions)) {
    const adapter = adapters.get(adapterId);
    if (adapter === undefined) {
      throw new CommitControlError(`Missing revalidation adapter: ${adapterId}`);
    }
    if (adapter.adapterVersion !== expectedVersion) {
      throw new CommitControlError(`Revalidation adapter version changed: ${adapterId}`);
    }
  }

  const results = await Promise.all(snapshot.observations.map(async (observation) => {
    const adapter = adapters.get(observation.adapterId);
    if (adapter === undefined) {
      throw new CommitControlError(`Missing revalidation adapter: ${observation.adapterId}`);
    }
    return {
      observation,
      result: await adapter.revalidateObservation(observation),
    };
  }));
  const conflict = results.find(({ result }) => result.status !== 'UNCHANGED');
  if (conflict !== undefined) {
    throw new CommitControlError(
      `Commit blocked by ${conflict.result.status.toLowerCase()} provider state for ${conflict.observation.resourceKey}`,
    );
  }

  return deepFreeze({
    approvalDigest: approval.approvalDigest,
    effects: graph.effects,
    graphDigest,
    revisionId: revision.id,
    snapshotDigest: snapshot.digest,
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
