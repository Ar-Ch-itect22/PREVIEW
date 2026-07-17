import { appendFile, mkdtemp, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ApprovalValidationError,
  ContentBoundApprovalAuthority,
} from '@preview/approval';
import {
  FileRevisionInvalidationStore,
  FileSagaStore,
  InMemorySagaStore,
} from '@preview/persistence';
import {
  executeDurableSaga,
  SagaLeaseUnavailableError,
  SimulatedProcessDeathError,
  type ErasedDurableCommitAdapter,
} from '@preview/worker';
import { describe, expect, it } from 'vitest';

import {
  createHeroDraft,
  createHeroProviders,
  prepareFailureLab,
  runCustomerOpsSimulation,
  type PreparedFailureLab,
} from '../src/index.js';

describe('Gate 6 durable saga and Failure Lab', () => {
  it('withholds Mail, compensates Calendar, and reports zero residual state when CRM fails', async () => {
    const lab = await prepareFailureLab({ crmFailsBeforeWrite: true });
    const receipt = await lab.execute();
    const calendar = await lab.providers.calendar.createReadPort().readEvent('acme-renewal');

    expect(receipt.terminalStatus).toBe('COMPENSATED');
    expect(receipt.effects.map(({ adapterId, status }) => ({ adapterId, status }))).toEqual([
      { adapterId: 'reference-calendar', status: 'compensated' },
      { adapterId: 'reference-crm', status: 'failed' },
      { adapterId: 'reference-mail', status: 'not_attempted' },
    ]);
    expect(receipt.knownResidualCount).toBe(0);
    expect(receipt.unresolvedCount).toBe(0);
    expect(calendar).toMatchObject({
      end: '2026-07-20T10:30:00.000Z',
      start: '2026-07-20T10:00:00.000Z',
    });
    expect(lab.providers.calendar.mutationCount).toBe(2);
    expect(lab.providers.crm.mutationCount).toBe(0);
    expect(lab.providers.mail.mutationCount).toBe(0);
  });

  it('reconciles an ambiguous Mail success without duplicate delivery', async () => {
    const lab = await prepareFailureLab({ mailFault: 'AMBIGUOUS_AFTER_WRITE' });
    const receipt = await lab.execute();

    expect(receipt.terminalStatus).toBe('COMMITTED_VERIFIED');
    expect(receipt.effects.map((effect) => effect.status)).toEqual([
      'committed_verified',
      'committed_verified',
      'committed_verified',
    ]);
    expect(lab.providers.calendar.mutationCount).toBe(1);
    expect(lab.providers.crm.mutationCount).toBe(1);
    expect(lab.providers.mail.mutationCount).toBe(1);
  });

  it('never retries an unresolved irreversible Mail outcome', async () => {
    const lab = await prepareFailureLab({ mailFault: 'AMBIGUOUS_UNKNOWN' });
    const receipt = await lab.execute();

    expect(receipt.terminalStatus).toBe('REQUIRES_ATTENTION');
    expect(receipt.effects[2]).toMatchObject({
      adapterId: 'reference-mail',
      attemptCount: 1,
      status: 'unresolved',
    });
    expect(receipt.effects.slice(0, 2).map((effect) => effect.status)).toEqual([
      'residual',
      'residual',
    ]);
    expect(receipt.knownResidualCount).toBe(2);
    expect(receipt.unresolvedCount).toBe(1);
    expect(lab.providers.calendar.mutationCount).toBe(1);
    expect(lab.providers.crm.mutationCount).toBe(1);
    expect(lab.providers.mail.mutationCount).toBe(0);
  });

  it('bounds authoritatively non-applied retries and finishes with a safe receipt', async () => {
    const lab = await prepareFailureLab({ mailFault: 'AMBIGUOUS_NOT_APPLIED_ALWAYS' });
    const receipt = await lab.execute();

    expect(receipt.terminalStatus).toBe('COMPENSATED');
    expect(receipt.effects.map(({ attemptCount, status }) => ({ attemptCount, status }))).toEqual([
      { attemptCount: 1, status: 'compensated' },
      { attemptCount: 1, status: 'compensated' },
      { attemptCount: 2, status: 'failed' },
    ]);
    expect(receipt.knownResidualCount).toBe(0);
    expect(lab.providers.calendar.mutationCount).toBe(2);
    expect(lab.providers.crm.mutationCount).toBe(2);
    expect(lab.providers.mail.mutationCount).toBe(0);
  });

  it('bounds ambiguous compensation retries and reports the uncompensated state', async () => {
    const lab = await prepareFailureLab({ crmFailsBeforeWrite: true, runId: 'bounded-compensation' });
    const adapters = lab.createAdapters().map((adapter) => (
      adapter.adapterId === 'reference-calendar'
        ? Object.freeze({
          ...adapter,
          compensate: () => Promise.reject(new Error('Injected ambiguous compensation response')),
          reconcileCompensation: () => Promise.resolve({
            status: 'AUTHORITATIVELY_NOT_APPLIED' as const,
          }),
        })
        : adapter
    ));
    const receipt = await executeDurableSaga({
      adapters,
      authority: lab.authority,
      now: () => new Date('2026-07-17T00:00:00.000Z'),
      ownerId: 'bounded-compensation-worker',
      seed: lab.seed,
      store: lab.store,
    });

    expect(receipt.terminalStatus).toBe('COMPLETED_WITH_RESIDUALS');
    expect(receipt.effects[0]).toMatchObject({ compensationAttemptCount: 2, status: 'residual' });
    expect(receipt.knownResidualCount).toBe(1);
    expect(lab.providers.calendar.mutationCount).toBe(1);
  });

  it('allows authorized recovery after invalidation but blocks a not-yet-started commit', async () => {
    const recovering = await prepareFailureLab({ runId: 'invalidation-after-intent' });
    await expect(recovering.execute({
      checkpoint: (name) => {
        if (name === 'after-journal:EFFECT_COMMIT_STARTED:effect:calendar:acme-renewal:1') {
          throw new SimulatedProcessDeathError(name);
        }
      },
    })).rejects.toBeInstanceOf(SimulatedProcessDeathError);
    recovering.authority.invalidateRevision(recovering.seed.revision.id);
    const recovered = await executeDurableSaga({
      adapters: recovering.createAdapters(),
      authority: recovering.authority,
      now: () => new Date('2026-07-17T00:00:31.000Z'),
      ownerId: 'invalidation-recovery-worker',
      seed: recovering.seed,
      store: recovering.store,
    });
    expect(recovered.terminalStatus).toBe('COMMITTED_VERIFIED');

    const blocked = await prepareFailureLab({ runId: 'invalidation-before-intent' });
    await expect(blocked.execute({
      checkpoint: (name) => {
        if (name === 'after-journal:AUTHORIZATION_VERIFIED:run') {
          throw new SimulatedProcessDeathError(name);
        }
      },
    })).rejects.toBeInstanceOf(SimulatedProcessDeathError);
    blocked.authority.invalidateRevision(blocked.seed.revision.id);
    await expect(executeDurableSaga({
      adapters: blocked.createAdapters(),
      authority: blocked.authority,
      now: () => new Date('2026-07-17T00:00:31.000Z'),
      ownerId: 'invalidation-blocked-worker',
      seed: blocked.seed,
      store: blocked.store,
    })).rejects.toBeInstanceOf(ApprovalValidationError);
    expect(blocked.providers.calendar.mutationCount).toBe(0);
    expect(blocked.providers.crm.mutationCount).toBe(0);
    expect(blocked.providers.mail.mutationCount).toBe(0);
  });

  it('refuses compensation across post-commit drift and reports the known residual', async () => {
    const lab = await prepareFailureLab({ crmFailsBeforeWrite: true, runId: 'compensation-drift' });
    let drifted = false;
    const receipt = await lab.execute({
      checkpoint: async (name) => {
        if (!drifted && name === 'before-journal:EFFECT_COMPENSATION_STARTED:effect:calendar:acme-renewal:1') {
          drifted = true;
          await lab.providers.calendar.createCommitPort().commitMove({
            end: '2026-07-27T10:30:00.000Z',
            eventId: 'acme-renewal',
            start: '2026-07-27T10:00:00.000Z',
          }, 'v2', 'external-drift');
        }
      },
    });

    expect(receipt.terminalStatus).toBe('COMPLETED_WITH_RESIDUALS');
    expect(receipt.effects[0]).toMatchObject({
      adapterId: 'reference-calendar',
      status: 'residual',
    });
    expect(receipt.knownResidualCount).toBe(1);
    expect(receipt.unresolvedCount).toBe(0);
    expect(lab.providers.calendar.mutationCount).toBe(2);
    expect(lab.providers.mail.mutationCount).toBe(0);
  });

  it('persists replay invalidation across approval-authority reconstruction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preview-invalidation-'));
    try {
      const path = join(directory, 'invalidations.ndjson');
      const providers = createHeroProviders();
      const simulation = await runCustomerOpsSimulation(createHeroDraft('persistent-revision'), providers);
      const first = new ContentBoundApprovalAuthority(
        'persistent-signing-key',
        new FileRevisionInvalidationStore(path),
      );
      first.invalidateRevision(simulation.revision.id);
      const reconstructed = new ContentBoundApprovalAuthority(
        'persistent-signing-key',
        new FileRevisionInvalidationStore(path),
      );
      expect(() => reconstructed.approve(simulation.revision, {
        adapterVersions: {
          'reference-calendar': '1.0.0',
          'reference-crm': '1.0.0',
          'reference-mail': '1.0.0',
        },
        approverId: 'aru',
        expiresAt: '2026-07-20T00:00:00.000Z',
        policyVersions: { transaction: 'gate-6' },
        snapshot: simulation.snapshot,
        tenantId: 'tenant-1',
      })).toThrow(ApprovalValidationError);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('recovers an orphaned file lock and truncates an incomplete journal tail', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preview-file-recovery-'));
    try {
      const store = new FileSagaStore(directory);
      const lab = await prepareFailureLab({ runId: 'file-recovery-run', store });
      await store.createOrLoadRun(lab.seed);
      const firstLease = await store.acquireLease(
        lab.seed.runId,
        'file-worker-one',
        new Date('2026-07-17T00:00:00.000Z'),
        30_000,
      );
      if (firstLease === undefined) throw new Error('Expected file lease');
      await store.appendEvent(firstLease, { kind: 'AUTHORIZATION_VERIFIED' }, new Date('2026-07-17T00:00:00.000Z'));
      await store.releaseLease(firstLease);

      const runDirectory = join(directory, Buffer.from(lab.seed.runId, 'utf8').toString('base64url'));
      await appendFile(join(runDirectory, 'events.ndjson'), '{"truncated":', 'utf8');
      await writeFile(join(directory, '.store.lock'), JSON.stringify({ pid: 999_999_999 }), 'utf8');

      const secondLease = await store.acquireLease(
        lab.seed.runId,
        'file-worker-two',
        new Date('2026-07-17T00:00:01.000Z'),
        30_000,
      );
      if (secondLease === undefined) throw new Error('Expected recovered file lease');
      await store.appendEvent(secondLease, { kind: 'RUN_STARTED' }, new Date('2026-07-17T00:00:01.000Z'));
      expect((await store.listEvents(lab.seed.runId)).map((event) => event.kind)).toEqual([
        'AUTHORIZATION_VERIFIED',
        'RUN_STARTED',
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('never steals an old file lock owned by a live process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preview-live-lock-'));
    try {
      const store = new FileSagaStore(directory);
      const lab = await prepareFailureLab({ runId: 'live-lock-run', store });
      await store.createOrLoadRun(lab.seed);
      const lockPath = join(directory, '.store.lock');
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: 'live-owner' }), 'utf8');
      const old = new Date(Date.now() - 60_000);
      await utimes(lockPath, old, old);
      let acquired = false;
      const pending = store.acquireLease(
        lab.seed.runId,
        'waiting-worker',
        new Date('2026-07-17T00:00:00.000Z'),
        30_000,
      ).then((lease) => {
        acquired = true;
        return lease;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(acquired).toBe(false);
      await unlink(lockPath);
      const lease = await pending;
      expect(lease?.ownerId).toBe('waiting-worker');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('fences concurrent and stale workers', async () => {
    const store = new InMemorySagaStore();
    const lab = await prepareFailureLab({ store });
    await store.createOrLoadRun(lab.seed);
    const first = await store.acquireLease(lab.seed.runId, 'worker-one', new Date('2026-07-17T00:00:00Z'), 30_000);
    if (first === undefined) throw new Error('Expected the first worker to acquire a lease');
    expect(first).toBeDefined();
    await expect(store.acquireLease(
      lab.seed.runId,
      'worker-two',
      new Date('2026-07-17T00:00:01Z'),
      30_000,
    )).resolves.toBeUndefined();
    const second = await store.acquireLease(
      lab.seed.runId,
      'worker-two',
      new Date('2026-07-17T00:00:31Z'),
      30_000,
    );
    expect(second?.fencingToken).toBe(2);
    await expect(store.appendEvent(
      first,
      { kind: 'RUN_STARTED' },
      new Date('2026-07-17T00:00:31Z'),
    )).rejects.toThrow(/Stale or expired/u);
  });

  it('recovers from process death at every happy-path journal and provider boundary', async () => {
    const baseline = await prepareFailureLab({ runId: 'checkpoint-baseline' });
    const checkpoints: string[] = [];
    await baseline.execute({ checkpoint: (name) => { checkpoints.push(name); } });
    expect(checkpoints.length).toBeGreaterThan(20);

    for (const [index, checkpoint] of checkpoints.entries()) {
      const directory = await mkdtemp(join(tmpdir(), 'preview-saga-'));
      try {
        const firstStore = new FileSagaStore(directory);
        const lab = await prepareFailureLab({ runId: `crash-happy-${String(index)}`, store: firstStore });
        let crashed = false;
        await expect(lab.execute({
          checkpoint: (name) => {
            if (!crashed && name === checkpoint) {
              crashed = true;
              throw new SimulatedProcessDeathError(name);
            }
          },
        })).rejects.toBeInstanceOf(SimulatedProcessDeathError);

        const resumed = await executeDurableSaga({
          adapters: lab.createAdapters(),
          authority: lab.authority,
          now: () => new Date('2026-07-17T00:00:31.000Z'),
          ownerId: `resume-${String(index)}`,
          seed: lab.seed,
          store: new FileSagaStore(directory),
        });
        expect(resumed.terminalStatus).toBe('COMMITTED_VERIFIED');
        expect(lab.providers.calendar.mutationCount).toBe(1);
        expect(lab.providers.crm.mutationCount).toBe(1);
        expect(lab.providers.mail.mutationCount).toBe(1);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  }, 60_000);

  it('recovers from process death at every failure and compensation boundary', async () => {
    const baseline = await prepareFailureLab({
      crmFailsBeforeWrite: true,
      runId: 'failure-checkpoint-baseline',
    });
    const checkpoints: string[] = [];
    await baseline.execute({ checkpoint: (name) => { checkpoints.push(name); } });
    expect(checkpoints.some((name) => name.includes('COMPENSATION'))).toBe(true);

    for (const [index, checkpoint] of checkpoints.entries()) {
      const directory = await mkdtemp(join(tmpdir(), 'preview-saga-failure-'));
      try {
        const firstStore = new FileSagaStore(directory);
        const lab = await prepareFailureLab({
          crmFailsBeforeWrite: true,
          runId: `crash-failure-${String(index)}`,
          store: firstStore,
        });
        let crashed = false;
        await expect(lab.execute({
          checkpoint: (name) => {
            if (!crashed && name === checkpoint) {
              crashed = true;
              throw new SimulatedProcessDeathError(name);
            }
          },
        })).rejects.toBeInstanceOf(SimulatedProcessDeathError);

        const resumed = await executeDurableSaga({
          adapters: lab.createAdapters(),
          authority: lab.authority,
          now: () => new Date('2026-07-17T00:00:31.000Z'),
          ownerId: `failure-resume-${String(index)}`,
          seed: lab.seed,
          store: new FileSagaStore(directory),
        });
        expect(resumed.terminalStatus).toBe('COMPENSATED');
        expect(resumed.knownResidualCount).toBe(0);
        expect(resumed.unresolvedCount).toBe(0);
        expect(lab.providers.calendar.mutationCount).toBe(2);
        expect(lab.providers.crm.mutationCount).toBe(0);
        expect(lab.providers.mail.mutationCount).toBe(0);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  }, 60_000);

  it('crash-tests recovery-only commit, compensation, and irreversible reconciliation boundaries', async () => {
    const commitReconciliationBoundaries = [
      'before-journal:EFFECT_COMMIT_RECONCILIATION_STARTED:effect:calendar:acme-renewal',
      'after-journal:EFFECT_COMMIT_RECONCILIATION_STARTED:effect:calendar:acme-renewal',
    ];
    for (const [index, boundary] of commitReconciliationBoundaries.entries()) {
      const lab = await prepareFailureLab({ runId: `commit-reconciliation-${String(index)}` });
      await expect(lab.execute({
        checkpoint: (name) => {
          if (name === 'after-provider-commit:effect:calendar:acme-renewal:1') {
            throw new SimulatedProcessDeathError(name);
          }
        },
      })).rejects.toBeInstanceOf(SimulatedProcessDeathError);
      await expect(executeDurableSaga({
        adapters: lab.createAdapters(),
        authority: lab.authority,
        checkpoint: (name) => {
          if (name === boundary) throw new SimulatedProcessDeathError(name);
        },
        now: () => new Date('2026-07-17T00:00:31.000Z'),
        ownerId: `commit-reconciliation-crash-${String(index)}`,
        seed: lab.seed,
        store: lab.store,
      })).rejects.toBeInstanceOf(SimulatedProcessDeathError);
      const receipt = await executeDurableSaga({
        adapters: lab.createAdapters(),
        authority: lab.authority,
        now: () => new Date('2026-07-17T00:01:02.000Z'),
        ownerId: `commit-reconciliation-finish-${String(index)}`,
        seed: lab.seed,
        store: lab.store,
      });
      expect(receipt.terminalStatus).toBe('COMMITTED_VERIFIED');
      expect(lab.providers.mail.mutationCount).toBe(1);
    }

    const compensationReconciliationBoundaries = [
      'before-journal:EFFECT_COMPENSATION_RECONCILIATION_STARTED:effect:calendar:acme-renewal',
      'after-journal:EFFECT_COMPENSATION_RECONCILIATION_STARTED:effect:calendar:acme-renewal',
    ];
    for (const [index, boundary] of compensationReconciliationBoundaries.entries()) {
      const lab = await prepareFailureLab({
        crmFailsBeforeWrite: true,
        runId: `compensation-reconciliation-${String(index)}`,
      });
      await expect(lab.execute({
        checkpoint: (name) => {
          if (name === 'after-provider-compensate:effect:calendar:acme-renewal:1') {
            throw new SimulatedProcessDeathError(name);
          }
        },
      })).rejects.toBeInstanceOf(SimulatedProcessDeathError);
      await expect(executeDurableSaga({
        adapters: lab.createAdapters(),
        authority: lab.authority,
        checkpoint: (name) => {
          if (name === boundary) throw new SimulatedProcessDeathError(name);
        },
        now: () => new Date('2026-07-17T00:00:31.000Z'),
        ownerId: `compensation-reconciliation-crash-${String(index)}`,
        seed: lab.seed,
        store: lab.store,
      })).rejects.toBeInstanceOf(SimulatedProcessDeathError);
      const receipt = await executeDurableSaga({
        adapters: lab.createAdapters(),
        authority: lab.authority,
        now: () => new Date('2026-07-17T00:01:02.000Z'),
        ownerId: `compensation-reconciliation-finish-${String(index)}`,
        seed: lab.seed,
        store: lab.store,
      });
      expect(receipt.terminalStatus).toBe('COMPENSATED');
      expect(lab.providers.calendar.mutationCount).toBe(2);
    }

    const irreversibleReconciliationBoundaries = [
      'before-journal:EFFECT_COMMIT_RECONCILIATION_STARTED:effect:mail:mail-acme-renewal',
      'after-journal:EFFECT_COMMIT_RECONCILIATION_STARTED:effect:mail:mail-acme-renewal',
    ];
    for (const [index, boundary] of irreversibleReconciliationBoundaries.entries()) {
      const lab = await prepareFailureLab({
        mailFault: 'AMBIGUOUS_AFTER_WRITE',
        runId: `mail-reconciliation-${String(index)}`,
      });
      await expect(lab.execute({
        checkpoint: (name) => {
          if (name === boundary) throw new SimulatedProcessDeathError(name);
        },
      })).rejects.toBeInstanceOf(SimulatedProcessDeathError);
      const receipt = await executeDurableSaga({
        adapters: lab.createAdapters(),
        authority: lab.authority,
        now: () => new Date('2026-07-17T00:00:31.000Z'),
        ownerId: `mail-reconciliation-finish-${String(index)}`,
        seed: lab.seed,
        store: lab.store,
      });
      expect(receipt.terminalStatus).toBe('COMMITTED_VERIFIED');
      expect(lab.providers.mail.mutationCount).toBe(1);
    }
  });

  it('crash-tests unresolved, verification-failed, compensation-failed, and second-attempt journal outcomes', async () => {
    const crashAndResume = async (
      lab: PreparedFailureLab,
      createAdapters: () => readonly ErasedDurableCommitAdapter[],
      boundary: string,
    ) => {
      await expect(executeDurableSaga({
        adapters: createAdapters(),
        authority: lab.authority,
        checkpoint: (name) => {
          if (name === boundary) throw new SimulatedProcessDeathError(name);
        },
        now: () => new Date('2026-07-17T00:00:00.000Z'),
        ownerId: `boundary-crash-${boundary}`,
        seed: lab.seed,
        store: lab.store,
      })).rejects.toBeInstanceOf(SimulatedProcessDeathError);
      return executeDurableSaga({
        adapters: createAdapters(),
        authority: lab.authority,
        now: () => new Date('2026-07-17T00:00:31.000Z'),
        ownerId: `boundary-finish-${boundary}`,
        seed: lab.seed,
        store: lab.store,
      });
    };

    for (const side of ['before', 'after'] as const) {
      const unresolved = await prepareFailureLab({
        mailFault: 'AMBIGUOUS_UNKNOWN',
        runId: `commit-unresolved-${side}`,
      });
      const unresolvedReceipt = await crashAndResume(
        unresolved,
        () => unresolved.createAdapters(),
        `${side}-journal:EFFECT_COMMIT_UNRESOLVED:effect:mail:mail-acme-renewal`,
      );
      expect(unresolvedReceipt.terminalStatus).toBe('REQUIRES_ATTENTION');
      expect(unresolved.providers.mail.mutationCount).toBe(0);

      const verification = await prepareFailureLab({ runId: `verification-failed-${side}` });
      const verificationAdapters = (): readonly ErasedDurableCommitAdapter[] => (
        verification.createAdapters().map((adapter) => (
          adapter.adapterId === 'reference-mail'
            ? Object.freeze({
              ...adapter,
              verify: () => Promise.resolve({ details: 'Injected Mail verification mismatch', verified: false }),
            })
            : adapter
        ))
      );
      const verificationReceipt = await crashAndResume(
        verification,
        verificationAdapters,
        `${side}-journal:EFFECT_VERIFICATION_FAILED:effect:mail:mail-acme-renewal`,
      );
      expect(verificationReceipt.terminalStatus).toBe('COMPLETED_WITH_RESIDUALS');
      expect(verificationReceipt.effects[2]?.status).toBe('residual');

      const compensationUnknown = await prepareFailureLab({
        crmFailsBeforeWrite: true,
        runId: `compensation-unresolved-${side}`,
      });
      const unknownCompensationAdapters = (): readonly ErasedDurableCommitAdapter[] => (
        compensationUnknown.createAdapters().map((adapter) => (
          adapter.adapterId === 'reference-calendar'
            ? Object.freeze({
              ...adapter,
              compensate: () => Promise.reject(new Error('Injected ambiguous compensation')),
              reconcileCompensation: () => Promise.resolve({
                details: 'Injected compensation remains unknown',
                status: 'UNKNOWN' as const,
              }),
            })
            : adapter
        ))
      );
      const unknownCompensationReceipt = await crashAndResume(
        compensationUnknown,
        unknownCompensationAdapters,
        `${side}-journal:EFFECT_COMPENSATION_UNRESOLVED:effect:calendar:acme-renewal`,
      );
      expect(unknownCompensationReceipt.terminalStatus).toBe('REQUIRES_ATTENTION');
      expect(unknownCompensationReceipt.effects[0]?.status).toBe('unresolved');

      const compensationFailed = await prepareFailureLab({
        crmFailsBeforeWrite: true,
        runId: `compensation-failed-${side}`,
      });
      const failedCompensationAdapters = (): readonly ErasedDurableCommitAdapter[] => (
        compensationFailed.createAdapters().map((adapter) => (
          adapter.adapterId === 'reference-calendar'
            ? Object.freeze({
              ...adapter,
              compensate: async (...args: Parameters<typeof adapter.compensate>) => {
                await adapter.compensate(...args);
                return { details: 'Injected compensation verification mismatch', verified: false };
              },
              reconcileCompensation: async (
                ...args: Parameters<typeof adapter.reconcileCompensation>
              ) => {
                const outcome = await adapter.reconcileCompensation(...args);
                return outcome.status === 'APPLIED'
                  ? {
                    status: 'APPLIED' as const,
                    verification: {
                      details: 'Injected compensation verification mismatch',
                      verified: false,
                    },
                  }
                  : outcome;
              },
            })
            : adapter
        ))
      );
      const failedCompensationReceipt = await crashAndResume(
        compensationFailed,
        failedCompensationAdapters,
        `${side}-journal:EFFECT_COMPENSATION_FAILED:effect:calendar:acme-renewal`,
      );
      expect(failedCompensationReceipt.terminalStatus).toBe('COMPLETED_WITH_RESIDUALS');
      expect(failedCompensationReceipt.effects[0]?.status).toBe('residual');

      const secondCommit = await prepareFailureLab({
        mailFault: 'AMBIGUOUS_NOT_APPLIED_ALWAYS',
        runId: `second-commit-attempt-${side}`,
      });
      const secondCommitReceipt = await crashAndResume(
        secondCommit,
        () => secondCommit.createAdapters(),
        `${side}-journal:EFFECT_COMMIT_STARTED:effect:mail:mail-acme-renewal:2`,
      );
      expect(secondCommitReceipt.effects[2]).toMatchObject({ attemptCount: 2, status: 'failed' });

      const secondCompensation = await prepareFailureLab({
        crmFailsBeforeWrite: true,
        runId: `second-compensation-attempt-${side}`,
      });
      const secondCompensationAdapters = (): readonly ErasedDurableCommitAdapter[] => (
        secondCompensation.createAdapters().map((adapter) => (
          adapter.adapterId === 'reference-calendar'
            ? Object.freeze({
              ...adapter,
              compensate: () => Promise.reject(new Error('Injected ambiguous compensation')),
              reconcileCompensation: () => Promise.resolve({
                status: 'AUTHORITATIVELY_NOT_APPLIED' as const,
              }),
            })
            : adapter
        ))
      );
      const secondCompensationReceipt = await crashAndResume(
        secondCompensation,
        secondCompensationAdapters,
        `${side}-journal:EFFECT_COMPENSATION_STARTED:effect:calendar:acme-renewal:2`,
      );
      expect(secondCompensationReceipt.effects[0]).toMatchObject({
        compensationAttemptCount: 2,
        status: 'residual',
      });
    }
  }, 60_000);

  it('uses reconciliation after lease expiry during an in-flight Mail call', async () => {
    const lab = await prepareFailureLab({ runId: 'in-flight-lease-expiry' });
    let releaseProvider: (() => void) | undefined;
    let reportApplied: (() => void) | undefined;
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const providerApplied = new Promise<void>((resolve) => { reportApplied = resolve; });
    const firstAdapters = lab.createAdapters().map((adapter) => (
      adapter.adapterId === 'reference-mail'
        ? Object.freeze({
          ...adapter,
          commit: async (...args: Parameters<typeof adapter.commit>) => {
            const result = await adapter.commit(...args);
            reportApplied?.();
            await providerRelease;
            return result;
          },
        })
        : adapter
    ));
    let currentTime = new Date('2026-07-17T00:00:00.000Z');
    const firstExecution = executeDurableSaga({
      adapters: firstAdapters,
      authority: lab.authority,
      now: () => currentTime,
      ownerId: 'expired-in-flight-worker',
      seed: lab.seed,
      store: lab.store,
    });
    await providerApplied;
    currentTime = new Date('2026-07-17T00:00:31.000Z');
    const receipt = await executeDurableSaga({
      adapters: lab.createAdapters(),
      authority: lab.authority,
      now: () => currentTime,
      ownerId: 'replacement-worker',
      seed: lab.seed,
      store: lab.store,
    });
    releaseProvider?.();
    await expect(firstExecution).rejects.toThrow(/Stale or expired/u);

    expect(receipt.terminalStatus).toBe('COMMITTED_VERIFIED');
    expect(lab.providers.calendar.mutationCount).toBe(1);
    expect(lab.providers.crm.mutationCount).toBe(1);
    expect(lab.providers.mail.mutationCount).toBe(1);
  });

  it('rejects a second live executor instead of racing provider calls', async () => {
    const lab = await prepareFailureLab();
    await lab.store.createOrLoadRun(lab.seed);
    await lab.store.acquireLease(
      lab.seed.runId,
      'holding-worker',
      new Date('2026-07-17T00:00:00.000Z'),
      30_000,
    );
    await expect(lab.execute({ ownerId: 'racing-worker' })).rejects.toBeInstanceOf(
      SagaLeaseUnavailableError,
    );
  });
});
