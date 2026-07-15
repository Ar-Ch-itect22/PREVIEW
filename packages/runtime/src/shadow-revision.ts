import {
  DomainInvariantError,
  RevisionDraft,
  type EffectGraph,
  type SimulationRevision,
} from '@preview/domain';
import type { StageContext, StageDependency } from '@preview/adapter-sdk';

export interface StagedMutation<Resource> {
  readonly effect: EffectGraph['effects'][number];
  readonly resource: Resource;
}

export type GraphDigestFactory = (graph: EffectGraph) => string;

type SessionStatus = 'OPEN' | 'SEALED' | 'ABORTED';

interface OverlayEntry {
  readonly effectId: string;
  readonly resource: unknown;
}

export interface StageOptions {
  readonly dependencyResourceKeys?: readonly string[];
  readonly effectId: string;
}

export class ShadowRevisionSession {
  readonly #base = new Map<string, unknown>();
  readonly #draft: RevisionDraft;
  readonly #overlay = new Map<string, OverlayEntry>();
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
      return this.#clone(this.#overlay.get(resourceKey)?.resource as Resource);
    }
    if (!this.#base.has(resourceKey)) {
      this.#base.set(resourceKey, this.#clone(await readBase()));
    }
    return this.#clone(this.#base.get(resourceKey) as Resource | undefined);
  }

  public async stage<Resource>(
    resourceKey: string,
    readBase: () => Promise<Resource | undefined>,
    options: StageOptions,
    simulate: (
      current: Resource | undefined,
      context: StageContext,
    ) => StagedMutation<Resource>,
  ): Promise<Resource> {
    this.#assertOpen();
    const current = await this.read(resourceKey, readBase);
    const dependencies = this.#resolveDependencies(options.dependencyResourceKeys ?? []);
    const context: StageContext = { dependencies, effectId: options.effectId };
    const staged = simulate(current, context);
    if (staged.effect.id !== context.effectId) {
      throw new DomainInvariantError(
        `Staged effect ID ${staged.effect.id} does not match runtime effect ID ${context.effectId}`,
      );
    }
    if (staged.effect.resourceKey !== resourceKey) {
      throw new DomainInvariantError(
        `Staged effect resource ${staged.effect.resourceKey} does not match overlay resource ${resourceKey}`,
      );
    }
    const expectedDependencies = dependencies.map((dependency) => dependency.effectId);
    if (
      staged.effect.dependencies.length !== expectedDependencies.length
      || staged.effect.dependencies.some(
        (dependency, index) => dependency !== expectedDependencies[index],
      )
    ) {
      throw new DomainInvariantError(
        `Effect ${staged.effect.id} dependencies do not match runtime-owned provenance`,
      );
    }
    this.#validateCausality(staged.effect.id, staged.effect.dependencies);

    const resource = this.#clone(staged.resource);
    this.#draft.appendEffect(staged.effect);
    this.#overlay.set(resourceKey, { effectId: staged.effect.id, resource });
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

  #validateCausality(effectId: string, dependencies: readonly string[]): void {
    const existingIds = new Set(this.inspectEffectGraph().effects.map((effect) => effect.id));
    if (existingIds.has(effectId)) {
      throw new DomainInvariantError(`Duplicate staged effect ID: ${effectId}`);
    }
    if (new Set(dependencies).size !== dependencies.length) {
      throw new DomainInvariantError(`Effect ${effectId} contains duplicate dependencies`);
    }
    for (const dependency of dependencies) {
      if (!existingIds.has(dependency)) {
        throw new DomainInvariantError(
          `Effect ${effectId} depends on unknown prior effect ${dependency}`,
        );
      }
    }
  }

  #resolveDependencies(resourceKeys: readonly string[]): readonly StageDependency[] {
    if (new Set(resourceKeys).size !== resourceKeys.length) {
      throw new DomainInvariantError('Stage request contains duplicate dependency resources');
    }
    return resourceKeys.map((resourceKey) => {
      const entry = this.#overlay.get(resourceKey);
      if (entry === undefined) {
        throw new DomainInvariantError(
          `Dependency resource ${resourceKey} is not staged in this revision`,
        );
      }
      return Object.freeze({
        effectId: entry.effectId,
        resource: this.#clone(entry.resource),
        resourceKey,
      });
    });
  }

  #clone<T>(value: T): T {
    return value === undefined ? value : structuredClone(value);
  }
}
