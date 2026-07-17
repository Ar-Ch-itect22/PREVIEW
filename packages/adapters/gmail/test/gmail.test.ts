import {
  assertCommitLifecycle,
  assertDeterministicSimulation,
  assertUnknownWriteFailsClosed,
} from '@preview/adapter-testkit';
import { DefinitelyNotAppliedError } from '@preview/adapter-sdk';
import {
  GoogleApiError,
  GoogleTransportError,
  type GoogleApiRequest,
  type GoogleApiTransport,
} from '@preview/google-common';
import { describe, expect, it } from 'vitest';

import {
  buildDeterministicMime,
  GmailCommitAdapter,
  GmailProvider,
  GmailSimulationAdapter,
  parseControlledMime,
  type GmailMutationInput,
} from '../src/index.js';

interface StoredMessage {
  readonly historyId: string;
  readonly id: string;
  readonly labelIds: readonly string[];
  readonly raw: string;
}

class GmailTransport implements GoogleApiTransport {
  public readonly requests: GoogleApiRequest<unknown>[] = [];
  public readonly messages = new Map<string, StoredMessage>();
  public readonly drafts = new Map<string, string>();
  public mutations = 0;
  public failAfterApply = false;
  public identity = 'sender@example.test';
  public messageSearchVisible = true;

  public async request<T>(request: GoogleApiRequest<T>): Promise<T> {
    await Promise.resolve();
    this.requests.push(request);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/profile')) return request.parse({ emailAddress: this.identity });
    if (request.method === 'GET' && url.pathname.endsWith('/messages')) {
      return request.parse({
        messages: this.messageSearchVisible
          ? [...this.messages.values()].map(({ id }) => ({ id }))
          : [],
      });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/drafts')) {
      return request.parse({
        drafts: [...this.drafts.entries()].map(([id, messageId]) => ({ id, message: { id: messageId } })),
      });
    }
    const messageMatch = /\/messages\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'GET' && messageMatch !== null) {
      const message = this.messages.get(decodeURIComponent(messageMatch[1] ?? ''));
      if (message === undefined) throw new GoogleApiError(404, 'message missing');
      return request.parse(structuredClone(message));
    }
    const draftMatch = /\/drafts\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'GET' && draftMatch !== null) {
      const draftId = decodeURIComponent(draftMatch[1] ?? '');
      const messageId = this.drafts.get(draftId);
      if (messageId === undefined) throw new GoogleApiError(404, 'draft missing');
      const message = this.messages.get(messageId);
      if (message === undefined) throw new GoogleApiError(404, 'draft message missing');
      return request.parse({ id: draftId, message });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/drafts')) {
      const raw = foldMessageId((request.body as { message: { raw: string } }).message.raw);
      const messageId = `message-${String(this.mutations + 1)}`;
      const draftId = `draft-${String(this.mutations + 1)}`;
      this.mutations += 1;
      this.messages.set(messageId, { historyId: String(this.mutations), id: messageId, labelIds: ['DRAFT'], raw });
      this.drafts.set(draftId, messageId);
      if (this.failAfterApply) return this.#failAfterApply();
      return request.parse({ id: draftId, message: { historyId: String(this.mutations), id: messageId } });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/messages/send')) {
      const raw = (request.body as { raw: string }).raw;
      const messageId = `message-${String(this.mutations + 1)}`;
      this.mutations += 1;
      this.messages.set(messageId, { historyId: String(this.mutations), id: messageId, labelIds: ['SENT'], raw });
      if (this.failAfterApply) return this.#failAfterApply();
      return request.parse({ historyId: String(this.mutations), id: messageId });
    }
    if (request.method === 'DELETE' && draftMatch !== null) {
      const draftId = decodeURIComponent(draftMatch[1] ?? '');
      const messageId = this.drafts.get(draftId);
      if (messageId === undefined) throw new GoogleApiError(404, 'draft missing');
      this.mutations += 1;
      this.drafts.delete(draftId);
      this.messages.delete(messageId);
      if (this.failAfterApply) return this.#failAfterApply();
      return request.parse(null);
    }
    throw new GoogleApiError(405, `unsupported test request ${request.method} ${url.pathname}`);
  }

  #failAfterApply(): never {
    this.failAfterApply = false;
    throw new GoogleTransportError('connection dropped after apply');
  }
}

