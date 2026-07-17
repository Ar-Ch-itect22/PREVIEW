import type {
  CommitResult,
  CompensationReconciliationResult,
  DurableCommitAdapter,
  ReconciliationResult,
  RevalidationResult,
  VerificationResult,
} from '@preview/adapter-sdk';
import type { Effect, Observation } from '@preview/domain';

export interface ErasedDurableCommitAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  commit(effect: Effect, idempotencyKey: string): Promise<CommitResult<unknown>>;
  compensate(
    effect: Effect,
    result: CommitResult<unknown>,
    idempotencyKey: string,
  ): Promise<VerificationResult>;
  parseCommitResult(value: unknown): CommitResult<unknown>;
  reconcileCommit(effect: Effect, idempotencyKey: string): Promise<ReconciliationResult<unknown>>;
  reconcileCompensation(
    effect: Effect,
    idempotencyKey: string,
  ): Promise<CompensationReconciliationResult>;
  revalidateObservation(observation: Observation): Promise<RevalidationResult>;
  verify(effect: Effect, result: CommitResult<unknown>): Promise<VerificationResult>;
}

export function eraseDurableCommitAdapter<Resource>(
  adapter: DurableCommitAdapter<Resource>,
): ErasedDurableCommitAdapter {
  return Object.freeze({
    adapterId: adapter.adapterId,
    adapterVersion: adapter.adapterVersion,
    commit: async (effect: Effect, key: string) => adapter.commit(effect, key),
    compensate: async (effect: Effect, result: CommitResult<unknown>, key: string) => (
      adapter.compensate(effect, adapter.parseCommitResult(result), key)
    ),
    parseCommitResult: (value: unknown) => adapter.parseCommitResult(value),
    reconcileCommit: async (effect: Effect, key: string) => adapter.reconcileCommit(effect, key),
    reconcileCompensation: async (effect: Effect, key: string) => (
      adapter.reconcileCompensation(effect, key)
    ),
    revalidateObservation: async (observation: Observation) => (
      adapter.revalidateObservation(observation)
    ),
    verify: async (effect: Effect, result: CommitResult<unknown>) => (
      adapter.verify(effect, adapter.parseCommitResult(result))
    ),
  });
}
