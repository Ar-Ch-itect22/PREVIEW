import {
  computeCanonicalDigest,
  effectGraphSchema,
  type EffectGraph,
} from '@preview/domain';

export {
  canonicalize,
  computeCanonicalDigest,
  computeSnapshotDigest,
  createSnapshotManifest,
} from '@preview/domain';

export function computeEffectGraphDigest(graph: EffectGraph): string {
  const parsed = effectGraphSchema.parse(graph);
  return computeCanonicalDigest(parsed);
}
