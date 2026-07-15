import type { Effect } from '@preview/domain';

export interface StageContext {
  readonly effectId: string;
}

export interface StagedOperation<Resource, Diff> {
  readonly diff: Diff;
  readonly effect: Effect;
  readonly resource: Resource;
}

export interface SimulationAdapter<Resource, Mutation, Diff> {
  readonly adapterId: string;
  read(resourceKey: string): Promise<Resource | undefined>;
  renderDiff(effect: Effect): Diff;
  stage(current: Resource | undefined, mutation: Mutation, context: StageContext): StagedOperation<Resource, Diff>;
}

export interface RevalidationResult {
  readonly currentVersion: string | undefined;
  readonly status: 'UNCHANGED' | 'DRIFTED' | 'MISSING';
}

export interface CommitResult<Resource> {
  readonly applied: boolean;
  readonly resource: Resource;
}

export interface VerificationResult {
  readonly details: string;
  readonly verified: boolean;
}

export interface CommitAdapter<Resource> {
  readonly adapterId: string;
  commit(effect: Effect, idempotencyKey: string): Promise<CommitResult<Resource>>;
  compensate(effect: Effect, result: CommitResult<Resource>): Promise<VerificationResult>;
  reconcile(effect: Effect, idempotencyKey: string): Promise<CommitResult<Resource> | undefined>;
  revalidate(effect: Effect): Promise<RevalidationResult>;
  verify(effect: Effect, result: CommitResult<Resource>): Promise<VerificationResult>;
}
