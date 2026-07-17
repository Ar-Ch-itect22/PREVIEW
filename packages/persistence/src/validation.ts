import {
  approvalSchema,
  digestSchema,
  identifierSchema,
  receiptSchema,
  simulationRevisionSchema,
  snapshotManifestSchema,
  timestampSchema,
  type Receipt,
} from '@preview/domain';

import type { SagaJournalEntry, SagaJournalEventKind, SagaRunSeed } from './contracts.js';

const journalKinds = new Set<SagaJournalEventKind>([
  'AUTHORIZATION_VERIFIED',
  'RUN_STARTED',
  'PREFLIGHT_PASSED',
  'EFFECT_COMMIT_STARTED',
  'EFFECT_COMMIT_RECONCILIATION_STARTED',
  'EFFECT_COMMIT_APPLIED',
  'EFFECT_COMMIT_FAILED',
  'EFFECT_COMMIT_UNRESOLVED',
  'EFFECT_VERIFICATION_STARTED',
  'EFFECT_VERIFIED',
  'EFFECT_VERIFICATION_FAILED',
  'EFFECT_COMPENSATION_STARTED',
  'EFFECT_COMPENSATION_RECONCILIATION_STARTED',
  'EFFECT_COMPENSATION_APPLIED',
  'EFFECT_COMPENSATION_UNRESOLVED',
  'EFFECT_COMPENSATION_VERIFICATION_STARTED',
  'EFFECT_COMPENSATED',
  'EFFECT_COMPENSATION_FAILED',
  'RUN_TERMINAL',
]);

export function parseRunSeed(seed: SagaRunSeed): SagaRunSeed {
  const parsed = {
    approval: approvalSchema.parse(seed.approval),
    approvalContext: {
      adapterVersions: parseManifest(seed.approvalContext.adapterVersions),
      approverId: identifierSchema.parse(seed.approvalContext.approverId),
      policyVersions: parseManifest(seed.approvalContext.policyVersions),
      snapshot: snapshotManifestSchema.parse(seed.approvalContext.snapshot),
      tenantId: identifierSchema.parse(seed.approvalContext.tenantId),
    },
    authorizedAt: timestampSchema.parse(seed.authorizedAt),
    createdAt: timestampSchema.parse(seed.createdAt),
    revision: simulationRevisionSchema.parse(seed.revision),
    runId: identifierSchema.parse(seed.runId),
  };
  return deepFreeze(parsed);
}

export function parseJournalEntry(entry: SagaJournalEntry): SagaJournalEntry {
  identifierSchema.parse(entry.runId);
  digestSchema.parse(entry.graphDigest);
  timestampSchema.parse(entry.at);
  if (!journalKinds.has(entry.kind)) throw new TypeError(`Unknown saga journal event: ${entry.kind}`);
  if (!Number.isInteger(entry.sequence) || entry.sequence < 1) {
    throw new TypeError('Journal sequence must be a positive integer');
  }
  if (!Number.isInteger(entry.fencingToken) || entry.fencingToken < 1) {
    throw new TypeError('Journal fencing token must be a positive integer');
  }
  if (entry.effectId !== undefined) identifierSchema.parse(entry.effectId);
  if (entry.idempotencyKey !== undefined) identifierSchema.parse(entry.idempotencyKey);
  if (
    entry.attemptNumber !== undefined
    && (!Number.isInteger(entry.attemptNumber) || entry.attemptNumber < 1)
  ) {
    throw new TypeError('Journal attempt number must be a positive integer');
  }
  if (entry.details?.length === 0) {
    throw new TypeError('Journal details cannot be empty');
  }
  if (entry.kind === 'RUN_TERMINAL' && entry.terminalStatus === undefined) {
    throw new TypeError('Terminal journal event requires terminal status');
  }
  if (entry.kind !== 'RUN_TERMINAL' && entry.terminalStatus !== undefined) {
    throw new TypeError('Only a terminal journal event may carry terminal status');
  }
  if (
    entry.terminalStatus !== undefined
    && ![
      'COMMITTED_VERIFIED',
      'COMPENSATED',
      'COMPLETED_WITH_RESIDUALS',
      'REQUIRES_ATTENTION',
    ].includes(entry.terminalStatus)
  ) {
    throw new TypeError('Unknown saga terminal status');
  }
  return deepFreeze(structuredClone(entry));
}

export function parseReceipt(receipt: Receipt): Receipt {
  return deepFreeze(receiptSchema.parse(receipt));
}

function parseManifest(manifest: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(manifest).map(([key, value]) => [
    identifierSchema.parse(key),
    identifierSchema.parse(value),
  ]));
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