function foldMessageId(rawBase64Url: string): string {
  const raw = Buffer.from(rawBase64Url, 'base64url').toString('utf8');
  return Buffer.from(
    raw.replace(/\r\nMessage-ID: /u, '\r\nMessage-ID:\r\n '),
    'utf8',
  ).toString('base64url');
}

function input(operation: GmailMutationInput['operation'], logicalId = 'mail-1'): GmailMutationInput {
  return {
    from: 'sender@example.test',
    logicalId,
    operation,
    recipients: ['recipient@example.test'],
    subject: 'PREVIEW exact message',
    textBody: 'The approved body is exact.\nUnicode body: नमस्ते',
  };
}

function fixture(operation: GmailMutationInput['operation'], logicalId = 'mail-1') {
  const transport = new GmailTransport();
  const provider = new GmailProvider(transport);
  const simulation = new GmailSimulationAdapter(provider);
  const commit = new GmailCommitAdapter(provider);
  const effect = assertDeterministicSimulation({
    adapter: simulation,
    context: {
      dependencies: [{ effectId: 'calendar-move-1', resource: {}, resourceKey: 'google-calendar:event/x/y' }],
      effectId: `${logicalId}-effect`,
    },
    current: undefined,
    mutation: input(operation, logicalId),
  });
  return { commit, effect, provider, simulation, transport };
}

