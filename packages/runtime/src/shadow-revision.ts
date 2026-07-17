import { isDeepStrictEqual } from 'node:util';

import {
  ConstraintViolationError,
  DomainInvariantError,
  RevisionDraft,
  computeCanonicalDigest,
  createSnapshotManifest,
  observationSchema,
  type EffectGraph,
  type Observation,
  type SimulationRevision,
  type StructuredConstraint,
} from '@preview/domain';
import type { StageContext, StageDependency } from '@preview/adapter-sdk';

export interface StagedMutation<Resource> {
  readonly effect: EffectGraph['effects'][number];
  readonly resource: Resource;
}

export type GraphDigestFactory = (graph: EffectGraph) => string;

export interface ObservationOptions<Resource> {
  readonly adapterId: string;
  readonly observedAt: string;
  readonly version?: (resource: Resource) => string | null;
}

type SessionStatus = 'OPEN' | 'SEALED' | 'ABORTED';

interface OverlayEntry {
  readonly effectId: string;
  readonly resource: unknown;
}

export interface StageOptions<Resource> {
  readonly dependencyResourceKeys?: readonly string[];
  readonly effectId: string;
  readonly observation: ObservationOptions<Resource>;
}

export class ShadowRevisionSession {
  readonly #base = new Map<string, unknown>();
  readonly #constraints: readonly StructuredConstraint[];
  readonly #draft: RevisionDraft;
  readonly #observations = new Map<string, Observation>();
  readonly #overlay = new Map<string, OverlayEntry>();
  #status: SessionStatus = 'OPEN';

  public constructor(revision: SimulationRevision) {
    this.#draft = new RevisionDraft(revision);
    this.#constraints = structuredClone(revision.structuredConstraints);
  }

  public async read<Resource>(
    resourceKey: string,
    readBase: () => Promise<Resource | undefined>,
    observation: ObservationOptions<Resource>,
  ): Promise<Resource | undefined> {
    this.#assertOpen();
    if (this.#overlay.has(resourceKey)) {
      return this.#clone(this.#overlay.get(resourceKey)?.resource as Resource);
    }
    if (!this.#base.has(resourceKey)) {
      this.#base.set(resourceKey, this.#clone(await readBase()));
    }
    this.#captureObservation(
      resourceKey,
      this.#clone(this.#base.get(resourceKey) as Resource | undefined),
      observation,
    );
    return this.#clone(this.#base.get(resourceKey) as Resource | undefined);
  }

  public inspectObservations(): readonly Readonly<Observation>[] {
    this.#assertOpen();
    return deepFreeze([...this.#observations.values()]
      .toSorted((left, right) => {
        const leftKey = `${left.adapterId}\u0000${left.resourceKey}`;
        const rightKey = `${right.adapterId}\u0000${right.resourceKey}`;
        if (leftKey < rightKey) return -1;
        if (leftKey > rightKey) return 1;
        return 0;
      })
      .map((observation) => structuredClone(observation)));
  }

  public async stage<Resource>(
    resourceKey: string,
    readBase: () => Promise<Resource | undefined>,
    options: StageOptions<Resource>,
    simulate: (
      current: Resource | undefined,
      context: StageContext,
    ) => StagedMutation<Resource>,
  ): Promise<Resource> {
    this.#assertOpen();
    this.#assertMutationNotDenied(resourceKey);
    const current = await this.read(resourceKey, readBase, options.observation);
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
    this.#assertStagedResourceSatisfiesConstraints(resourceKey, current, staged.resource);

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
    const snapshot = createSnapshotManifest(this.inspectObservations());
    const sealed = this.#draft.seal(digest, snapshot.digest);
    this.#status = 'SEALED';
    this.#overlay.clear();
    return sealed;
  }

  public abort(): void {
    this.#assertOpen();
    this.#overlay.clear();
    this.#base.clear();
    this.#observations.clear();
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

  #captureObservation<Resource>(
    resourceKey: string,
    resource: Resource | undefined,
    options: ObservationOptions<Resource>,
  ): void {
    const parsed = observationSchema.parse(resource === undefined ? {
      adapterId: options.adapterId,
      observedAt: options.observedAt,
      presence: 'ABSENT',
      resourceKey,
      valueDigest: null,
      version: null,
    } : {
      adapterId: options.adapterId,
      observedAt: options.observedAt,
      presence: 'PRESENT',
      resourceKey,
      valueDigest: computeCanonicalDigest(resource),
      version: options.version?.(resource) ?? null,
    });
    const key = `${parsed.adapterId}\u0000${parsed.resourceKey}`;
    const prior = this.#observations.get(key);
    if (prior !== undefined && !isDeepStrictEqual(prior, parsed)) {
      throw new DomainInvariantError(`Observation changed for cached resource ${resourceKey}`);
    }
    this.#observations.set(key, structuredClone(parsed));
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

  #assertMutationNotDenied(resourceKey: string): void {
    if (this.#constraints.some(
      (constraint) => constraint.resourceKey === resourceKey && constraint.kind === 'DENY_MUTATION',
    )) {
      throw new ConstraintViolationError(resourceKey, 'DENY_MUTATION', 'resource is protected');
    }
  }

  #assertStagedResourceSatisfiesConstraints<Resource>(
    resourceKey: string,
    current: Resource | undefined,
    staged: Resource,
  ): void {
    for (const constraint of this.#constraints) {
      if (constraint.resourceKey !== resourceKey) continue;
      if (constraint.kind === 'PRESERVE_FIELD') {
        const before = this.#readField(current, constraint.field);
        const after = this.#readField(staged, constraint.field);
        if (!isDeepStrictEqual(before, after)) {
          throw new ConstraintViolationError(
            resourceKey,
            constraint.kind,
            `field ${constraint.field} changed`,
          );
        }
      } else if (constraint.kind === 'REPLACE_VALUE' && !isDeepStrictEqual(staged, constraint.value)) {
        throw new ConstraintViolationError(
          resourceKey,
          constraint.kind,
          'staged resource does not equal the required replacement',
        );
      }
    }
  }

  #readField(value: unknown, field: string): unknown {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[field];
  }

  #clone<T>(value: T): T {
    return value === undefined ? value : structuredClone(value);
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
