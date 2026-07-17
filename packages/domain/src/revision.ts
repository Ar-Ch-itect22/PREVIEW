import { SealedRevisionMutationError } from './errors.js';
import {
  effectGraphSchema,
  effectSchema,
  simulationRevisionSchema,
  structuredConstraintSchema,
  type Effect,
  type EffectGraph,
  type SimulationRevision,
  type StructuredConstraint,
} from './schemas.js';

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export class RevisionDraft {
  readonly #effects: Effect[] = [];
  readonly #constraints: StructuredConstraint[];
  readonly #revision: SimulationRevision;

  public constructor(revision: SimulationRevision) {
    const parsed = simulationRevisionSchema.parse(revision);
    if (parsed.status !== 'DRAFT') {
      throw new SealedRevisionMutationError(parsed.id);
    }
    this.#revision = structuredClone(parsed);
    this.#constraints = structuredClone(parsed.structuredConstraints);
  }

  public appendEffect(effect: Effect): void {
    this.#assertDraft();
    this.#effects.push(structuredClone(effectSchema.parse(effect)));
  }

  public addConstraint(constraint: StructuredConstraint): void {
    this.#assertDraft();
    this.#constraints.push(structuredClone(structuredConstraintSchema.parse(constraint)));
  }

  public seal(graphDigest: string, baseSnapshotDigest: string): Readonly<SimulationRevision> {
    this.#assertDraft();
    const graph: EffectGraph = effectGraphSchema.parse({ effects: this.#effects, version: 1 });
    const sealed = simulationRevisionSchema.parse({
      ...this.#revision,
      baseSnapshotDigest,
      effectGraph: graph,
      graphDigest,
      status: 'SEALED',
      structuredConstraints: this.#constraints,
    });
    this.#revision.status = 'SEALED';
    return deepFreeze(sealed);
  }

  public snapshot(): Readonly<SimulationRevision> {
    return deepFreeze(structuredClone({
      ...this.#revision,
      baseSnapshotDigest: null,
      effectGraph: { effects: this.#effects, version: 1 },
      structuredConstraints: this.#constraints,
    }));
  }

  #assertDraft(): void {
    if (this.#revision.status !== 'DRAFT') {
      throw new SealedRevisionMutationError(this.#revision.id);
    }
  }
}
