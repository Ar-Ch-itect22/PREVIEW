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

import { PreviewSimulationController } from '../src/index.js';

export const originalEvent: CalendarEvent = {
  end: '2026-07-20T10:30:00.000Z',
  id: 'event-1',
  start: '2026-07-20T10:00:00.000Z',
  title: 'Synthetic planning session',
  version: 'v1',
};

export const existingMessage: MailMessage = {
  id: 'existing-message',
  recipients: ['archive@example.test'],
  state: 'DELIVERED',
  subject: 'Synthetic archive',
  textBody: 'Existing provider state.',
  version: 'v1',
};

export function draftRevision(id: string): SimulationRevision {
  return {
    baseSnapshotId: 'snapshot-1',
    effectGraph: null,
    graphDigest: null,
    id,
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'DRAFT',
    structuredConstraints: [],
    transactionId: `transaction-${id}`,
  };
}

export function createFixture(id: string): {
  readonly calendarProvider: InMemoryReferenceCalendarProvider;
  readonly controller: PreviewSimulationController;
  readonly mailProvider: InMemoryReferenceMailProvider;
} {
  const calendarProvider = new InMemoryReferenceCalendarProvider([originalEvent]);
  const mailProvider = new InMemoryReferenceMailProvider([existingMessage]);
  const controller = new PreviewSimulationController({
    calendar: new ReferenceCalendarSimulationAdapter(calendarProvider.createReadPort()),
    mail: new ReferenceMailSimulationAdapter(mailProvider.createReadPort()),
    session: new ShadowRevisionSession(draftRevision(id)),
  });
  return { calendarProvider, controller, mailProvider };
}
