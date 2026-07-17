import type { Approval, Receipt, SimulationRevision, SnapshotManifest } from '@preview/domain';

export interface StoredApprovalContext {
  readonly adapterVersions: Readonly<Record<string, string>>;
  readonly approverId: string;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly snapshot: Readonly<SnapshotManifest>;
  readonly tenantId: string;
}

export interface SagaRunSeed {
  readonly approval: Readonly<Approval>;
  readonly approvalContext: StoredApprovalContext;
  readonly authorizedAt: string;
  readonly createdAt: string;
  readonly revision: Readonly<SimulationRevision>;
  readonly runId: string;
}

export type SagaJournalEventKind =
  | 'AUTHORIZATION_VERIFIED'
  | 'RUN_STARTED'
  | 'PREFLIGHT_PASSED'
  | 'EFFECT_COMMIT_STARTED'
  | 'EFFECT_COMMIT_RECONCILIATION_STARTED'
  | 'EFFECT_COMMIT_APPLIED'
  | 'EFFECT_COMMIT_FAILED'
  | 'EFFECT_COMMIT_UNRESOLVED'
  | 'EFFECT_VERIFICATION_STARTED'
  | 'EFFECT_VERIFIED'
  | 'EFFECT_VERIFICATION_FAILED'
  | 'EFFECT_COMPENSATION_STARTED'
  | 'EFFECT_COMPENSATION_RECONCILIATION_STARTED'
  | 'EFFECT_COMPENSATION_APPLIED'
  | 'EFFECT_COMPENSATION_UNRESOLVED'
  | 'EFFECT_COMPENSATION_VERIFICATION_STARTED'
  | 'EFFECT_COMPENSATED'
  | 'EFFECT_COMPENSATION_FAILED'
  | 'RUN_TERMINAL';

export interface SagaJournalEvent {
  readonly attemptNumber?: number;
  readonly details?: string;
  readonly effectId?: string;
  readonly idempotencyKey?: string;
  readonly kind: SagaJournalEventKind;
  readonly providerResult?: unknown;
  readonly terminalStatus?: Receipt['terminalStatus'];
}

export interface SagaJournalEntry extends SagaJournalEvent {
  readonly at: string;
  readonly fencingToken: number;
  readonly graphDigest: string;
  readonly runId: string;
  readonly sequence: number;
}

export interface ExecutionLease {
  readonly expiresAt: string;
  readonly fencingToken: number;
  readonly ownerId: string;
  readonly runId: string;
}

export interface SagaStore {
  acquireLease(
    runId: string,
    ownerId: string,
    now: Date,
    ttlMs: number,
  ): Promise<Readonly<ExecutionLease> | undefined>;
  appendEvent(
    lease: ExecutionLease,
    event: SagaJournalEvent,
    at: Date,
  ): Promise<Readonly<SagaJournalEntry>>;
  createOrLoadRun(seed: SagaRunSeed): Promise<Readonly<SagaRunSeed>>;
  listEvents(runId: string): Promise<readonly Readonly<SagaJournalEntry>[]>;
  loadReceipt(runId: string): Promise<Readonly<Receipt> | undefined>;
  loadRun(runId: string): Promise<Readonly<SagaRunSeed> | undefined>;
  recordReceipt(
    lease: ExecutionLease,
    receipt: Receipt,
    at: Date,
  ): Promise<Readonly<Receipt>>;
  releaseLease(lease: ExecutionLease): Promise<void>;
}
