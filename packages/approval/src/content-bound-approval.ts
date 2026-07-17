import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  approvalSchema,
  identifierSchema,
  planEffectOrder,
  snapshotManifestSchema,
  type Approval,
  type SimulationRevision,
  type SnapshotManifest,
} from '@preview/domain';

import {
  canonicalize,
  computeCanonicalDigest,
  computeEffectGraphDigest,
  computeSnapshotDigest,
} from './canonical.js';

export class ApprovalValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ApprovalValidationError';
  }
}

export interface ApprovalRequest {
  readonly adapterVersions: Readonly<Record<string, string>>;
  readonly approverId: string;
  readonly expiresAt: string;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly snapshot: Readonly<SnapshotManifest>;
  readonly tenantId: string;
}

export interface ApprovalVerificationContext {
  readonly adapterVersions: Readonly<Record<string, string>>;
  readonly approverId: string;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly snapshot: Readonly<SnapshotManifest>;
  readonly tenantId: string;
}

type UnsignedApproval = Omit<Approval, 'signature'>;

export interface RevisionInvalidationStore {
  invalidate(revisionId: string): void;
  isInvalidated(revisionId: string): boolean;
}

export class InMemoryRevisionInvalidationStore implements RevisionInvalidationStore {
  readonly #revisionIds = new Set<string>();

  public invalidate(revisionId: string): void {
    this.#revisionIds.add(identifierSchema.parse(revisionId));
  }

  public isInvalidated(revisionId: string): boolean {
    return this.#revisionIds.has(identifierSchema.parse(revisionId));
  }
}

export class ContentBoundApprovalAuthority {
  readonly #invalidations: RevisionInvalidationStore;
  readonly #signingKey: string;

  public constructor(
    signingKey: string,
    invalidations: RevisionInvalidationStore = new InMemoryRevisionInvalidationStore(),
  ) {
    if (signingKey.length < 16) {
      throw new TypeError('Approval signing key must be at least 16 characters');
    }
    this.#signingKey = signingKey;
    this.#invalidations = invalidations;
  }

