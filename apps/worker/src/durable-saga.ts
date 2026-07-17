import {
  DefinitelyNotAppliedError,
  type CommitResult,
  type ReconciliationResult,
  type VerificationResult,
} from '@preview/adapter-sdk';
import {
  receiptSchema,
  type Effect,
  type Receipt,
} from '@preview/domain';
import type {
  ExecutionLease,
  SagaJournalEntry,
  SagaJournalEvent,
  SagaRunSeed,
  SagaStore,
} from '@preview/persistence';

import type { ApprovalVerifier } from './approval-control.js';
import { preflightApprovedRevision } from './approved-preflight.js';
import type { ErasedDurableCommitAdapter } from './durable-adapter.js';

export type SagaCheckpoint = (name: string) => void | Promise<void>;
const MAX_ATTEMPTS = 2;

export class SimulatedProcessDeathError extends Error {
  public constructor(checkpoint: string) {
    super(`Simulated process death at ${checkpoint}`);
    this.name = 'SimulatedProcessDeathError';
  }
}

export class SagaLeaseUnavailableError extends Error {
  public constructor(runId: string) {
    super(`Another worker holds the execution lease for ${runId}`);
    this.name = 'SagaLeaseUnavailableError';
  }
}

export interface DurableSagaRequest {
  readonly adapters: readonly ErasedDurableCommitAdapter[];
  readonly authority: ApprovalVerifier;
  readonly checkpoint?: SagaCheckpoint;
  readonly leaseTtlMs?: number;
  readonly now?: () => Date;
  readonly ownerId: string;
  readonly seed: SagaRunSeed;
  readonly store: SagaStore;
}

type EffectOutcome = 'VERIFIED' | 'FAILED' | 'UNRESOLVED' | 'VERIFICATION_FAILED';

export async function executeDurableSaga(input: DurableSagaRequest): Promise<Readonly<Receipt>> {
  const now = input.now ?? (() => new Date());
  const seed = await input.store.createOrLoadRun(input.seed);
  const existingReceipt = await input.store.loadReceipt(seed.runId);
  if (existingReceipt !== undefined) return existingReceipt;

  const lease = await input.store.acquireLease(
    seed.runId,
    input.ownerId,
    now(),
    input.leaseTtlMs ?? 30_000,
  );
  if (lease === undefined) throw new SagaLeaseUnavailableError(seed.runId);

  let simulatedDeath = false;
  try {
    const executor = new SagaExecutor(input, seed, lease, now);
    return await executor.run();
  } catch (error) {
    simulatedDeath = error instanceof SimulatedProcessDeathError;
    throw error;
  } finally {
    if (!simulatedDeath) await input.store.releaseLease(lease);
  }
}

class SagaExecutor {
  readonly #adapters = new Map<string, ErasedDurableCommitAdapter>();
  readonly #checkpoint: SagaCheckpoint;
  readonly #input: DurableSagaRequest;
  readonly #lease: ExecutionLease;
  readonly #now: () => Date;
  readonly #seed: Readonly<SagaRunSeed>;
  #events: SagaJournalEntry[] = [];

  public constructor(
    input: DurableSagaRequest,
    seed: Readonly<SagaRunSeed>,
    lease: ExecutionLease,
    now: () => Date,
  ) {
    this.#input = input;
    this.#seed = seed;
    this.#lease = lease;
    this.#now = now;
    this.#checkpoint = input.checkpoint ?? (() => undefined);
    for (const adapter of input.adapters) {
      if (this.#adapters.has(adapter.adapterId)) {
        throw new TypeError(`Duplicate durable adapter: ${adapter.adapterId}`);
      }
      this.#adapters.set(adapter.adapterId, adapter);
    }
  }

