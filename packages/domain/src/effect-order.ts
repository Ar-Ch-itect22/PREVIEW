import { effectGraphSchema, type Effect, type EffectGraph } from './schemas.js';

const riskRank = {
  COMPENSABLE: 1,
  IRREVERSIBLE: 2,
  REVERSIBLE: 0,
} as const satisfies Record<Effect['risk'], number>;

export function planEffectOrder(graph: EffectGraph): readonly Readonly<Effect>[] {
  const parsed = effectGraphSchema.parse(graph);
  const originalIndex = new Map(parsed.effects.map((effect, index) => [effect.id, index] as const));
  const remaining = new Map(parsed.effects.map((effect) => [effect.id, effect] as const));
  const completed = new Set<string>();
  const ordered: Effect[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((effect) => effect.dependencies.every((dependency) => completed.has(dependency)))
      .sort((left, right) => {
        const riskComparison = riskRank[left.risk] - riskRank[right.risk];
        return riskComparison !== 0
          ? riskComparison
          : (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
      });
    const next = ready[0];
    if (next === undefined) {
      throw new TypeError('Effect graph has no dependency-safe execution order');
    }
    remaining.delete(next.id);
    completed.add(next.id);
    ordered.push(structuredClone(next));
  }

  return deepFreeze(ordered);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
