import {
  DomainInvariantError,
  RevisionDraft,
  type EffectGraph,
  type SimulationRevision,
} from '@preview/domain';

export interface StagedMutation<Resource> {
  readonly effect: EffectGraph['effects'][number];
  readonly resource: Resource;
}

export type GraphDigestFactory = (graph: EffectGraph) => string;

type SessionStatus = 'OPEN' | 'SEALED' | 'ABORTED';

export class ShadowRevisionSession {
  readonly #base = new Map<string, unknown>();
  readonly #draft: RevisionDraft;
  readonly #overlay = new Map<string, unknown>();
  #status: SessionStatus = 'OPEN';

  public constructor(revision: SimulationRevision) {
    this.#draft = new RevisionDraft(revision);
  }

  public async read<Resource>(
    resourceKey: string,
    readBase: () => Promise<Resource | undefined>,
  ): Promise<Resource | undefined> {
    this.#assertOpen();
    if (this.#overlay.has(resourceKey)) {
      return this.#clone(this.#overlay.get(resourceKey) as Resource);
    }
    if (!this.#base.has(resourceKey)) {
      this.#base.set(resourceKey, this.#clone(await readBase()));
    }
    return this.#clone(this.#base.get(resourceKey) as Resource | undefined);
  }

  public async stage<Resource>(
    resourceKey: string,
    readBase: () => Promise<Resource | undefined>,
    simulate: (current: Resource | undefined) => StagedMutation<Resource>,
  ): Promise<Resource> {
    this.#assertOpen();
    const current = await this.read(resourceKey, readBase);
    const staged = simulate(current);
    if (staged.effect.resourceKey !== resourceKey) {
      throw new DomainInvariantError(
        `Staged effect resource ${staged.effect.resourceKey} does not match overlay resource ${resourceKey}`,
      );
    }

    const resource = this.#clone(staged.resource);
    this.#draft.appendEffect(staged.effect);
    this.#overlay.set(resourceKey, resource);
    return this.#clone(resource);
  }

  public inspectEffectGraph(): Readonly<EffectGraph> {
    this.#assertOpen();
    const graph = this.#draft.snapshot().effectGraph;
    if (graph === null) {
      throw new DomainInvariantError('Draft revision is missing its effect graph');
    }
    return graph;
  }

  public seal(createDigest: GraphDigestFactory): Readonly<SimulationRevision> {
    this.#assertOpen();
    const digest = createDigest(this.inspectEffectGraph());
    const sealed = this.#draft.seal(digest);
    this.#status = 'SEALED';
    this.#overlay.clear();
    return sealed;
  }

  public abort(): void {
    this.#assertOpen();
    this.#overlay.clear();
    this.#base.clear();
    this.#status = 'ABORTED';
  }

  public get status(): SessionStatus {
    return this.#status;
  }

  #assertOpen(): void {
    if (this.#status !== 'OPEN') {
      throw new DomainInvariantError(`Shadow revision is ${this.#status.toLowerCase()}`);
    }
  }

  #clone<T>(value: T): T {
    return value === undefined ? value : structuredClone(value);
  }
}
