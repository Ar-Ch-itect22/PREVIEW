import type { SimulationRevision } from '@preview/domain';
import {
  InMemoryReferenceCalendarProvider,
  ReferenceCalendarSimulationAdapter,
  type CalendarEvent,
} from '@preview/reference-calendar';
import {
  InMemoryReferenceMailProvider,
  ReferenceMailSimulationAdapter,
  type MailMessage,
} from '@preview/reference-mail';
import { ShadowRevisionSession } from '@preview/runtime';

import { OfficialOpenAIResponsesClient } from './responses-client.js';
import { PreviewSimulationController } from './simulation-controller.js';
import { PREVIEW_MODEL, PreviewResponsesToolLoop } from './tool-loop.js';

const originalEvent: CalendarEvent = {
  end: '2026-07-20T10:30:00.000Z',
  id: 'event-1',
  start: '2026-07-20T10:00:00.000Z',
  title: 'Synthetic planning session',
  version: 'v1',
};

const existingMessage: MailMessage = {
  id: 'existing-message',
  recipients: ['archive@example.test'],
  state: 'DELIVERED',
  subject: 'Synthetic archive',
  textBody: 'Existing provider state.',
  version: 'v1',
};

const revision: SimulationRevision = {
  baseSnapshotDigest: null,
  baseSnapshotId: 'snapshot-live-gate-three',
  effectGraph: null,
  graphDigest: null,
  id: 'revision-live-gate-three',
  replayOfRevisionId: null,
  revisionNumber: 1,
  status: 'DRAFT',
  structuredConstraints: [],
  transactionId: 'transaction-live-gate-three',
};

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error('OPENAI_API_KEY is required in the local environment');
  }

  const calendarProvider = new InMemoryReferenceCalendarProvider([originalEvent]);
  const mailProvider = new InMemoryReferenceMailProvider([existingMessage]);
  const calendarBefore = calendarProvider.snapshotBytes();
  const mailBefore = mailProvider.snapshotBytes();
  const controller = new PreviewSimulationController({
    calendar: new ReferenceCalendarSimulationAdapter(calendarProvider.createReadPort()),
    mail: new ReferenceMailSimulationAdapter(mailProvider.createReadPort()),
    session: new ShadowRevisionSession(revision),
  });
  const result = await new PreviewResponsesToolLoop(
    new OfficialOpenAIResponsesClient(apiKey),
    controller,
  ).run(
    'Read event-1, preview moving it to 2026-07-27T10:00:00.000Z through 2026-07-27T10:30:00.000Z, reread the staged event, and preview the dependent attendee message as symbolic-message-1 to attendee@example.test.',
  );
  const calendarUnchanged = calendarProvider.snapshotBytes().equals(calendarBefore);
  const mailUnchanged = mailProvider.snapshotBytes().equals(mailBefore);
  if (!calendarUnchanged || !mailUnchanged || calendarProvider.mutationCount !== 0) {
    throw new Error('A provider changed during the live simulation');
  }

  process.stdout.write(`${JSON.stringify({
    calendarProviderUnchanged: calendarUnchanged,
    effectCount: result.revision.effectGraph?.effects.length ?? 0,
    gate: 3,
    graphDigest: result.revision.graphDigest,
    mailProviderUnchanged: mailUnchanged,
    model: PREVIEW_MODEL,
    providerMutationCount: calendarProvider.mutationCount,
    responseId: result.responseId,
    revisionStatus: result.revision.status,
    toolCalls: result.toolTrace.length,
  }, null, 2)}\n`);
}

await main();
