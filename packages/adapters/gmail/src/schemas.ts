import { z } from 'zod';

import { GMAIL_MIME_BUILDER_VERSION } from './mime.js';

export const GMAIL_ADAPTER_ID = 'gmail';
export const GMAIL_CREATE_DRAFT_OPERATION = 'create-draft-exact';
export const GMAIL_SEND_MESSAGE_OPERATION = 'send-message-exact';
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

const emailSchema = z.string().email();
const asciiSubjectSchema = z.string().min(1).max(998).regex(/^[\x20-\x7E]+$/u);
const exactContentSchema = z.object({
  from: emailSchema,
  logicalId: z.string().min(1).max(255).regex(/^[\x21-\x7E]+$/u),
  recipients: z.array(emailSchema).min(1),
  subject: asciiSubjectSchema,
  textBody: z.string().min(1),
});

export const gmailMutationInputSchema = z.discriminatedUnion('operation', [
  exactContentSchema.extend({ operation: z.literal(GMAIL_CREATE_DRAFT_OPERATION) }),
  exactContentSchema.extend({ operation: z.literal(GMAIL_SEND_MESSAGE_OPERATION) }),
]);
export type GmailMutationInput = z.infer<typeof gmailMutationInputSchema>;

export const gmailPayloadSchema = exactContentSchema.extend({
  builderVersion: z.literal(GMAIL_MIME_BUILDER_VERSION),
  rawBase64Url: z.string().min(1),
  rawDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  rfcMessageId: z.string().regex(/^<preview\.[a-f0-9]{64}@preview\.invalid>$/u),
});
export type GmailPayload = z.infer<typeof gmailPayloadSchema>;

export const gmailResourceSchema = gmailPayloadSchema.extend({
  providerDraftId: z.string().min(1).optional(),
  providerMessageId: z.string().min(1),
  state: z.enum(['DRAFT', 'SENT']),
  version: z.string().min(1),
});
export type GmailResource = z.infer<typeof gmailResourceSchema>;

const baseEffectSchema = z.object({
  adapterId: z.literal(GMAIL_ADAPTER_ID),
  dependencies: z.array(z.string().min(1)),
  id: z.string().min(1),
  payload: gmailPayloadSchema,
  preconditions: z.tuple([z.object({
    kind: z.literal('RFC_MESSAGE_ID_ABSENT'),
    rfcMessageId: z.string().min(1),
  })]),
  presentation: z.object({ summary: z.string().min(1) }),
  resourceKey: z.string().min(1),
  verification: z.object({
    expected: z.object({ rawDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }),
    kind: z.literal('GMAIL_CONTROLLED_MIME_EQUAL'),
  }),
});

export const gmailExactEffectSchema = z.discriminatedUnion('operation', [
  baseEffectSchema.extend({
    externalities: z.tuple([z.literal('GMAIL_DRAFT_HISTORY_PERSISTS')]),
    operation: z.literal(GMAIL_CREATE_DRAFT_OPERATION),
    risk: z.literal('COMPENSABLE'),
  }),
  baseEffectSchema.extend({
    externalities: z.tuple([z.literal('DELIVERS_EXTERNAL_MESSAGE')]),
    operation: z.literal(GMAIL_SEND_MESSAGE_OPERATION),
    risk: z.literal('IRREVERSIBLE'),
  }),
]).superRefine((effect, context) => {
  if (new Set(effect.dependencies).size !== effect.dependencies.length) {
    context.addIssue({ code: 'custom', message: 'Gmail effect contains duplicate dependencies' });
  }
  if (new Set(effect.payload.recipients).size !== effect.payload.recipients.length) {
    context.addIssue({ code: 'custom', message: 'Gmail effect contains duplicate recipients' });
  }
  if (effect.preconditions[0].rfcMessageId !== effect.payload.rfcMessageId) {
    context.addIssue({ code: 'custom', message: 'Gmail precondition does not match MIME Message-ID' });
  }
  if (effect.verification.expected.rawDigest !== effect.payload.rawDigest) {
    context.addIssue({ code: 'custom', message: 'Gmail verification digest does not match MIME' });
  }
  const kind = effect.operation === GMAIL_CREATE_DRAFT_OPERATION ? 'draft' : 'message';
  if (effect.resourceKey !== gmailResourceKey(kind, effect.payload.logicalId)) {
    context.addIssue({ code: 'custom', message: 'Gmail resource key does not match operation payload' });
  }
});
export type GmailExactEffect = z.infer<typeof gmailExactEffectSchema>;

export interface GmailDiff {
  readonly after: Pick<GmailPayload, 'from' | 'recipients' | 'subject' | 'textBody'>;
  readonly before: null;
  readonly externalities: readonly string[];
  readonly risk: 'COMPENSABLE' | 'IRREVERSIBLE';
}

export function gmailResourceKey(kind: 'draft' | 'message', logicalId: string): string {
  return `${GMAIL_ADAPTER_ID}:${kind}/${encodeURIComponent(logicalId)}`;
}

export function parseGmailResourceKey(value: string): { readonly kind: 'draft' | 'message'; readonly logicalId: string } {
  const match = /^gmail:(draft|message)\/(.+)$/u.exec(value);
  if (match === null) throw new TypeError('Invalid Gmail resource key');
  return { kind: match[1] as 'draft' | 'message', logicalId: decodeURIComponent(match[2] ?? '') };
}
