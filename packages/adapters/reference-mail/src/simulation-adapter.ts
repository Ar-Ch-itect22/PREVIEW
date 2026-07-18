import type { SimulationAdapter, StageContext, StagedOperation } from '@preview/adapter-sdk';
import type { Effect } from '@preview/domain';
import { z } from 'zod';

import type { MailReadPort } from './provider.js';
import {
  mailMessageSchema,
  REFERENCE_MAIL_ADAPTER_ID,
  SEND_MESSAGE_OPERATION,
  sendMessageEffectSchema,
  sendMessagePayloadSchema,
  sendMessageVerificationSchema,
  stageMailInputSchema,
  type MailMessage,
  type MailMessageDiff,
  type StageMailInput,
} from './schemas.js';

export class ReferenceMailSimulationAdapter
implements SimulationAdapter<MailMessage, StageMailInput, MailMessageDiff> {
  public readonly adapterId = REFERENCE_MAIL_ADAPTER_ID;
  readonly #readPort: MailReadPort;

  public constructor(readPort: MailReadPort) {
    this.#readPort = readPort;
  }

  public read(resourceKey: string): Promise<MailMessage | undefined> {
    return this.#readPort.readMessage(this.#messageId(resourceKey));
  }

  public stage(
    current: MailMessage | undefined,
    mutation: StageMailInput,
    context: StageContext,
  ): StagedOperation<MailMessage, MailMessageDiff> {
    if (current !== undefined) {
      throw new Error('Reference Mail message ID already exists');
    }
    const input = stageMailInputSchema.parse(mutation);
    const dependency = context.dependencies.find(
      (candidate) => candidate.resourceKey === input.textBody.resourceKey,
    );
    if (dependency === undefined || context.dependencies.length !== 1) {
      throw new Error('Mail body source must be exactly one runtime-owned staged dependency');
    }
    const source = z.record(z.string(), z.unknown()).parse(dependency.resource);
    const sourceValue = formatSourceValue(
      z.string().parse(source[input.textBody.field]),
      input.textBody.format,
    );
    const payload = sendMessagePayloadSchema.parse({
      messageId: input.messageId,
      recipients: input.recipients,
      subject: input.subject,
      textBody: `${input.textBody.prefix}${sourceValue}${input.textBody.suffix}`,
    });
    const resource = mailMessageSchema.parse({
      ...payload,
      id: payload.messageId,
      state: 'STAGED',
      version: null,
    });
    const effect: Effect = sendMessageEffectSchema.parse({
      adapterId: this.adapterId,
      dependencies: context.dependencies.map((candidate) => candidate.effectId),
      externalities: ['DELIVERS_EXTERNAL_MESSAGE'],
      id: context.effectId,
      operation: SEND_MESSAGE_OPERATION,
      payload,
      preconditions: [{ kind: 'MESSAGE_ID_ABSENT', messageId: payload.messageId }],
      presentation: {
        summary: `Send ${payload.messageId} to ${payload.recipients.join(', ')}`,
      },
      resourceKey: this.#resourceKey(payload.messageId),
      risk: 'IRREVERSIBLE',
      verification: sendMessageVerificationSchema.parse({
        expected: payload,
        kind: 'MAIL_MESSAGE_EXACTLY_RECONCILED',
      }),
    });
    return { diff: this.renderDiff(effect), effect, resource };
  }

  public renderDiff(effect: Effect): MailMessageDiff {
    const parsed = sendMessageEffectSchema.parse(effect);
    return {
      after: {
        id: parsed.payload.messageId,
        recipients: parsed.payload.recipients,
        subject: parsed.payload.subject,
        textBody: parsed.payload.textBody,
      },
      before: null,
      externalities: ['DELIVERS_EXTERNAL_MESSAGE'],
      risk: 'IRREVERSIBLE',
    };
  }

  #messageId(resourceKey: string): string {
    const prefix = `${this.adapterId}:message:`;
    if (!resourceKey.startsWith(prefix)) {
      throw new Error(`Invalid Reference Mail resource key: ${resourceKey}`);
    }
    return resourceKey.slice(prefix.length);
  }

  #resourceKey(messageId: string): string {
    return `${this.adapterId}:message:${messageId}`;
  }
}

function formatSourceValue(value: string, format: 'RAW' | 'UTC_HUMAN' | undefined): string {
  if (format !== 'UTC_HUMAN') return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('UTC_HUMAN mail source must be an ISO timestamp');
  return `${new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    hour12: true,
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(date)} UTC`;
}
