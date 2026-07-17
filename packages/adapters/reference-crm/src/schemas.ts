import { z } from 'zod';

export const REFERENCE_CRM_ADAPTER_ID = 'reference-crm';
export const MOVE_FOLLOW_UP_OPERATION = 'move-follow-up';

export const crmRecordSchema = z.object({
  followUpAt: z.string().datetime({ offset: true }),
  id: z.string().min(1),
  label: z.string().min(1),
  version: z.string().min(1),
});

export type CrmRecord = z.infer<typeof crmRecordSchema>;

export const stageFollowUpInputSchema = z.object({
  recordId: z.string().min(1),
  source: z.object({
    field: z.string().min(1),
    resourceKey: z.string().min(1),
  }),
});

export type StageFollowUpInput = z.infer<typeof stageFollowUpInputSchema>;

export const moveFollowUpPayloadSchema = z.object({
  followUpAt: z.string().datetime({ offset: true }),
  recordId: z.string().min(1),
});

export const moveFollowUpEffectSchema = z.object({
  adapterId: z.literal(REFERENCE_CRM_ADAPTER_ID),
  dependencies: z.array(z.string().min(1)).length(1),
  externalities: z.array(z.string()).length(0),
  id: z.string().min(1),
  operation: z.literal(MOVE_FOLLOW_UP_OPERATION),
  payload: moveFollowUpPayloadSchema,
  preconditions: z.tuple([z.object({
    before: crmRecordSchema,
    kind: z.literal('VERSION_EQUALS'),
    version: z.string().min(1),
  })]),
  presentation: z.object({ summary: z.string().min(1) }),
  resourceKey: z.string().min(1),
  risk: z.literal('REVERSIBLE'),
  verification: z.object({
    expected: moveFollowUpPayloadSchema,
    kind: z.literal('CRM_FOLLOW_UP_FIELDS_EQUAL'),
  }),
}).superRefine((effect, context) => {
  const expectedResourceKey = `${REFERENCE_CRM_ADAPTER_ID}:record:${effect.payload.recordId}`;
  const precondition = effect.preconditions[0];
  if (effect.resourceKey !== expectedResourceKey) {
    context.addIssue({ code: 'custom', message: 'CRM resource key does not match payload record' });
  }
  if (
    precondition.before.id !== effect.payload.recordId
    || precondition.version !== precondition.before.version
  ) {
    context.addIssue({ code: 'custom', message: 'CRM precondition does not match payload record' });
  }
  if (
    effect.verification.expected.recordId !== effect.payload.recordId
    || effect.verification.expected.followUpAt !== effect.payload.followUpAt
  ) {
    context.addIssue({ code: 'custom', message: 'CRM verification does not match payload' });
  }
});

export interface CrmFollowUpDiff {
  readonly after: Pick<CrmRecord, 'followUpAt' | 'id'>;
  readonly before: Pick<CrmRecord, 'followUpAt' | 'id'>;
}
