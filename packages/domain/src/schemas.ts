import { z } from 'zod';

export const identifierSchema = z.string().min(1).max(255);
export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const timestampSchema = z.string().datetime({ offset: true });

export const transactionStatusSchema = z.enum([
  'CREATED',
  'SIMULATING',
  'REVIEW_READY',
  'ABORTED',
  'APPROVED',
  'REVALIDATING',
  'CONFLICTED',
  'COMMITTING',
  'VERIFYING',
  'COMMITTED_VERIFIED',
  'COMPENSATING',
  'COMPENSATED',
  'COMPLETED_WITH_RESIDUALS',
  'REQUIRES_ATTENTION',
]);

export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

export const transactionSchema = z.object({
  activeRevisionId: identifierSchema.nullable(),
  id: identifierSchema,
  intent: z.string().min(1),
  status: transactionStatusSchema,
  tenantId: identifierSchema,
});

export type Transaction = z.infer<typeof transactionSchema>;

export const revisionStatusSchema = z.enum([
  'DRAFT',
  'SEALED',
  'SUPERSEDED',
  'APPROVED',
  'INVALIDATED',
]);

export type RevisionStatus = z.infer<typeof revisionStatusSchema>;

export const structuredConstraintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DENY_MUTATION'), resourceKey: identifierSchema }),
  z.object({
    field: identifierSchema,
    kind: z.literal('PRESERVE_FIELD'),
    resourceKey: identifierSchema,
  }),
  z.object({
    kind: z.literal('REPLACE_VALUE'),
    resourceKey: identifierSchema,
    value: z.unknown(),
  }),
]);

export type StructuredConstraint = z.infer<typeof structuredConstraintSchema>;

export const effectRiskSchema = z.enum(['REVERSIBLE', 'COMPENSABLE', 'IRREVERSIBLE']);

export const effectSchema = z.object({
  adapterId: identifierSchema,
  dependencies: z.array(identifierSchema),
  externalities: z.array(z.string()),
  id: identifierSchema,
  operation: identifierSchema,
  payload: z.unknown(),
  preconditions: z.array(z.unknown()),
  presentation: z.object({ summary: z.string().min(1) }),
  resourceKey: identifierSchema,
  risk: effectRiskSchema,
  verification: z.object({ kind: identifierSchema, expected: z.unknown() }),
});

export type Effect = z.infer<typeof effectSchema>;

export const effectGraphSchema = z.object({
  effects: z.array(effectSchema),
  version: z.literal(1),
}).superRefine((graph, context) => {
  const effectsById = new Map<string, Effect>();
  for (const [index, effect] of graph.effects.entries()) {
    if (effectsById.has(effect.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate effect ID: ${effect.id}`,
        path: ['effects', index, 'id'],
      });
    } else {
      effectsById.set(effect.id, effect);
    }
    if (new Set(effect.dependencies).size !== effect.dependencies.length) {
      context.addIssue({
        code: 'custom',
        message: `Effect ${effect.id} contains duplicate dependencies`,
        path: ['effects', index, 'dependencies'],
      });
    }
  }

  for (const [index, effect] of graph.effects.entries()) {
    for (const dependency of effect.dependencies) {
      if (!effectsById.has(dependency)) {
        context.addIssue({
          code: 'custom',
          message: `Effect ${effect.id} depends on unknown effect ${dependency}`,
          path: ['effects', index, 'dependencies'],
        });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (effectId: string): boolean => {
    if (visiting.has(effectId)) return true;
    if (visited.has(effectId)) return false;
    visiting.add(effectId);
    const effect = effectsById.get(effectId);
    if (effect !== undefined) {
      for (const dependency of effect.dependencies) {
        if (effectsById.has(dependency) && visit(dependency)) return true;
      }
    }
    visiting.delete(effectId);
    visited.add(effectId);
    return false;
  };
  for (const effectId of effectsById.keys()) {
    if (visit(effectId)) {
      context.addIssue({ code: 'custom', message: 'Effect graph contains a dependency cycle' });
      break;
    }
  }
});

export type EffectGraph = z.infer<typeof effectGraphSchema>;

export const simulationRevisionSchema = z.object({
  baseSnapshotId: identifierSchema,
  effectGraph: effectGraphSchema.nullable(),
  graphDigest: digestSchema.nullable(),
  id: identifierSchema,
  replayOfRevisionId: identifierSchema.nullable(),
  revisionNumber: z.number().int().positive(),
  status: revisionStatusSchema,
  structuredConstraints: z.array(structuredConstraintSchema),
  transactionId: identifierSchema,
});

export type SimulationRevision = z.infer<typeof simulationRevisionSchema>;

export const approvalSchema = z.object({
  approverId: identifierSchema,
  expiresAt: timestampSchema,
  graphDigest: digestSchema,
  policyVersion: identifierSchema,
  revisionId: identifierSchema,
  signature: z.string().min(1),
  tenantId: identifierSchema,
});

export type Approval = z.infer<typeof approvalSchema>;

export const observationSchema = z.object({
  observedAt: timestampSchema,
  provider: identifierSchema,
  resourceKey: identifierSchema,
  valueDigest: digestSchema,
  valueReference: identifierSchema,
  version: z.string().min(1),
});

export type Observation = z.infer<typeof observationSchema>;

export const effectAttemptSchema = z.object({
  attemptNumber: z.number().int().positive(),
  effectId: identifierSchema,
  idempotencyKey: identifierSchema,
  providerResult: z.unknown().optional(),
  status: z.enum(['STARTED', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'RECONCILED']),
});

export type EffectAttempt = z.infer<typeof effectAttemptSchema>;
