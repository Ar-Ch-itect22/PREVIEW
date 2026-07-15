import { z } from 'zod';

export const REFERENCE_MAIL_ADAPTER_ID = 'reference-mail';
export const SEND_MESSAGE_OPERATION = 'send-message';

const recipientsSchema = z.array(z.string().email()).min(1);

export const mailMessageSchema = z.object({
  id: z.string().min(1),
  recipients: recipientsSchema,
  state: z.enum(['STAGED', 'DELIVERED']),
  subject: z.string().min(1),
  textBody: z.string().min(1),
  version: z.string().min(1).nullable(),
});

export type MailMessage = z.infer<typeof mailMessageSchema>;

export const stageMailInputSchema = z.object({
  messageId: z.string().min(1),
  recipients: recipientsSchema,
  subject: z.string().min(1),
  textBody: z.object({
    field: z.string().min(1),
    prefix: z.string(),
    resourceKey: z.string().min(1),
    suffix: z.string(),
  }),
});

export type StageMailInput = z.infer<typeof stageMailInputSchema>;

export const sendMessagePayloadSchema = z.object({
  messageId: z.string().min(1),
  recipients: recipientsSchema,
  subject: z.string().min(1),
  textBody: z.string().min(1),
});

export const sendMessageVerificationSchema = z.object({
  expected: sendMessagePayloadSchema,
  kind: z.literal('MAIL_MESSAGE_EXACTLY_RECONCILED'),
});

export const sendMessageEffectSchema = z.object({
  adapterId: z.literal(REFERENCE_MAIL_ADAPTER_ID),
  dependencies: z.array(z.string().min(1)).min(1),
  externalities: z.tuple([z.literal('DELIVERS_EXTERNAL_MESSAGE')]),
  id: z.string().min(1),
  operation: z.literal(SEND_MESSAGE_OPERATION),
  payload: sendMessagePayloadSchema,
  preconditions: z.tuple([z.object({
    kind: z.literal('MESSAGE_ID_ABSENT'),
    messageId: z.string().min(1),
  })]),
  presentation: z.object({ summary: z.string().min(1) }),
  resourceKey: z.string().min(1),
  risk: z.literal('IRREVERSIBLE'),
  verification: sendMessageVerificationSchema,
}).superRefine((effect, context) => {
  const expectedResourceKey = `${REFERENCE_MAIL_ADAPTER_ID}:message:${effect.payload.messageId}`;
  if (effect.resourceKey !== expectedResourceKey) {
    context.addIssue({ code: 'custom', message: 'Mail resource key does not match payload message' });
  }
  if (effect.preconditions[0].messageId !== effect.payload.messageId) {
    context.addIssue({ code: 'custom', message: 'Mail precondition does not match payload message' });
  }
  if (new Set(effect.dependencies).size !== effect.dependencies.length) {
    context.addIssue({ code: 'custom', message: 'Mail effect contains duplicate dependencies' });
  }
  if (new Set(effect.payload.recipients).size !== effect.payload.recipients.length) {
    context.addIssue({ code: 'custom', message: 'Mail effect contains duplicate recipients' });
  }
  const expected = effect.verification.expected;
  if (
    expected.messageId !== effect.payload.messageId
    || expected.subject !== effect.payload.subject
    || expected.textBody !== effect.payload.textBody
    || expected.recipients.length !== effect.payload.recipients.length
    || expected.recipients.some((recipient, index) => recipient !== effect.payload.recipients[index])
  ) {
    context.addIssue({ code: 'custom', message: 'Mail verification does not match commit payload' });
  }
});

export interface MailMessageDiff {
  readonly after: Pick<MailMessage, 'id' | 'recipients' | 'subject' | 'textBody'>;
  readonly before: null;
  readonly externalities: readonly ['DELIVERS_EXTERNAL_MESSAGE'];
  readonly risk: 'IRREVERSIBLE';
}
