export class DomainInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DomainInvariantError';
  }
}

export class IllegalTransitionError extends DomainInvariantError {
  public constructor(from: string, to: string) {
    super(`Illegal transaction transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class SealedRevisionMutationError extends DomainInvariantError {
  public constructor(revisionId: string) {
    super(`Revision ${revisionId} is sealed and cannot be mutated`);
    this.name = 'SealedRevisionMutationError';
  }
}

export class ConstraintViolationError extends DomainInvariantError {
  public constructor(
    public readonly resourceKey: string,
    public readonly constraintKind: string,
    detail: string,
  ) {
    super(`Constraint ${constraintKind} rejected mutation on ${resourceKey}: ${detail}`);
    this.name = 'ConstraintViolationError';
  }
}

export class UnsupportedOperationError extends DomainInvariantError {
  public constructor(adapterId: string, operation: string) {
    super(`Unsupported mutation rejected: ${adapterId}.${operation}`);
    this.name = 'UnsupportedOperationError';
  }
}
