import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { canonicalize, receiptSchema, type Receipt } from '@preview/domain';

import type {
  ExecutionLease,
  SagaJournalEntry,
  SagaJournalEvent,
  SagaRunSeed,
  SagaStore,
} from './contracts.js';
import { deepFreeze, parseJournalEntry, parseReceipt, parseRunSeed } from './validation.js';

export class FileSagaStore implements SagaStore {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = root;
  }

  public async createOrLoadRun(seed: SagaRunSeed): Promise<Readonly<SagaRunSeed>> {
    const parsed = parseRunSeed(seed);
    await mkdir(this.#runDirectory(parsed.runId), { recursive: true });
    return this.#withLock(async () => {
      const path = this.#seedPath(parsed.runId);
      const current = await this.#readJson<SagaRunSeed>(path);
      if (current !== undefined) {
        const validated = parseRunSeed(current);
        if (canonicalize(validated) !== canonicalize(parsed)) {
          throw new Error(`Saga run ${parsed.runId} was reused with different content`);
        }
        return validated;
      }
      await this.#writeExclusiveDurable(path, parsed);
      return parsed;
    });
  }

  public async loadRun(runId: string): Promise<Readonly<SagaRunSeed> | undefined> {
    const value = await this.#readJson<SagaRunSeed>(this.#seedPath(runId));
    return value === undefined ? undefined : parseRunSeed(value);
  }

  public async acquireLease(
    runId: string,
    ownerId: string,
    now: Date,
    ttlMs: number,
  ): Promise<Readonly<ExecutionLease> | undefined> {
    if (await this.loadRun(runId) === undefined) throw new Error(`Unknown saga run: ${runId}`);
    return this.#withLock(async () => {
      const leasePath = this.#leasePath(runId);
      const current = await this.#readJson<ExecutionLease>(leasePath);
      if (current !== undefined && Date.parse(current.expiresAt) > now.getTime()) return undefined;
      const fencePath = this.#fencePath(runId);
      const priorFence = Number.parseInt(await this.#readText(fencePath) ?? '0', 10);
      const fencingToken = (Number.isNaN(priorFence) ? 0 : priorFence) + 1;
      await this.#writeDurable(fencePath, String(fencingToken));
      const lease = deepFreeze({
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        fencingToken,
        ownerId,
        runId,
      });
      await this.#writeDurable(leasePath, JSON.stringify(lease));
      return lease;
    });
  }

  public async appendEvent(
    lease: ExecutionLease,
    event: SagaJournalEvent,
    at: Date,
  ): Promise<Readonly<SagaJournalEntry>> {
    return this.#withLock(async () => {
      await this.#assertLease(lease, at);
      const seed = await this.loadRun(lease.runId);
      if (seed?.revision.graphDigest == null) {
        throw new Error(`Saga run ${lease.runId} is missing its sealed graph`);
      }
      const events = await this.listEvents(lease.runId);
      const entry = parseJournalEntry({
        ...structuredClone(event),
        at: at.toISOString(),
        fencingToken: lease.fencingToken,
        graphDigest: seed.revision.graphDigest,
        runId: lease.runId,
        sequence: events.length + 1,
      });
      await this.#appendDurable(this.#eventsPath(lease.runId), `${JSON.stringify(entry)}\n`);
      return entry;
    });
  }

  public async listEvents(runId: string): Promise<readonly Readonly<SagaJournalEntry>[]> {
    const text = await this.#readText(this.#eventsPath(runId));
    if (text === undefined || text.length === 0) return deepFreeze([]);
    const completeText = text.endsWith('\n')
      ? text
      : text.slice(0, Math.max(0, text.lastIndexOf('\n') + 1));
    return deepFreeze(completeText.split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) => parseJournalEntry(JSON.parse(line) as SagaJournalEntry)));
  }

  public async loadReceipt(runId: string): Promise<Readonly<Receipt> | undefined> {
    const value = await this.#readJson<Receipt>(this.#receiptPath(runId));
    return value === undefined ? undefined : parseReceipt(value);
  }

  public async recordReceipt(
    lease: ExecutionLease,
    receipt: Receipt,
    at: Date,
  ): Promise<Readonly<Receipt>> {
    return this.#withLock(async () => {
      await this.#assertLease(lease, at);
      const parsed = parseReceipt(receiptSchema.parse(receipt));
      const current = await this.loadReceipt(lease.runId);
      if (current !== undefined) {
        if (canonicalize(current) !== canonicalize(parsed)) {
          throw new Error(`Saga run ${lease.runId} already has a different receipt`);
        }
        return current;
      }
      await this.#writeExclusiveDurable(this.#receiptPath(lease.runId), parsed);
      return parsed;
    });
  }

  public async releaseLease(lease: ExecutionLease): Promise<void> {
    await this.#withLock(async () => {
      const current = await this.#readJson<ExecutionLease>(this.#leasePath(lease.runId));
      if (
        current?.ownerId === lease.ownerId
        && current.fencingToken === lease.fencingToken
      ) {
        await this.#unlinkIfPresent(this.#leasePath(lease.runId));
      }
    });
  }

  async #assertLease(lease: ExecutionLease, at: Date): Promise<void> {
    const current = await this.#readJson<ExecutionLease>(this.#leasePath(lease.runId));
    if (
      current?.ownerId !== lease.ownerId
      || current.fencingToken !== lease.fencingToken
      || Date.parse(current.expiresAt) <= at.getTime()
    ) {
      throw new Error(`Stale or expired saga lease for ${lease.runId}`);
    }
  }

  async #withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.#root, { recursive: true });
    const lockPath = join(this.#root, '.store.lock');
    let handle;
    const lockToken = randomUUID();
    for (;;) {
      try {
        handle = await open(lockPath, 'wx');
        await handle.writeFile(JSON.stringify({
          createdAt: new Date().toISOString(),
          pid: process.pid,
          token: lockToken,
        }), 'utf8');
        await handle.sync();
        break;
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
        if (await this.#lockIsRecoverable(lockPath)) {
          await this.#unlinkIfPresent(lockPath);
          continue;
        }
        await delay(10);
      }
    }
    try {
      return await action();
    } finally {
      await handle.close();
      await this.#releaseOwnedLock(lockPath, lockToken);
    }
  }

  async #writeExclusiveDurable(path: string, value: unknown): Promise<void> {
    if (await this.#readText(path) !== undefined) throw new Error(`Durable record already exists: ${path}`);
    await this.#writeAtomic(path, JSON.stringify(value));
  }

  async #writeDurable(path: string, value: string): Promise<void> {
    await this.#writeAtomic(path, value);
  }

  async #writeAtomic(path: string, value: string): Promise<void> {
    const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(value, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      await this.#unlinkIfPresent(temporaryPath);
      throw error;
    }
  }

  async #appendDurable(path: string, value: string): Promise<void> {
    await this.#repairJournalTail(path);
    const handle = await open(path, 'a');
    try {
      await handle.writeFile(value, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #readJson<T>(path: string): Promise<T | undefined> {
    const text = await this.#readText(path);
    return text === undefined ? undefined : JSON.parse(text) as T;
  }

  async #readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async #unlinkIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    }
  }

  async #repairJournalTail(path: string): Promise<void> {
    const text = await this.#readText(path);
    if (text === undefined || text.length === 0 || text.endsWith('\n')) return;
    const validLength = Buffer.byteLength(text.slice(0, Math.max(0, text.lastIndexOf('\n') + 1)), 'utf8');
    const handle = await open(path, 'r+');
    try {
      await handle.truncate(validLength);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #lockIsRecoverable(path: string): Promise<boolean> {
    const lockText = await this.#readText(path);
    if (lockText !== undefined) {
      try {
        const parsed = JSON.parse(lockText) as { readonly pid?: unknown };
        if (typeof parsed.pid === 'number') return !processIsAlive(parsed.pid);
      } catch {
        // A competing writer can be between exclusive create and durable lock metadata.
      }
    }
    try {
      const metadata = await stat(path);
      return Date.now() - metadata.mtimeMs > 5_000;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async #releaseOwnedLock(path: string, token: string): Promise<void> {
    const lockText = await this.#readText(path);
    if (lockText === undefined) return;
    try {
      const parsed = JSON.parse(lockText) as { readonly token?: unknown };
      if (parsed.token === token) await this.#unlinkIfPresent(path);
    } catch {
      // A replaced or damaged lock is never removed without matching ownership.
    }
  }

  #runDirectory(runId: string): string {
    return join(this.#root, Buffer.from(runId, 'utf8').toString('base64url'));
  }

  #seedPath(runId: string): string {
    return join(this.#runDirectory(runId), 'seed.json');
  }

  #eventsPath(runId: string): string {
    return join(this.#runDirectory(runId), 'events.ndjson');
  }

  #receiptPath(runId: string): string {
    return join(this.#runDirectory(runId), 'receipt.json');
  }

  #leasePath(runId: string): string {
    return join(this.#runDirectory(runId), 'lease.json');
  }

  #fencePath(runId: string): string {
    return join(this.#runDirectory(runId), 'fence.txt');
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error) || error.code !== 'ESRCH';
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
