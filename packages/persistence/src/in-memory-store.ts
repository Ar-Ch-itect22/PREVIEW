import { canonicalize, receiptSchema, type Receipt } from '@preview/domain';

import type {
  ExecutionLease,
  SagaJournalEntry,
  SagaJournalEvent,
  SagaRunSeed,
  SagaStore,
} from './contracts.js';
import { deepFreeze, parseJournalEntry, parseReceipt, parseRunSeed } from './validation.js';

interface StoredRun {
  readonly events: SagaJournalEntry[];
  fencingToken: number;
  lease: ExecutionLease | undefined;
  receipt: Receipt | undefined;
  readonly seed: SagaRunSeed;
}

export class InMemorySagaStore implements SagaStore {
  readonly #runs = new Map<string, StoredRun>();

  public createOrLoadRun(seed: SagaRunSeed): Promise<Readonly<SagaRunSeed>> {
    const parsed = parseRunSeed(seed);
    const current = this.#runs.get(parsed.runId);
    if (current !== undefined) {
      if (canonicalize(current.seed) !== canonicalize(parsed)) {
        throw new Error(`Saga run ${parsed.runId} was reused with different content`);
      }
      return Promise.resolve(deepFreeze(structuredClone(current.seed)));
    }
    this.#runs.set(parsed.runId, {
      events: [],
      fencingToken: 0,
      lease: undefined,
      receipt: undefined,
      seed: structuredClone(parsed),
    });
    return Promise.resolve(parsed);
  }

  public loadRun(runId: string): Promise<Readonly<SagaRunSeed> | undefined> {
    const run = this.#runs.get(runId);
    return Promise.resolve(run === undefined
      ? undefined
      : deepFreeze(structuredClone(run.seed)));
  }

  public acquireLease(
    runId: string,
    ownerId: string,
    now: Date,
    ttlMs: number,
  ): Promise<Readonly<ExecutionLease> | undefined> {
    const run = this.#requiredRun(runId);
    if (run.lease !== undefined && Date.parse(run.lease.expiresAt) > now.getTime()) {
      return Promise.resolve(undefined);
    }
    run.fencingToken += 1;
    run.lease = deepFreeze({
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      fencingToken: run.fencingToken,
      ownerId,
      runId,
    });
    return Promise.resolve(run.lease);
  }

  public appendEvent(
    lease: ExecutionLease,
    event: SagaJournalEvent,
    at: Date,
  ): Promise<Readonly<SagaJournalEntry>> {
    return Promise.resolve().then(() => {
      const run = this.#assertLease(lease, at);
      const graphDigest = run.seed.revision.graphDigest;
      if (graphDigest === null) throw new Error(`Saga run ${lease.runId} is missing its sealed graph`);
      const entry = parseJournalEntry({
        ...structuredClone(event),
        at: at.toISOString(),
        fencingToken: lease.fencingToken,
        graphDigest,
        runId: lease.runId,
        sequence: run.events.length + 1,
      });
      run.events.push(structuredClone(entry));
      return entry;
    });
  }

  public listEvents(runId: string): Promise<readonly Readonly<SagaJournalEntry>[]> {
    return Promise.resolve(deepFreeze(structuredClone(this.#requiredRun(runId).events)));
  }

  public loadReceipt(runId: string): Promise<Readonly<Receipt> | undefined> {
    const receipt = this.#requiredRun(runId).receipt;
    return Promise.resolve(receipt === undefined ? undefined : deepFreeze(structuredClone(receipt)));
  }

  public recordReceipt(
    lease: ExecutionLease,
    receipt: Receipt,
    at: Date,
  ): Promise<Readonly<Receipt>> {
    const run = this.#assertLease(lease, at);
    const parsed = parseReceipt(receiptSchema.parse(receipt));
    if (run.receipt !== undefined && canonicalize(run.receipt) !== canonicalize(parsed)) {
      throw new Error(`Saga run ${lease.runId} already has a different receipt`);
    }
    run.receipt = structuredClone(parsed);
    return Promise.resolve(parsed);
  }

  public releaseLease(lease: ExecutionLease): Promise<void> {
    const run = this.#requiredRun(lease.runId);
    if (
      run.lease?.ownerId === lease.ownerId
      && run.lease.fencingToken === lease.fencingToken
    ) {
      run.lease = undefined;
    }
    return Promise.resolve();
  }

  #requiredRun(runId: string): StoredRun {
    const run = this.#runs.get(runId);
    if (run === undefined) throw new Error(`Unknown saga run: ${runId}`);
    return run;
  }

  #assertLease(lease: ExecutionLease, at: Date): StoredRun {
    const run = this.#requiredRun(lease.runId);
    if (
      run.lease?.ownerId !== lease.ownerId
      || run.lease.fencingToken !== lease.fencingToken
      || Date.parse(run.lease.expiresAt) <= at.getTime()
    ) {
      throw new Error(`Stale or expired saga lease for ${lease.runId}`);
    }
    return run;
  }
}
