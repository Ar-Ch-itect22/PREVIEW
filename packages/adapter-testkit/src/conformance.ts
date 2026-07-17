import { isDeepStrictEqual } from 'node:util';

import type {
  DurableCommitAdapter,
  SimulationAdapter,
  StageContext,
} from '@preview/adapter-sdk';
import type { Effect, Observation } from '@preview/domain';

export function assertDeterministicSimulation<Resource, Mutation, Diff>(input: {
  readonly adapter: SimulationAdapter<Resource, Mutation, Diff>;
  readonly context: StageContext;
  readonly current: Resource | undefined;
  readonly mutation: Mutation;
}): Readonly<Effect> {
  const first = input.adapter.stage(
    structuredClone(input.current),
    structuredClone(input.mutation),
    structuredClone(input.context),
  );
  const second = input.adapter.stage(
    structuredClone(input.current),
    structuredClone(input.mutation),
    structuredClone(input.context),
  );
  if (!isDeepStrictEqual(first, second)) {
    throw new Error('Certified simulation is not deterministic');
  }
  if (!isDeepStrictEqual(input.adapter.renderDiff(first.effect), first.diff)) {
    throw new Error('Certified deterministic diff does not match the staged effect');
  }
  return Object.freeze(structuredClone(first.effect));
}

export async function assertCommitLifecycle<Resource>(input: {
  readonly adapter: DurableCommitAdapter<Resource>;
  readonly effect: Effect;
  readonly idempotencyKey: string;
  readonly mutationCount: () => number;
}): Promise<void> {
  const before = input.mutationCount();
  const result = await input.adapter.commit(input.effect, input.idempotencyKey);
  if (input.mutationCount() !== before + 1) {
    throw new Error('Certified commit did not produce exactly one provider mutation');
  }
  const verification = await input.adapter.verify(input.effect, result);
  if (!verification.verified) throw new Error(`Certified commit verification failed: ${verification.details}`);
  const reconciliation = await input.adapter.reconcileCommit(input.effect, input.idempotencyKey);
  if (reconciliation.status !== 'APPLIED') {
    throw new Error('Certified reconciliation did not find the applied commit');
  }
  input.adapter.parseCommitResult(reconciliation.result);
}

export async function assertObservationConformance<Resource>(input: {
  readonly adapter: DurableCommitAdapter<Resource>;
  readonly observation: Observation;
}): Promise<void> {
  const result = await input.adapter.revalidateObservation(input.observation);
  if (result.status !== 'UNCHANGED') {
    throw new Error(`Certified observation unexpectedly revalidated as ${result.status}`);
  }
}

export async function assertUnknownWriteFailsClosed<Resource>(input: {
  readonly adapter: DurableCommitAdapter<Resource>;
  readonly effect: Effect;
  readonly mutationCount: () => number;
}): Promise<void> {
  const before = input.mutationCount();
  let rejected = false;
  try {
    await input.adapter.commit(input.effect, 'conformance:unknown-write');
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('Certified adapter accepted an unknown write');
  if (input.mutationCount() !== before) {
    throw new Error('Certified adapter mutated provider state for an unknown write');
  }
}
