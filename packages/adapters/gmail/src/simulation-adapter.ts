import type { SimulationAdapter, StageContext, StagedOperation } from '@preview/adapter-sdk';
import type { Effect } from '@preview/domain';

import { buildDeterministicMime } from './mime.js';
import type { GmailReadPort } from './provider.js';
import {
  GMAIL_ADAPTER_ID,
  GMAIL_CREATE_DRAFT_OPERATION,
  gmailExactEffectSchema,
  gmailMutationInputSchema,
  gmailResourceKey,
  parseGmailResourceKey,
  type GmailDiff,
  type GmailMutationInput,
  type GmailResource,
} from './schemas.js';

export class GmailSimulationAdapter implements SimulationAdapter<GmailResource, GmailMutationInput, GmailDiff> {
  public readonly adapterId = GMAIL_ADAPTER_ID;
  readonly #port: GmailReadPort;

  public constructor(port: GmailReadPort) {
    this.#port = port;
  }

  public async read(resourceKey: string): Promise<GmailResource | undefined> {
    const key = parseGmailResourceKey(resourceKey);
    const matches = await this.#port.findExact(key.kind, key.logicalId);
    if (matches.length > 1) throw new TypeError('Multiple Gmail resources share the certified Message-ID');
    return matches.length === 1 ? matches[0] : undefined;
  }

  public stage(
    current: GmailResource | undefined,
    mutation: GmailMutationInput,
    context: StageContext,
  ): StagedOperation<GmailResource, GmailDiff> {
    if (current !== undefined) throw new TypeError('Gmail Message-ID already exists');
    const input = gmailMutationInputSchema.parse(mutation);
    const mime = buildDeterministicMime(input);
    const draft = input.operation === GMAIL_CREATE_DRAFT_OPERATION;
    const parsedEffect = gmailExactEffectSchema.parse({
      adapterId: this.adapterId,
      dependencies: context.dependencies.map((dependency) => dependency.effectId),
      externalities: [draft ? 'GMAIL_DRAFT_HISTORY_PERSISTS' : 'DELIVERS_EXTERNAL_MESSAGE'],
      id: context.effectId,
      operation: input.operation,
      payload: { ...input, operation: undefined, ...mime },
      preconditions: [{ kind: 'RFC_MESSAGE_ID_ABSENT', rfcMessageId: mime.rfcMessageId }],
      presentation: {
        summary: `${draft ? 'Create Gmail draft' : 'Send Gmail message'} ${input.logicalId} to ${input.recipients.join(', ')}`,
      },
      resourceKey: gmailResourceKey(draft ? 'draft' : 'message', input.logicalId),
      risk: draft ? 'COMPENSABLE' : 'IRREVERSIBLE',
      verification: { expected: { rawDigest: mime.rawDigest }, kind: 'GMAIL_CONTROLLED_MIME_EQUAL' },
    });
    const effect: Effect = parsedEffect;
    const resource: GmailResource = {
      ...parsedEffect.payload,
      providerMessageId: `staged:${input.logicalId}`,
      state: draft ? 'DRAFT' : 'SENT',
      version: 'STAGED',
    };
    return { diff: this.renderDiff(effect), effect, resource };
  }

  public renderDiff(effect: Effect): GmailDiff {
    const parsed = gmailExactEffectSchema.parse(effect);
    return {
      after: {
        from: parsed.payload.from,
        recipients: parsed.payload.recipients,
        subject: parsed.payload.subject,
        textBody: parsed.payload.textBody,
      },
      before: null,
      externalities: parsed.externalities,
      risk: parsed.risk,
    };
  }
}