  public async run(): Promise<Readonly<Receipt>> {
    this.#events = [...await this.#input.store.listEvents(this.#seed.runId)];
    if (!this.#has('AUTHORIZATION_VERIFIED')) {
      this.#input.authority.verify(
        this.#seed.approval,
        this.#seed.revision,
        this.#seed.approvalContext,
        new Date(this.#seed.authorizedAt),
      );
      await this.#append({ kind: 'AUTHORIZATION_VERIFIED' });
    }
    this.#assertAdapterVersions();

    if (!this.#has('RUN_STARTED')) await this.#append({ kind: 'RUN_STARTED' });
    const hasMutationIntent = this.#events.some((event) => event.kind === 'EFFECT_COMMIT_STARTED');
    if (!hasMutationIntent) {
      await preflightApprovedRevision({
        adapters: [...this.#adapters.values()].map((adapter) => Object.freeze({
          adapterId: adapter.adapterId,
          adapterVersion: adapter.adapterVersion,
          revalidateObservation: async (observation: Parameters<typeof adapter.revalidateObservation>[0]) => (
            adapter.revalidateObservation(observation)
          ),
        })),
        approval: this.#seed.approval,
        authority: this.#input.authority,
        context: this.#seed.approvalContext,
        now: this.#now(),
        revision: this.#seed.revision,
      });
      await this.#append({ kind: 'PREFLIGHT_PASSED' });
    }