describe('Gmail deterministic MIME', () => {
  it('produces stable approved bytes and round-trips controlled semantics', () => {
    const first = buildDeterministicMime(input('send-message-exact'));
    const second = buildDeterministicMime(input('send-message-exact'));
    expect(first).toEqual(second);
    expect(first.rawDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(parseControlledMime(first.rawBase64Url)).toEqual({
      from: 'sender@example.test',
      logicalId: 'mail-1',
      recipients: ['recipient@example.test'],
      rfcMessageId: first.rfcMessageId,
      subject: 'PREVIEW exact message',
      textBody: 'The approved body is exact.\nUnicode body: नमस्ते',
    });
  });

  it('rejects header injection, duplicate recipients, HTML-like unsupported headers, and unknown writes', async () => {
    const { commit, effect, simulation, transport } = fixture('send-message-exact');
    expect(() => simulation.stage(undefined, {
      ...input('send-message-exact'),
      subject: 'approved\r\nBcc: victim@example.test',
    }, { dependencies: [], effectId: 'bad-header' })).toThrow();
    expect(() => simulation.stage(undefined, {
      ...input('send-message-exact'),
      recipients: ['recipient@example.test', 'recipient@example.test'],
    }, { dependencies: [], effectId: 'duplicate' })).toThrow();
    await assertUnknownWriteFailsClosed({
      adapter: commit,
      effect: { ...effect, operation: 'send-html-with-attachment' },
      mutationCount: () => transport.mutations,
    });
  });
});

describe('Gmail certified operations', () => {
  it('creates and verifies exactly one draft, then removes it with honest residuals', async () => {
    const { commit, effect, transport } = fixture('create-draft-exact', 'draft-1');
    expect(transport.mutations).toBe(0);
    expect(effect.risk).toBe('COMPENSABLE');
    await assertCommitLifecycle({
      adapter: commit,
      effect,
      idempotencyKey: 'run:draft',
      mutationCount: () => transport.mutations,
    });
    const applied = await commit.reconcileCommit(effect, 'run:draft');
    if (applied.status !== 'APPLIED') throw new Error('expected applied draft');
    const compensation = await commit.compensate(effect, applied.result, 'run:draft:compensate');
    expect(compensation).toEqual({
      details: 'Gmail draft removed',
      residuals: ['Gmail mailbox history and provider mutation records remain changed'],
      verified: true,
    });
    expect(transport.mutations).toBe(2);
  });

  it('sends exactly once and reconciles a timeout-after-apply by exact Message-ID and content', async () => {
    const { commit, effect, transport } = fixture('send-message-exact', 'send-1');
    expect(effect.risk).toBe('IRREVERSIBLE');
    transport.failAfterApply = true;
    await expect(commit.commit(effect, 'run:send')).rejects.toThrow('ambiguous');
    const reconciliation = await commit.reconcileCommit(effect, 'run:send');
    expect(reconciliation.status).toBe('APPLIED');
    expect(transport.mutations).toBe(1);
    const reconciled = await commit.reconcileCommit(effect, 'run:send');
    if (reconciled.status !== 'APPLIED') throw new Error('expected reconciled message');
    expect(await commit.verify(effect, reconciled.result)).toMatchObject({
      verified: true,
    });
  });

  it('verifies a successful send by its returned provider ID before Gmail search indexing catches up', async () => {
    const { commit, effect, transport } = fixture('send-message-exact', 'send-direct-verify');
    const applied = await commit.commit(effect, 'run:send-direct-verify');
    transport.messageSearchVisible = false;

    expect(await commit.reconcileCommit(effect, 'run:send-direct-verify')).toMatchObject({ status: 'UNKNOWN' });
    expect(await commit.verify(effect, applied)).toEqual({
      details: 'Gmail controlled MIME content verified',
      verified: true,
    });
    expect(transport.mutations).toBe(1);
  });

  it('refuses to delete a draft whose approved content changed after commit', async () => {
    const { commit, effect, transport } = fixture('create-draft-exact', 'drifted-draft');
    const applied = await commit.commit(effect, 'run:drifted-draft');
    const messageId = applied.resource.providerMessageId;
    const changed = buildDeterministicMime({
      ...input('create-draft-exact', 'drifted-draft'),
      textBody: 'The user edited this draft after PREVIEW committed it.',
    });
    transport.messages.set(messageId, {
      historyId: 'external-edit',
      id: messageId,
      labelIds: ['DRAFT'],
      raw: changed.rawBase64Url,
    });
    await expect(commit.compensate(effect, applied, 'run:drifted-draft:compensate'))
      .rejects.toBeInstanceOf(DefinitelyNotAppliedError);
    expect(transport.mutations).toBe(1);
  });

  it('keeps empty, duplicate, and mismatched ambiguous searches UNKNOWN without retrying', async () => {
    const { commit, effect, transport } = fixture('send-message-exact', 'uncertain-1');
    expect(await commit.reconcileCommit(effect, 'run:empty')).toMatchObject({ status: 'UNKNOWN' });
    const mime = buildDeterministicMime(input('send-message-exact', 'uncertain-1'));
    transport.messages.set('one', { historyId: '1', id: 'one', labelIds: ['SENT'], raw: mime.rawBase64Url });
    transport.messages.set('two', { historyId: '2', id: 'two', labelIds: ['SENT'], raw: mime.rawBase64Url });
    expect(await commit.reconcileCommit(effect, 'run:duplicate')).toMatchObject({ status: 'UNKNOWN' });
    transport.messages.delete('two');
    const different = buildDeterministicMime({ ...input('send-message-exact', 'uncertain-1'), textBody: 'different' });
    transport.messages.set('one', { historyId: '3', id: 'one', labelIds: ['SENT'], raw: different.rawBase64Url });
    expect(await commit.reconcileCommit(effect, 'run:mismatch')).toMatchObject({ status: 'UNKNOWN' });
    expect(transport.mutations).toBe(0);
  });

  it('rejects a From address that is not the authenticated primary Gmail identity before mutation', async () => {
    const { commit, effect, transport } = fixture('send-message-exact', 'identity-1');
    transport.identity = 'other@example.test';
    await expect(commit.commit(effect, 'run:identity')).rejects.toBeInstanceOf(DefinitelyNotAppliedError);
    expect(transport.mutations).toBe(0);
  });

  it('stages with causal dependencies and no provider mutation', () => {
    const { effect, transport } = fixture('send-message-exact', 'dependency-1');
    expect(effect.dependencies).toEqual(['calendar-move-1']);
    expect(effect.externalities).toEqual(['DELIVERS_EXTERNAL_MESSAGE']);
    expect(transport.mutations).toBe(0);
  });
});
