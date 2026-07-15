import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  approvalSchema,
  type Approval,
  type SimulationRevision,
} from '@preview/domain';

import { canonicalize, computeEffectGraphDigest } from './canonical.js';

export class ApprovalValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ApprovalValidationError';
  }
}

export interface ApprovalRequest {
  readonly approverId: string;
  readonly expiresAt: string;
  readonly policyVersion: string;
  readonly tenantId: string;
}

type UnsignedApproval = Omit<Approval, 'signature'>;

export class ContentBoundApprovalAuthority {
  readonly #signingKey: string;

  public constructor(signingKey: string) {
    if (signingKey.length < 16) {
      throw new TypeError('Approval signing key must be at least 16 characters');
    }
    this.#signingKey = signingKey;
  }

  public approve(revision: Readonly<SimulationRevision>, request: ApprovalRequest): Readonly<Approval> {
    const graphDigest = this.#validateSealedRevision(revision);
    const unsigned: UnsignedApproval = {
      approverId: request.approverId,
      expiresAt: request.expiresAt,
      graphDigest,
      policyVersion: request.policyVersion,
      revisionId: revision.id,
      tenantId: request.tenantId,
    };
    return Object.freeze(approvalSchema.parse({ ...unsigned, signature: this.#sign(unsigned) }));
  }

  public verify(
    approval: Approval,
    revision: Readonly<SimulationRevision>,
    expected: { approverId: string; tenantId: string },
    now: Date,
  ): void {
    const parsed = approvalSchema.parse(approval);
    const digest = this.#validateSealedRevision(revision);
    if (parsed.revisionId !== revision.id || parsed.graphDigest !== digest) {
      throw new ApprovalValidationError('Approval does not bind this sealed revision');
    }
    if (parsed.approverId !== expected.approverId || parsed.tenantId !== expected.tenantId) {
      throw new ApprovalValidationError('Approval identity or tenant does not match');
    }
    if (Date.parse(parsed.expiresAt) <= now.getTime()) {
      throw new ApprovalValidationError('Approval has expired');
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

  #validateSealedRevision(revision: Readonly<SimulationRevision>): string {
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
