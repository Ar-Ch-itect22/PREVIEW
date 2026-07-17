import {
  createReplayRevision,
  type ReplayRevisionRequest,
  type ReplayRevisionTransition,
  type SimulationRevision,
} from '@preview/domain';

export interface ApprovalPathInvalidator {
  invalidateRevision(revisionId: string): void;
}

export class ReplayCoordinator {
  readonly #approvalPaths: ApprovalPathInvalidator;

  public constructor(approvalPaths: ApprovalPathInvalidator) {
    this.#approvalPaths = approvalPaths;
  }

  public beginReplay(
    priorRevision: Readonly<SimulationRevision>,
    request: ReplayRevisionRequest,
  ): ReplayRevisionTransition {
    const transition = createReplayRevision(priorRevision, request);
    this.#approvalPaths.invalidateRevision(priorRevision.id);
    return transition;
  }
}
