import { randomUUID } from 'node:crypto';

import {
  OfficialOpenAIResponsesClient,
  PREVIEW_MODEL,
  PreviewResponsesToolLoop,
  PreviewSimulationController,
  type PreviewResponsesClient,
} from '@preview/agent-openai';
import type { Effect, SimulationRevision } from '@preview/domain';
import {
  InMemoryReferenceCalendarProvider,
  ReferenceCalendarSimulationAdapter,
  moveEffectSchema,
  type CalendarEvent,
} from '@preview/reference-calendar';
import {
  InMemoryReferenceMailProvider,
  ReferenceMailSimulationAdapter,
  sendMessageEffectSchema,
} from '@preview/reference-mail';
import { ShadowRevisionSession } from '@preview/runtime';

const SANDBOX_EVENT: CalendarEvent = Object.freeze({
  end: '2026-07-20T10:30:00.000Z',
  id: 'event-1',
  start: '2026-07-20T10:00:00.000Z',
  title: 'Synthetic planning session',
  version: 'v1',
});

export const LIVE_SANDBOX_SAMPLE_INTENT = 'Move event-1 to Jul 27, 10:00 AM–10:30 AM UTC and stage an attendee message as message-1 to attendee@example.test.';

export interface LiveSandboxEffectView {
  readonly after: Readonly<Record<string, unknown>>;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly dependencies: readonly string[];
  readonly externalities: readonly string[];
  readonly id: string;
  readonly operation: string;
  readonly risk: Effect['risk'];
  readonly summary: string;
  readonly system: 'Calendar' | 'Mail';
}

export interface LiveSandboxRunView {
  readonly effectCount: number;
  readonly effects: readonly LiveSandboxEffectView[];
  readonly graphDigest: string;
  readonly instruction: string;
  readonly model: typeof PREVIEW_MODEL;
  readonly modelOutput: string;
  readonly providerMutationCount: 0;
  readonly providerStateUnchanged: true;
  readonly responseId: string;
  readonly revisionId: string;
  readonly toolTrace: readonly Readonly<{
    callId: string;
    name: string;
    outcome: 'REJECTED' | 'SUCCEEDED';
  }>[];
}

type ClientFactory = () => PreviewResponsesClient;

export class LiveSandboxUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LiveSandboxUnavailableError';
  }
}

export class LiveSandboxRunner {
  readonly #clientFactory: ClientFactory;

  public constructor(clientFactory: ClientFactory = defaultClientFactory) {
    this.#clientFactory = clientFactory;
  }

  public get available(): boolean {
    return process.env.OPENAI_API_KEY?.trim().length !== 0
      && process.env.OPENAI_API_KEY !== undefined;
  }

  public async run(rawIntent: string): Promise<LiveSandboxRunView> {
    const instruction = rawIntent.trim();
    if (instruction.length < 12 || instruction.length > 1_200) {
      throw new LiveSandboxUnavailableError('Instruction must be between 12 and 1,200 characters');
    }
    const calendarProvider = new InMemoryReferenceCalendarProvider([SANDBOX_EVENT]);
    const mailProvider = new InMemoryReferenceMailProvider([]);
    const calendarBefore = calendarProvider.snapshotBytes();
    const mailBefore = mailProvider.snapshotBytes();
    const token = randomUUID();
    const controller = new PreviewSimulationController({
      calendar: new ReferenceCalendarSimulationAdapter(calendarProvider.createReadPort()),
      mail: new ReferenceMailSimulationAdapter(mailProvider.createReadPort()),
      session: new ShadowRevisionSession(createDraft(token)),
    });
    const result = await new PreviewResponsesToolLoop(this.#clientFactory(), controller).run(instruction);
    const unchanged = calendarProvider.snapshotBytes().equals(calendarBefore)
      && mailProvider.snapshotBytes().equals(mailBefore)
      && calendarProvider.mutationCount === 0
      && mailProvider.mutationCount === 0;
    if (!unchanged) throw new Error('Live Sandbox provider state changed during staging');
    const effects = result.revision.effectGraph?.effects ?? [];
    if (result.revision.graphDigest === null) throw new Error('Live Sandbox revision is unsealed');
    return Object.freeze({
      effectCount: effects.length,
      effects: Object.freeze(effects.map(toLiveEffectView)),
      graphDigest: result.revision.graphDigest,
      instruction,
      model: PREVIEW_MODEL,
      modelOutput: result.modelOutput,
      providerMutationCount: 0,
      providerStateUnchanged: true,
      responseId: result.responseId,
      revisionId: result.revision.id,
      toolTrace: Object.freeze(result.toolTrace.map((entry) => Object.freeze({ ...entry }))),
    });
  }
}

function defaultClientFactory(): PreviewResponsesClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new LiveSandboxUnavailableError('Add OPENAI_API_KEY to the server environment to run Live Sandbox');
  }
  return new OfficialOpenAIResponsesClient(apiKey);
}

function createDraft(token: string): SimulationRevision {
  return {
    baseSnapshotDigest: null,
    baseSnapshotId: `sandbox-snapshot-${token}`,
    effectGraph: null,
    graphDigest: null,
    id: `sandbox-revision-${token}`,
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'DRAFT',
    structuredConstraints: [],
    transactionId: `sandbox-transaction-${token}`,
  };
}

function toLiveEffectView(effect: Effect): LiveSandboxEffectView {
  if (effect.adapterId === 'reference-calendar') {
    const parsed = moveEffectSchema.parse(effect);
    return Object.freeze({
      after: Object.freeze({ end: parsed.payload.end, start: parsed.payload.start }),
      before: Object.freeze({
        end: parsed.preconditions[0].before.end,
        start: parsed.preconditions[0].before.start,
      }),
      dependencies: parsed.dependencies,
      externalities: parsed.externalities,
      id: parsed.id,
      operation: parsed.operation,
      risk: parsed.risk,
      summary: parsed.presentation.summary,
      system: 'Calendar',
    });
  }
  const parsed = sendMessageEffectSchema.parse(effect);
  return Object.freeze({
    after: Object.freeze({
      recipients: parsed.payload.recipients,
      subject: parsed.payload.subject,
      textBody: parsed.payload.textBody,
    }),
    before: null,
    dependencies: parsed.dependencies,
    externalities: parsed.externalities,
    id: parsed.id,
    operation: parsed.operation,
    risk: parsed.risk,
    summary: parsed.presentation.summary,
    system: 'Mail',
  });
}
