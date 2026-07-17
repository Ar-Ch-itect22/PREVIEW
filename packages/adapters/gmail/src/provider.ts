import type { GoogleApiTransport } from '@preview/google-common';
import { GoogleApiError } from '@preview/google-common';
import { z } from 'zod';

import { buildDeterministicMime, parseControlledMime, rfcMessageIdForLogicalId } from './mime.js';
import { gmailResourceSchema, type GmailPayload, type GmailResource } from './schemas.js';

const profileSchema = z.object({ emailAddress: z.string().email() });
const messageReferenceSchema = z.object({ id: z.string().min(1), threadId: z.string().optional() });
const messageListSchema = z.object({ messages: z.array(messageReferenceSchema).optional() });
const draftListSchema = z.object({
  drafts: z.array(z.object({ id: z.string().min(1), message: messageReferenceSchema })).optional(),
  nextPageToken: z.string().min(1).optional(),
});
const rawMessageSchema = z.object({
  historyId: z.string().min(1),
  id: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
  raw: z.string().min(1),
});
const draftMutationSchema = z.object({
  id: z.string().min(1),
  message: z.object({ historyId: z.string().optional(), id: z.string().min(1) }),
});
const rawDraftSchema = z.object({ id: z.string().min(1), message: rawMessageSchema });
const sendMutationSchema = z.object({ historyId: z.string().optional(), id: z.string().min(1) });

export type GmailResourceKind = 'draft' | 'message';

export interface GmailReadPort {
  findExact(kind: GmailResourceKind, logicalId: string): Promise<readonly GmailResource[]>;
  readDraft(providerDraftId: string): Promise<GmailResource | undefined>;
  readMessage(providerMessageId: string): Promise<GmailResource | undefined>;
}

export interface GmailCommitPort extends GmailReadPort {
  createDraft(payload: GmailPayload): Promise<GmailResource>;
  deleteDraft(providerDraftId: string): Promise<void>;
  sendMessage(payload: GmailPayload): Promise<GmailResource>;
}

export class GmailProvider implements GmailCommitPort {
  readonly #transport: GoogleApiTransport;

  public constructor(transport: GoogleApiTransport) {
    this.#transport = transport;
  }

  public async createDraft(payload: GmailPayload): Promise<GmailResource> {
    await this.#assertPrimaryIdentity(payload.from);
    const created = await this.#transport.request({
      body: { message: { raw: payload.rawBase64Url } },
      method: 'POST',
      parse: (value) => draftMutationSchema.parse(value),
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    });
    const draft = await this.#getDraft(created.id);
    return this.#toResource(draft.message, draft.id);
  }

  public async sendMessage(payload: GmailPayload): Promise<GmailResource> {
    await this.#assertPrimaryIdentity(payload.from);
    const sent = await this.#transport.request({
      body: { raw: payload.rawBase64Url },
      method: 'POST',
      parse: (value) => sendMutationSchema.parse(value),
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    });
    return this.#toResource(await this.#getMessage(sent.id));
  }

  public async deleteDraft(providerDraftId: string): Promise<void> {
    await this.#transport.request({
      method: 'DELETE',
      parse: (value) => z.null().parse(value),
      url: `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(providerDraftId)}`,
    });
  }

  public async findExact(kind: GmailResourceKind, logicalId: string): Promise<readonly GmailResource[]> {
    if (kind === 'draft') {
      const drafts = await this.#listDrafts();
      const resources = await Promise.all(drafts.map(async (draft) => {
        const current = await this.#getDraft(draft.id);
        return this.#toResource(current.message, current.id);
      }));
      const rfcMessageId = rfcMessageIdForLogicalId(logicalId);
      return resources.filter((resource) => (
        resource.logicalId === logicalId && resource.rfcMessageId === rfcMessageId
      ));
    }
    const rfcMessageId = rfcMessageIdForLogicalId(logicalId);
    const list = await this.#transport.request({
      method: 'GET',
      parse: (value) => messageListSchema.parse(value),
      url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`rfc822msgid:${rfcMessageId}`)}&maxResults=10`,
    });
    const messages = await Promise.all((list.messages ?? []).map(async (reference) => this.#getMessage(reference.id)));
    return messages
      .filter((message) => message.labelIds?.includes('DRAFT') !== true)
      .map((message) => this.#toResource(message));
  }

  public async readDraft(providerDraftId: string): Promise<GmailResource | undefined> {
    try {
      const draft = await this.#getDraft(providerDraftId);
      return this.#toResource(draft.message, draft.id);
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  public async readMessage(providerMessageId: string): Promise<GmailResource | undefined> {
    try {
      return this.#toResource(await this.#getMessage(providerMessageId));
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async #assertPrimaryIdentity(expected: string): Promise<void> {
    const profile = await this.#transport.request({
      method: 'GET',
      parse: (value) => profileSchema.parse(value),
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    });
    if (profile.emailAddress.toLowerCase() !== expected.toLowerCase()) {
      throw new GoogleApiError(403, 'Approved From address does not match the authenticated Gmail identity');
    }
  }

  async #getMessage(providerMessageId: string): Promise<z.infer<typeof rawMessageSchema>> {
    return this.#transport.request({
      method: 'GET',
      parse: (value) => rawMessageSchema.parse(value),
      url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}?format=raw`,
    });
  }

  async #getDraft(providerDraftId: string): Promise<z.infer<typeof rawDraftSchema>> {
    return this.#transport.request({
      method: 'GET',
      parse: (value) => rawDraftSchema.parse(value),
      url: `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(providerDraftId)}?format=raw`,
    });
  }

  async #listDrafts(): Promise<readonly NonNullable<z.infer<typeof draftListSchema>['drafts']>[number][]> {
    const drafts = await this.#transport.request({
      method: 'GET',
      parse: (value) => draftListSchema.parse(value),
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=500',
    });
    if (drafts.nextPageToken !== undefined) {
      throw new TypeError('Gmail draft count exceeds the certified complete-read boundary');
    }
    return drafts.drafts ?? [];
  }

  #toResource(message: z.infer<typeof rawMessageSchema>, providerDraftId?: string): GmailResource {
    const controlled = parseControlledMime(message.raw);
    const deterministic = buildDeterministicMime(controlled);
    return gmailResourceSchema.parse({
      ...controlled,
      ...deterministic,
      ...(providerDraftId === undefined ? {} : { providerDraftId }),
      providerMessageId: message.id,
      state: message.labelIds?.includes('DRAFT') === true ? 'DRAFT' : 'SENT',
      version: message.historyId,
    });
  }
}
