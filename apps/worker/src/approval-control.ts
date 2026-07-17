import type { ApprovalVerificationContext } from '@preview/approval';
import type { Approval, SimulationRevision } from '@preview/domain';

export type { ApprovalVerificationContext } from '@preview/approval';

export interface ApprovalVerifier {
  verify(
    approval: Approval,
    revision: Readonly<SimulationRevision>,
    expected: ApprovalVerificationContext,
    now: Date,
  ): void;
}

export class CommitControlError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CommitControlError';
  }
}
