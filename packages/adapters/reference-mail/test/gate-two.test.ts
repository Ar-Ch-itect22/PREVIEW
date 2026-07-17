import { describe, expect, it } from 'vitest';

import { computeEffectGraphDigest } from '@preview/approval';
import type { Effect, SimulationRevision } from '@preview/domain';
import {
  InMemoryReferenceCalendarProvider,
  ReferenceCalendarSimulationAdapter,
  type CalendarEvent,
} from '@preview/reference-calendar';
import { ShadowRevisionSession } from '@preview/runtime';

import {
  InMemoryReferenceMailProvider,
  ReferenceMailSimulationAdapter,
  type MailMessage,
} from '../src/index.js';

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

const calendarResourceKey = 'reference-calendar:event:event-1';
const mailResourceKey = 'reference-mail:message:symbolic-message-1';
const calendarObservation = {
  adapterId: 'reference-calendar',
  observedAt: '2026-07-15T00:00:00.000Z',
  version: (event: CalendarEvent) => event.version,
} as const;
const mailObservation = {
  adapterId: 'reference-mail',
  observedAt: '2026-07-15T00:00:00.000Z',
  version: (message: MailMessage) => message.version,
} as const;

function revision(id: string): SimulationRevision {
  return {
    baseSnapshotDigest: null,
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

async function stageCrossAdapterFlow(input: {
  calendar: InMemoryReferenceCalendarProvider;
  mail: InMemoryReferenceMailProvider;
  revisionId: string;
}): Promise<{
  mail: ReferenceMailSimulationAdapter;
  session: ShadowRevisionSession;
}> {
  const calendar = new ReferenceCalendarSimulationAdapter(input.calendar.createReadPort());
  const mail = new ReferenceMailSimulationAdapter(input.mail.createReadPort());
  const session = new ShadowRevisionSession(revision(input.revisionId));

  await session.stage(
    calendarResourceKey,
    () => calendar.read(calendarResourceKey),
    { effectId: 'effect-calendar-move', observation: calendarObservation },
    (current, context) => calendar.stage(current, {
      end: '2026-07-27T10:30:00.000Z',
      eventId: 'event-1',
      start: '2026-07-27T10:00:00.000Z',
    }, context),
  );

  const movedEvent = await session.read(
    calendarResourceKey,
    () => calendar.read(calendarResourceKey),
    calendarObservation,
  );
  if (movedEvent === undefined) {
    throw new Error('Expected staged Calendar event');
  }
  if (movedEvent.start !== '2026-07-27T10:00:00.000Z') {
    throw new Error('Calendar read did not observe the staged move');
  }
  await session.stage(
    mailResourceKey,
    () => mail.read(mailResourceKey),
    {
      dependencyResourceKeys: [calendarResourceKey],
      effectId: 'effect-attendee-mail',
      observation: mailObservation,
    },
    (current, context) => mail.stage(current, {
      messageId: 'symbolic-message-1',
      recipients: ['attendee@example.test'],
      subject: 'Synthetic planning session moved',
      textBody: {
        field: 'start',
        prefix: 'The synthetic planning session has moved to ',
        resourceKey: calendarResourceKey,
        suffix: '.',
      },
    }, context),
  );

  return { mail, session };
}

function expectedMailEffect(): Effect {
  const payload = {
    messageId: 'symbolic-message-1',
    recipients: ['attendee@example.test'],
    subject: 'Synthetic planning session moved',
    textBody: 'The synthetic planning session has moved to 2026-07-27T10:00:00.000Z.',
  };
  return {
    adapterId: 'reference-mail',
    dependencies: ['effect-calendar-move'],
    externalities: ['DELIVERS_EXTERNAL_MESSAGE'],
    id: 'effect-attendee-mail',
    operation: 'send-message',
    payload,
    preconditions: [{ kind: 'MESSAGE_ID_ABSENT', messageId: 'symbolic-message-1' }],
    presentation: {
      summary: 'Send symbolic-message-1 to attendee@example.test',
    },
    resourceKey: mailResourceKey,
    risk: 'IRREVERSIBLE',
    verification: {
      expected: payload,
      kind: 'MAIL_MESSAGE_EXACTLY_RECONCILED',
    },
  };
}

describe('Gate 2 cross-adapter shadow execution', () => {
  it('uses staged Calendar time in exact Mail content and seals the causal dependency', async () => {
    const calendar = new InMemoryReferenceCalendarProvider([originalEvent]);
    const mailProvider = new InMemoryReferenceMailProvider([existingMessage]);
    const calendarBefore = calendar.snapshotBytes();
    const mailBefore = mailProvider.snapshotBytes();
    const { mail, session } = await stageCrossAdapterFlow({
      calendar,
      mail: mailProvider,
      revisionId: 'sealed',
    });

    expect(await session.read(
      mailResourceKey,
      () => mail.read(mailResourceKey),
      mailObservation,
    )).toEqual({
      id: 'symbolic-message-1',
      recipients: ['attendee@example.test'],
      state: 'STAGED',
      subject: 'Synthetic planning session moved',
      textBody: 'The synthetic planning session has moved to 2026-07-27T10:00:00.000Z.',
      version: null,
    });
    const draftGraph = session.inspectEffectGraph();
    expect(draftGraph.effects).toHaveLength(2);
    expect(draftGraph.effects[1]).toEqual(expectedMailEffect());
    const sealed = session.seal(computeEffectGraphDigest);

    expect(sealed.effectGraph?.effects[1]?.dependencies).toEqual(['effect-calendar-move']);
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.effectGraph?.effects)).toBe(true);
    expect(calendar.snapshotBytes().equals(calendarBefore)).toBe(true);
    expect(mailProvider.snapshotBytes().equals(mailBefore)).toBe(true);
  });

  it('aborts the cross-adapter overlay without changing either base provider byte', async () => {
    const calendar = new InMemoryReferenceCalendarProvider([originalEvent]);
    const mailProvider = new InMemoryReferenceMailProvider([existingMessage]);
    const calendarBefore = calendar.snapshotBytes();
    const mailBefore = mailProvider.snapshotBytes();
    const { session } = await stageCrossAdapterFlow({
      calendar,
      mail: mailProvider,
      revisionId: 'abort',
    });

    session.abort();

    expect(calendar.snapshotBytes().equals(calendarBefore)).toBe(true);
    expect(mailProvider.snapshotBytes().equals(mailBefore)).toBe(true);
  });

  it('cannot claim Calendar-derived Mail content without runtime-owned provenance', async () => {
    const calendarProvider = new InMemoryReferenceCalendarProvider([originalEvent]);
    const mailProvider = new InMemoryReferenceMailProvider([existingMessage]);
    const calendar = new ReferenceCalendarSimulationAdapter(calendarProvider.createReadPort());
    const mail = new ReferenceMailSimulationAdapter(mailProvider.createReadPort());
    const session = new ShadowRevisionSession(revision('missing-provenance'));
    await session.stage(
      calendarResourceKey,
      () => calendar.read(calendarResourceKey),
      { effectId: 'effect-calendar-move', observation: calendarObservation },
      (current, context) => calendar.stage(current, {
        end: '2026-07-27T10:30:00.000Z',
        eventId: 'event-1',
        start: '2026-07-27T10:00:00.000Z',
      }, context),
    );

    await expect(session.stage(
      mailResourceKey,
      () => mail.read(mailResourceKey),
      { effectId: 'effect-attendee-mail', observation: mailObservation },
      (current, context) => mail.stage(current, {
        messageId: 'symbolic-message-1',
        recipients: ['attendee@example.test'],
        subject: 'Synthetic planning session moved',
        textBody: {
          field: 'start',
          prefix: 'The synthetic planning session has moved to ',
          resourceKey: calendarResourceKey,
          suffix: '.',
        },
      }, context),
    )).rejects.toThrow('runtime-owned staged dependency');

    expect(session.inspectEffectGraph().effects.map((effect) => effect.id)).toEqual([
      'effect-calendar-move',
    ]);
    expect(calendarProvider.mutationCount).toBe(0);
  });
});
