import { createHash } from 'node:crypto';

import { effectGraphSchema, type EffectGraph } from '@preview/domain';

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
    const entries = Object.entries(value).sort(([left], [right]) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(',')}}`;
  }
  throw new TypeError(`Unsupported canonical value type: ${typeof value}`);
}

export function computeEffectGraphDigest(graph: EffectGraph): string {
  const parsed = effectGraphSchema.parse(graph);
  return `sha256:${createHash('sha256').update(canonicalize(parsed)).digest('hex')}`;
}
