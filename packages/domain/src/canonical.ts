import { createHash } from 'node:crypto';

import {
  observationSchema,
  snapshotManifestSchema,
  type Observation,
  type SnapshotManifest,
} from './schemas.js';

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical data cannot contain non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => compareStrings(left, right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(',')}}`;
  }
  throw new TypeError(`Unsupported canonical value type: ${typeof value}`);
}

export function computeCanonicalDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}

export function computeSnapshotDigest(observations: readonly Observation[]): string {
  const parsed = observations.map((observation) => observationSchema.parse(observation));
  const ordered = parsed.toSorted((left, right) => {
    const adapterComparison = compareStrings(left.adapterId, right.adapterId);
    return adapterComparison === 0
      ? compareStrings(left.resourceKey, right.resourceKey)
      : adapterComparison;
  });
  return computeCanonicalDigest(ordered);
}

export function createSnapshotManifest(
  observations: readonly Observation[],
): Readonly<SnapshotManifest> {
  const parsed = observations.map((observation) => observationSchema.parse(observation));
  const snapshot = snapshotManifestSchema.parse({
    digest: computeSnapshotDigest(parsed),
    observations: parsed,
  });
  return deepFreeze(snapshot);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
