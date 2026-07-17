import { DomainInvariantError } from './errors.js';
import {
  identifierSchema,
  simulationRevisionSchema,
  structuredConstraintSchema,
  type SimulationRevision,
  type StructuredConstraint,
} from './schemas.js';

export interface ReplayRevisionRequest {
  readonly constraints: readonly StructuredConstraint[];
  readonly revisionId: string;
}

export interface ReplayRevisionTransition {
  readonly invalidatedRevision: Readonly<SimulationRevision>;
  readonly replayRevision: Readonly<SimulationRevision>;
}

export function createReplayRevision(
  priorRevision: Readonly<SimulationRevision>,
  request: ReplayRevisionRequest,
): ReplayRevisionTransition {
  const prior = simulationRevisionSchema.parse(priorRevision);
  if (prior.status !== 'SEALED' || prior.effectGraph === null || prior.graphDigest === null) {
    throw new DomainInvariantError('Replay requires a sealed prior revision');
  }
  const revisionId = identifierSchema.parse(request.revisionId);
  if (revisionId === prior.id) {
    throw new DomainInvariantError('Replay revision must have a new ID');
  }
  const constraints = request.constraints.map((constraint) =>
    structuredConstraintSchema.parse(constraint)
  );
  if (constraints.length === 0) {
    throw new DomainInvariantError('Replay requires at least one structured constraint');
  }

  const invalidatedRevision = simulationRevisionSchema.parse({
    ...prior,
    status: 'INVALIDATED',
  });
  const replayRevision = simulationRevisionSchema.parse({
    baseSnapshotDigest: null,
    baseSnapshotId: prior.baseSnapshotId,
    effectGraph: null,
    graphDigest: null,
    id: revisionId,
    replayOfRevisionId: prior.id,
    revisionNumber: prior.revisionNumber + 1,
    status: 'DRAFT',
    structuredConstraints: [...prior.structuredConstraints, ...constraints],
    transactionId: prior.transactionId,
  });

  return Object.freeze({
    invalidatedRevision: deepFreeze(invalidatedRevision),
    replayRevision: deepFreeze(replayRevision),
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
