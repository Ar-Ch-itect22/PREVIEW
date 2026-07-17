export class DefinitelyNotAppliedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DefinitelyNotAppliedError';
  }
}

export class AmbiguousProviderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AmbiguousProviderError';
  }
}
