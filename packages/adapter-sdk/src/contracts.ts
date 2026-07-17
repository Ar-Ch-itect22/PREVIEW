import type { Effect, Observation } from '@preview/domain';

export interface StageDependency {
  readonly effectId: string;
  readonly resource: unknown;
  readonly resourceKey: string;
}

export interface StageContext {
  readonly dependencies: readonly StageDependency[];
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
  readonly currentValueDigest?: string;
  readonly currentVersion: string | undefined;
  readonly status: 'UNCHANGED' | 'DRIFTED' | 'MISSING' | 'APPEARED';
}

export interface SnapshotRevalidationAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  revalidateObservation(observation: Observation): Promise<RevalidationResult>;
}

export interface CommitResult<Resource> {
  readonly applied: boolean;
  readonly resource: Resource;
}

export interface VerificationResult {
  readonly details: string;
  readonly verified: boolean;
}

export type ReconciliationResult<Resource> =
  | { readonly result: CommitResult<Resource>; readonly status: 'APPLIED' }
  | { readonly status: 'AUTHORITATIVELY_NOT_APPLIED' }
  | { readonly details: string; readonly status: 'UNKNOWN' };

export type CompensationReconciliationResult =
  | { readonly verification: VerificationResult; readonly status: 'APPLIED' }
  | { readonly status: 'AUTHORITATIVELY_NOT_APPLIED' }
  | { readonly details: string; readonly status: 'UNKNOWN' };

export interface CommitAdapter<Resource> {
  readonly adapterId: string;
  commit(effect: Effect, idempotencyKey: string): Promise<CommitResult<Resource>>;
  compensate(
    effect: Effect,
    result: CommitResult<Resource>,
    idempotencyKey: string,
  ): Promise<VerificationResult>;
  reconcile(effect: Effect, idempotencyKey: string): Promise<CommitResult<Resource> | undefined>;
  revalidate(effect: Effect): Promise<RevalidationResult>;
  verify(effect: Effect, result: CommitResult<Resource>): Promise<VerificationResult>;
}

export interface DurableCommitAdapter<Resource> extends
  CommitAdapter<Resource>, SnapshotRevalidationAdapter {
  parseCommitResult(value: unknown): CommitResult<Resource>;
  reconcileCommit(effect: Effect, idempotencyKey: string): Promise<ReconciliationResult<Resource>>;
  reconcileCompensation(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CompensationReconciliationResult>;
}