  public approve(revision: Readonly<SimulationRevision>, request: ApprovalRequest): Readonly<Approval> {
    const graphDigest = this.#validateSealedRevision(revision);
    const snapshot = this.#validateSnapshot(request.snapshot);
    this.#validateSnapshotCoverage(revision, snapshot);
    const effectOrder = revision.effectGraph === null
      ? []
      : planEffectOrder(revision.effectGraph).map((effect) => effect.id);
    const adapterVersions = this.#validateVersionManifest(
      request.adapterVersions,
      this.#requiredAdapterIds(revision, snapshot),
      'adapter',
    );
    const policyVersions = this.#validateVersionManifest(
      request.policyVersions,
      undefined,
      'policy',
    );
    const snapshotDigest = snapshot.digest;
    const approvalDigest = this.#computeApprovalDigest(revision, {
      adapterVersions,
      approverId: request.approverId,
      effectOrder,
      expiresAt: request.expiresAt,
      graphDigest,
      policyVersions,
      snapshotDigest,
      tenantId: request.tenantId,
    });
    const unsigned: UnsignedApproval = {
      adapterVersions,
      approvalDigest,
      approverId: request.approverId,
      effectOrder,
      expiresAt: request.expiresAt,
      graphDigest,
      policyVersions,
      revisionId: revision.id,
      snapshotDigest,
      tenantId: request.tenantId,
    };
    return Object.freeze(approvalSchema.parse({ ...unsigned, signature: this.#sign(unsigned) }));
  }

  public invalidateRevision(revisionId: string): void {
    this.#invalidations.invalidate(identifierSchema.parse(revisionId));
  }

  public verify(
    approval: Approval,
    revision: Readonly<SimulationRevision>,
    expected: ApprovalVerificationContext,
    now: Date,
  ): void {
    const parsed = approvalSchema.parse(approval);
    const digest = this.#validateSealedRevision(revision);
    const snapshot = this.#validateSnapshot(expected.snapshot);
    this.#validateSnapshotCoverage(revision, snapshot);
    if (parsed.revisionId !== revision.id || parsed.graphDigest !== digest) {
      throw new ApprovalValidationError('Approval does not bind this sealed revision');
    }
    if (parsed.approverId !== expected.approverId || parsed.tenantId !== expected.tenantId) {
      throw new ApprovalValidationError('Approval identity or tenant does not match');
    }
    if (Date.parse(parsed.expiresAt) <= now.getTime()) {
      throw new ApprovalValidationError('Approval has expired');
    }
    const effectOrder = revision.effectGraph === null
      ? []
      : planEffectOrder(revision.effectGraph).map((effect) => effect.id);
    if (
      effectOrder.length !== parsed.effectOrder.length
      || effectOrder.some((effectId, index) => effectId !== parsed.effectOrder[index])
    ) {
      throw new ApprovalValidationError('Approval effect order does not match the sealed graph');
    }
    if (parsed.snapshotDigest !== snapshot.digest) {
      throw new ApprovalValidationError('Approval snapshot does not match the commit snapshot');
    }
    const adapterVersions = this.#validateVersionManifest(
      expected.adapterVersions,
      this.#requiredAdapterIds(revision, snapshot),
      'adapter',
    );
    const policyVersions = this.#validateVersionManifest(
      expected.policyVersions,
      undefined,
      'policy',
    );
    if (canonicalize(parsed.adapterVersions) !== canonicalize(adapterVersions)) {
      throw new ApprovalValidationError('Approval adapter versions are stale');
    }
    if (canonicalize(parsed.policyVersions) !== canonicalize(policyVersions)) {
      throw new ApprovalValidationError('Approval policy versions are stale');
    }

    const expectedDigest = this.#computeApprovalDigest(revision, parsed);
    if (parsed.approvalDigest !== expectedDigest) {
      throw new ApprovalValidationError('Approval content digest does not match this revision');
    }

    const { signature, ...unsigned } = parsed;
    const expectedSignature = this.#sign(unsigned);
    const actualBytes = Buffer.from(signature, 'hex');
    const expectedBytes = Buffer.from(expectedSignature, 'hex');
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
      throw new ApprovalValidationError('Approval signature is invalid');
    }
  }

  #sign(approval: UnsignedApproval): string {
    return createHmac('sha256', this.#signingKey).update(canonicalize(approval)).digest('hex');
  }

  #computeApprovalDigest(
    revision: Readonly<SimulationRevision>,
    approval: Pick<
      Approval,
      | 'adapterVersions'
      | 'approverId'
      | 'effectOrder'
      | 'expiresAt'
      | 'graphDigest'
      | 'policyVersions'
      | 'snapshotDigest'
      | 'tenantId'
    >,
  ): string {
    return computeCanonicalDigest({
      adapterVersions: approval.adapterVersions,
      approverId: approval.approverId,
      baseSnapshotDigest: revision.baseSnapshotDigest,
      baseSnapshotId: revision.baseSnapshotId,
      effectGraph: revision.effectGraph,
      effectOrder: approval.effectOrder,
      expiresAt: approval.expiresAt,
      graphDigest: approval.graphDigest,
      policyVersions: approval.policyVersions,
      revisionId: revision.id,
      snapshotDigest: approval.snapshotDigest,
      structuredConstraints: revision.structuredConstraints,
      tenantId: approval.tenantId,
      transactionId: revision.transactionId,
    });
  }

  #validateVersionManifest(
    manifest: Readonly<Record<string, string>>,
    requiredIds: readonly string[] | undefined,
    kind: 'adapter' | 'policy',
  ): Readonly<Record<string, string>> {
    const entries = Object.entries(manifest).map(([id, version]) => [
      identifierSchema.parse(id),
      identifierSchema.parse(version),
    ] as const);
    if (entries.length === 0) {
      throw new ApprovalValidationError(`Approval requires at least one ${kind} version`);
    }
    const parsed = Object.fromEntries(entries);
    if (requiredIds !== undefined) {
      const required = [...new Set(requiredIds)].sort();
      const supplied = Object.keys(parsed).sort();
      if (
        required.length !== supplied.length
        || required.some((id, index) => id !== supplied[index])
      ) {
        throw new ApprovalValidationError('Adapter version manifest must exactly match the effect graph');
      }
    }
    return Object.freeze(parsed);
  }

  #requiredAdapterIds(
    revision: Readonly<SimulationRevision>,
    snapshot: Readonly<SnapshotManifest>,
  ): readonly string[] {
    return [
      ...(revision.effectGraph?.effects.map((effect) => effect.adapterId) ?? []),
      ...snapshot.observations.map((observation) => observation.adapterId),
    ];
  }

  #validateSnapshot(snapshot: Readonly<SnapshotManifest>): Readonly<SnapshotManifest> {
    const parsed = snapshotManifestSchema.parse(snapshot);
    if (computeSnapshotDigest(parsed.observations) !== parsed.digest) {
      throw new ApprovalValidationError('Snapshot digest does not match its observations');
    }
    return parsed;
  }

  #validateSnapshotCoverage(
    revision: Readonly<SimulationRevision>,
    snapshot: Readonly<SnapshotManifest>,
  ): void {
    if (revision.baseSnapshotDigest !== snapshot.digest) {
      throw new ApprovalValidationError('Snapshot digest does not match the sealed revision');
    }
    const observed = new Set(snapshot.observations.map(
      (observation) => `${observation.adapterId}\u0000${observation.resourceKey}`,
    ));
    for (const effect of revision.effectGraph?.effects ?? []) {
      if (!observed.has(`${effect.adapterId}\u0000${effect.resourceKey}`)) {
        throw new ApprovalValidationError(
          `Snapshot is missing effect resource ${effect.adapterId}/${effect.resourceKey}`,
        );
      }
    }
  }

  #validateSealedRevision(revision: Readonly<SimulationRevision>): string {
    if (this.#invalidations.isInvalidated(revision.id)) {
      throw new ApprovalValidationError(`Revision ${revision.id} approval path is invalidated`);
    }
    if (revision.status !== 'SEALED' || revision.effectGraph === null || revision.graphDigest === null) {
      throw new ApprovalValidationError('Only a sealed revision can be approved');
    }
    const computed = computeEffectGraphDigest(revision.effectGraph);
    if (computed !== revision.graphDigest) {
      throw new ApprovalValidationError('Sealed revision graph digest does not match its effects');
    }
    return computed;
  }
}