    const effects = this.#orderedEffects();
    if (!this.#has('RUN_TERMINAL')) {
      let stop = this.#events.some((event) => (
        event.kind === 'EFFECT_COMMIT_FAILED'
        || event.kind === 'EFFECT_COMMIT_UNRESOLVED'
        || event.kind === 'EFFECT_VERIFICATION_FAILED'
      ));
      for (const effect of effects) {
        if (stop) break;
        const outcome = await this.#executeEffect(effect);
        stop = outcome !== 'VERIFIED';
      }
      const hasUnresolvedCommit = this.#events.some(
        (event) => event.kind === 'EFFECT_COMMIT_UNRESOLVED',
      );
      if (stop && !hasUnresolvedCommit) await this.#compensateAppliedEffects(effects);
      const receipt = this.#buildReceipt(effects);
      await this.#append({ kind: 'RUN_TERMINAL', terminalStatus: receipt.terminalStatus });
    }

    const receipt = this.#buildReceipt(effects);
    await this.#checkpoint('before-receipt-record');
    const recorded = await this.#input.store.recordReceipt(this.#lease, receipt, this.#now());
    await this.#checkpoint('after-receipt-record');
    return recorded;
  }

  async #executeEffect(effect: Readonly<Effect>): Promise<EffectOutcome> {
    const existing = this.#effectEvents(effect.id);
    if (existing.some((event) => event.kind === 'EFFECT_VERIFIED')) return 'VERIFIED';
    if (existing.some((event) => event.kind === 'EFFECT_COMMIT_UNRESOLVED')) return 'UNRESOLVED';
    if (existing.some((event) => event.kind === 'EFFECT_COMMIT_FAILED')) return 'FAILED';
    if (existing.some((event) => event.kind === 'EFFECT_VERIFICATION_FAILED')) {
      return 'VERIFICATION_FAILED';
    }

    const adapter = this.#requiredAdapter(effect.adapterId);
    let result = this.#latestCommitResult(effect, adapter);
    if (result === undefined) {
      const starts = existing.filter((event) => event.kind === 'EFFECT_COMMIT_STARTED');
      if (starts.length > 0) {
        result = await this.#reconcileInterruptedCommit(effect, adapter);
        if (result === undefined) return this.#currentCommitOutcome(effect.id);
      } else {
        result = await this.#callCommit(effect, adapter, 1);
        if (result === undefined) return this.#currentCommitOutcome(effect.id);
      }
    }
    return this.#verifyApplied(effect, adapter, result);
  }

  async #callCommit(
    effect: Readonly<Effect>,
    adapter: ErasedDurableCommitAdapter,
    attemptNumber: number,
  ): Promise<CommitResult<unknown> | undefined> {
    const idempotencyKey = this.#commitKey(effect.id);
    await this.#append({
      attemptNumber,
      effectId: effect.id,
      idempotencyKey,
      kind: 'EFFECT_COMMIT_STARTED',
    });
    await this.#checkpoint(`before-provider-commit:${effect.id}:${String(attemptNumber)}`);
    try {
      const result = await adapter.commit(effect, idempotencyKey);
      await this.#checkpoint(`after-provider-commit:${effect.id}:${String(attemptNumber)}`);
      await this.#append({ effectId: effect.id, kind: 'EFFECT_COMMIT_APPLIED', providerResult: result });
      return adapter.parseCommitResult(result);
    } catch (error) {
      rethrowSimulatedDeath(error);
      if (error instanceof DefinitelyNotAppliedError) {
        await this.#append({ effectId: effect.id, kind: 'EFFECT_COMMIT_FAILED', details: error.message });
        return undefined;
      }
      return this.#reconcileAmbiguousCommit(effect, adapter, describeError(error));
    }
  }

  async #reconcileInterruptedCommit(
    effect: Readonly<Effect>,
    adapter: ErasedDurableCommitAdapter,
  ): Promise<CommitResult<unknown> | undefined> {
    return this.#reconcileAmbiguousCommit(effect, adapter, 'Worker stopped after commit intent');
  }

  async #reconcileAmbiguousCommit(
    effect: Readonly<Effect>,
    adapter: ErasedDurableCommitAdapter,
    details: string,
  ): Promise<CommitResult<unknown> | undefined> {
    const idempotencyKey = this.#commitKey(effect.id);
    await this.#append({ effectId: effect.id, idempotencyKey, kind: 'EFFECT_COMMIT_RECONCILIATION_STARTED' });
    await this.#checkpoint(`before-provider-reconcile:${effect.id}`);
    let reconciliation: ReconciliationResult<unknown>;
    try {
      reconciliation = await adapter.reconcileCommit(effect, idempotencyKey);
    } catch (error) {
      rethrowSimulatedDeath(error);
      await this.#append({
        details: `Commit reconciliation failed: ${describeError(error)}`,
        effectId: effect.id,
        kind: 'EFFECT_COMMIT_UNRESOLVED',
      });
      return undefined;
    }
    await this.#checkpoint(`after-provider-reconcile:${effect.id}`);
    if (reconciliation.status === 'APPLIED') {
      const result = adapter.parseCommitResult(reconciliation.result);
      await this.#append({ effectId: effect.id, kind: 'EFFECT_COMMIT_APPLIED', providerResult: result });
      return result;
    }
    if (reconciliation.status === 'AUTHORITATIVELY_NOT_APPLIED') {
      const completedAttempts = this.#effectEvents(effect.id)
        .filter((event) => event.kind === 'EFFECT_COMMIT_STARTED').length;
      if (completedAttempts >= MAX_ATTEMPTS) {
        await this.#append({
          details: `Commit stopped after ${String(completedAttempts)} authoritatively non-applied attempts`,
          effectId: effect.id,
          kind: 'EFFECT_COMMIT_FAILED',
        });
        return undefined;
      }
      const attemptNumber = completedAttempts + 1;
      return this.#callCommit(effect, adapter, attemptNumber);
    }
    await this.#append({
      details: `${details}; ${reconciliation.details}`,
      effectId: effect.id,
      kind: 'EFFECT_COMMIT_UNRESOLVED',
    });
    return undefined;
  }

  async #verifyApplied(
    effect: Readonly<Effect>,
    adapter: ErasedDurableCommitAdapter,
    result: CommitResult<unknown>,
  ): Promise<EffectOutcome> {
    if (this.#effectEvents(effect.id).some((event) => event.kind === 'EFFECT_VERIFIED')) {
      return 'VERIFIED';
    }
    await this.#append({ effectId: effect.id, kind: 'EFFECT_VERIFICATION_STARTED' });
    await this.#checkpoint(`before-provider-verify:${effect.id}`);
    let verification: VerificationResult;
    try {
      verification = await adapter.verify(effect, result);
    } catch (error) {
      rethrowSimulatedDeath(error);
      verification = { details: `Verification failed: ${describeError(error)}`, verified: false };
    }
    await this.#checkpoint(`after-provider-verify:${effect.id}`);
    await this.#append({
      details: verification.details,
      effectId: effect.id,
      kind: verification.verified ? 'EFFECT_VERIFIED' : 'EFFECT_VERIFICATION_FAILED',
    });
    return verification.verified ? 'VERIFIED' : 'VERIFICATION_FAILED';
  }

  async #compensateAppliedEffects(effects: readonly Readonly<Effect>[]): Promise<void> {
    for (const effect of [...effects].reverse()) {
      if (effect.risk === 'IRREVERSIBLE') continue;
      const applied = this.#effectEvents(effect.id).some((event) => event.kind === 'EFFECT_COMMIT_APPLIED');
      if (!applied) continue;
      await this.#compensateEffect(effect, this.#requiredAdapter(effect.adapterId));
    }
  }

  async #compensateEffect(
    effect: Readonly<Effect>,
    adapter: ErasedDurableCommitAdapter,
  ): Promise<void> {
    const events = this.#effectEvents(effect.id);
    if (events.some((event) => (
      event.kind === 'EFFECT_COMPENSATED'
      || event.kind === 'EFFECT_COMPENSATION_FAILED'
      || event.kind === 'EFFECT_COMPENSATION_UNRESOLVED'
    ))) return;
    const result = this.#latestCommitResult(effect, adapter);
    if (result === undefined) {
      await this.#append({
        details: 'Committed provider result is unavailable for compensation',
        effectId: effect.id,
        kind: 'EFFECT_COMPENSATION_UNRESOLVED',
      });
      return;
    }
    const started = events.some((event) => event.kind === 'EFFECT_COMPENSATION_STARTED');
    if (started) {
      await this.#reconcileCompensation(effect, adapter);
      return;
    }
    await this.#callCompensation(effect, adapter, result, 1);
  }

  async #callCompensation(
    effect: Readonly<Effect>,
    adapter: ErasedDurableCommitAdapter,
    result: CommitResult<unknown>,
    attemptNumber: number,
  ): Promise<void> {
    const idempotencyKey = this.#compensationKey(effect.id);
    await this.#append({ attemptNumber, effectId: effect.id, idempotencyKey, kind: 'EFFECT_COMPENSATION_STARTED' });
    await this.#checkpoint(`before-provider-compensate:${effect.id}:${String(attemptNumber)}`);
    try {
      const verification = await adapter.compensate(effect, result, idempotencyKey);
      await this.#checkpoint(`after-provider-compensate:${effect.id}:${String(attemptNumber)}`);
      await this.#append({ effectId: effect.id, kind: 'EFFECT_COMPENSATION_APPLIED' });
      await this.#recordCompensationVerification(effect.id, verification);
    } catch (error) {
      rethrowSimulatedDeath(error);
      if (error instanceof DefinitelyNotAppliedError) {
        await this.#append({
          details: error.message,
          effectId: effect.id,
          kind: 'EFFECT_COMPENSATION_FAILED',
        });
        return;
      }
      await this.#reconcileCompensation(effect, adapter);
    }
  }

  async #reconcileCompensation(
    effect: Readonly<Effect>,
    adapter: ErasedDurableCommitAdapter,
  ): Promise<void> {
    const idempotencyKey = this.#compensationKey(effect.id);
    await this.#append({
      effectId: effect.id,
      idempotencyKey,
      kind: 'EFFECT_COMPENSATION_RECONCILIATION_STARTED',
    });
    await this.#checkpoint(`before-provider-compensation-reconcile:${effect.id}`);
    try {
      const outcome = await adapter.reconcileCompensation(effect, idempotencyKey);
      await this.#checkpoint(`after-provider-compensation-reconcile:${effect.id}`);
      if (outcome.status === 'APPLIED') {
        await this.#append({ effectId: effect.id, kind: 'EFFECT_COMPENSATION_APPLIED' });
        await this.#recordCompensationVerification(effect.id, outcome.verification);
        return;
      }
      if (outcome.status === 'AUTHORITATIVELY_NOT_APPLIED') {
        const result = this.#latestCommitResult(effect, adapter);
        if (result === undefined) throw new Error('Committed result is unavailable');
        const completedAttempts = this.#effectEvents(effect.id)
          .filter((event) => event.kind === 'EFFECT_COMPENSATION_STARTED').length;
        if (completedAttempts >= MAX_ATTEMPTS) {
          await this.#append({
            details: `Compensation stopped after ${String(completedAttempts)} authoritatively non-applied attempts`,
            effectId: effect.id,
            kind: 'EFFECT_COMPENSATION_FAILED',
          });
          return;
        }
        const attemptNumber = completedAttempts + 1;
        await this.#callCompensation(effect, adapter, result, attemptNumber);
        return;
      }
      await this.#append({
        details: outcome.details,
        effectId: effect.id,
        kind: 'EFFECT_COMPENSATION_UNRESOLVED',
      });
    } catch (error) {
      rethrowSimulatedDeath(error);
      await this.#append({
        details: `Compensation reconciliation failed: ${describeError(error)}`,
        effectId: effect.id,
        kind: 'EFFECT_COMPENSATION_UNRESOLVED',
      });
    }
  }

  async #recordCompensationVerification(effectId: string, verification: VerificationResult): Promise<void> {
    await this.#append({ effectId, kind: 'EFFECT_COMPENSATION_VERIFICATION_STARTED' });
    await this.#append({
      details: verification.details,
      effectId,
      kind: verification.verified ? 'EFFECT_COMPENSATED' : 'EFFECT_COMPENSATION_FAILED',
    });
  }

  #buildReceipt(effects: readonly Readonly<Effect>[]): Receipt {
    const effectReceipts = effects.map((effect) => {
      const events = this.#effectEvents(effect.id);
      const providerResult = [...events].reverse()
        .find((event) => event.kind === 'EFFECT_COMMIT_APPLIED')?.providerResult;
      let status: Receipt['effects'][number]['status'] = 'not_attempted';
      let details = 'Provider mutation was not attempted';
      const lastRelevant = [...events].reverse().find((event) => event.details !== undefined);
      if (events.some((event) => event.kind === 'EFFECT_COMPENSATED')) status = 'compensated';
      else if (events.some((event) => (
        event.kind === 'EFFECT_COMMIT_UNRESOLVED'
        || event.kind === 'EFFECT_COMPENSATION_UNRESOLVED'
      ))) status = 'unresolved';
      else if (events.some((event) => (
        event.kind === 'EFFECT_VERIFICATION_FAILED'
        || event.kind === 'EFFECT_COMPENSATION_FAILED'
      ))) status = 'residual';
      else if (events.some((event) => event.kind === 'EFFECT_COMMIT_FAILED')) status = 'failed';
      else if (events.some((event) => event.kind === 'EFFECT_VERIFIED')) status = 'committed_verified';
      if (status !== 'not_attempted') details = lastRelevant?.details ?? status;
      return {
        adapterId: effect.adapterId,
        attemptCount: events.filter((event) => event.kind === 'EFFECT_COMMIT_STARTED').length,
        compensationAttemptCount: events.filter(
          (event) => event.kind === 'EFFECT_COMPENSATION_STARTED',
        ).length,
        details,
        effectId: effect.id,
        ...(providerResult === undefined ? {} : { providerResult }),
        status,
      };
    });
    const runIncomplete = effectReceipts.some((effect) => (
      effect.status === 'failed' || effect.status === 'residual' || effect.status === 'unresolved'
    ));
    if (runIncomplete) {
      for (const effect of effectReceipts) {
        if (effect.status === 'committed_verified') {
          effect.status = 'residual';
          effect.details = 'Committed and verified provider state remains after an incomplete run';
        }
      }
    }
    const knownResiduals = effectReceipts
      .filter((effect) => effect.status === 'residual')
      .map((effect) => ({ details: effect.details, effectId: effect.effectId }));
    const unresolved = effectReceipts
      .filter((effect) => effect.status === 'unresolved')
      .map((effect) => ({ details: effect.details, effectId: effect.effectId }));
    const anyFailure = effectReceipts.some((effect) => effect.status === 'failed');
    const terminalStatus: Receipt['terminalStatus'] = unresolved.length > 0
      ? 'REQUIRES_ATTENTION'
      : knownResiduals.length > 0
        ? 'COMPLETED_WITH_RESIDUALS'
        : anyFailure
          ? 'COMPENSATED'
          : 'COMMITTED_VERIFIED';
    return receiptSchema.parse({
      approvalDigest: this.#seed.approval.approvalDigest,
      effects: effectReceipts,
      graphDigest: this.#seed.approval.graphDigest,
      knownResidualCount: knownResiduals.length,
      knownResiduals,
      revisionId: this.#seed.revision.id,
      runId: this.#seed.runId,
      terminalStatus,
      transactionId: this.#seed.revision.transactionId,
      unresolved,
      unresolvedCount: unresolved.length,
    });
  }

  async #append(event: SagaJournalEvent): Promise<void> {
    const label = `${event.kind}:${event.effectId ?? 'run'}${
      event.attemptNumber === undefined ? '' : `:${String(event.attemptNumber)}`
    }`;
    await this.#checkpoint(`before-journal:${label}`);
    const entry = await this.#input.store.appendEvent(this.#lease, event, this.#now());
    this.#events.push(entry);
    await this.#checkpoint(`after-journal:${label}`);
  }

  #assertAdapterVersions(): void {
    for (const [adapterId, version] of Object.entries(this.#seed.approval.adapterVersions)) {
      const adapter = this.#requiredAdapter(adapterId);
      if (adapter.adapterVersion !== version) {
        throw new Error(`Durable adapter version changed: ${adapterId}`);
      }
    }
  }

  #orderedEffects(): readonly Readonly<Effect>[] {
    const graph = this.#seed.revision.effectGraph;
    if (graph === null) throw new Error('Durable saga requires a sealed effect graph');
    return this.#seed.approval.effectOrder.map((effectId) => {
      const effect = graph.effects.find((candidate) => candidate.id === effectId);
      if (effect === undefined) throw new Error(`Approved effect is missing: ${effectId}`);
      return effect;
    });
  }

  #latestCommitResult(
    effect: Readonly<Effect>,
    adapter: ErasedDurableCommitAdapter,
  ): CommitResult<unknown> | undefined {
    const event = [...this.#effectEvents(effect.id)].reverse()
      .find((candidate) => candidate.kind === 'EFFECT_COMMIT_APPLIED');
    return event?.providerResult === undefined ? undefined : adapter.parseCommitResult(event.providerResult);
  }

  #currentCommitOutcome(effectId: string): EffectOutcome {
    const events = this.#effectEvents(effectId);
    if (events.some((event) => event.kind === 'EFFECT_COMMIT_UNRESOLVED')) return 'UNRESOLVED';
    if (events.some((event) => event.kind === 'EFFECT_COMMIT_FAILED')) return 'FAILED';
    return 'VERIFICATION_FAILED';
  }

  #effectEvents(effectId: string): SagaJournalEntry[] {
    return this.#events.filter((event) => event.effectId === effectId);
  }

  #has(kind: SagaJournalEntry['kind']): boolean {
    return this.#events.some((event) => event.kind === kind);
  }

  #requiredAdapter(adapterId: string): ErasedDurableCommitAdapter {
    const adapter = this.#adapters.get(adapterId);
    if (adapter === undefined) throw new Error(`Missing durable adapter: ${adapterId}`);
    return adapter;
  }

  #commitKey(effectId: string): string {
    return `${this.#seed.approval.graphDigest}:${effectId}:commit`;
  }

  #compensationKey(effectId: string): string {
    return `${this.#seed.approval.graphDigest}:${effectId}:compensate`;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown provider error';
}

function rethrowSimulatedDeath(error: unknown): void {
  if (error instanceof SimulatedProcessDeathError) throw error;
}
