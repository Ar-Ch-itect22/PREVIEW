import { computeEffectGraphDigest } from '@preview/approval';
import { describe, expect, it } from 'vitest';

import {
  CALENDAR_READ_EVENT_TOOL,
  CALENDAR_STAGE_MOVE_TOOL,
  MAIL_STAGE_ATTENDEE_MESSAGE_TOOL,
  UnknownAgentToolError,
} from '../src/index.js';
import { createFixture } from './fixtures.js';

const readArguments = JSON.stringify({ eventId: 'event-1' });
const moveArguments = JSON.stringify({
  end: '2026-07-27T10:30:00.000Z',
  eventId: 'event-1',
  start: '2026-07-27T10:00:00.000Z',
});
const mailArguments = JSON.stringify({
  calendarEventId: 'event-1',
  messageId: 'symbolic-message-1',
  recipients: ['attendee@example.test'],
});

describe('deterministic PREVIEW simulation controller', () => {
  it('derives exact dependent effects outside GPT and leaves both providers byte-identical', async () => {
    const fixture = createFixture('deterministic');
    const calendarBefore = fixture.calendarProvider.snapshotBytes();
    const mailBefore = fixture.mailProvider.snapshotBytes();

    await fixture.controller.dispatch(CALENDAR_READ_EVENT_TOOL, readArguments);
    await fixture.controller.dispatch(CALENDAR_STAGE_MOVE_TOOL, moveArguments);
    const reread = await fixture.controller.dispatch(CALENDAR_READ_EVENT_TOOL, readArguments);
    expect(reread).toMatchObject({
      event: { start: '2026-07-27T10:00:00.000Z' },
      source: 'STAGED_REVISION',
    });
    await fixture.controller.dispatch(MAIL_STAGE_ATTENDEE_MESSAGE_TOOL, mailArguments);
    const revision = fixture.controller.seal(computeEffectGraphDigest);

    expect(revision.effectGraph?.effects).toHaveLength(2);
    expect(revision.effectGraph?.effects[1]).toMatchObject({
      adapterId: 'reference-mail',
      dependencies: ['effect:calendar-move:0001'],
      externalities: ['DELIVERS_EXTERNAL_MESSAGE'],
      payload: {
        messageId: 'symbolic-message-1',
        recipients: ['attendee@example.test'],
        subject: 'Synthetic planning session moved',
        textBody: 'The Synthetic planning session has moved to 2026-07-27T10:00:00.000Z.',
      },
      risk: 'IRREVERSIBLE',
    });
    expect(fixture.calendarProvider.snapshotBytes().equals(calendarBefore)).toBe(true);
    expect(fixture.mailProvider.snapshotBytes().equals(mailBefore)).toBe(true);
    expect(fixture.calendarProvider.mutationCount).toBe(0);
  });

  it('requires the staged Calendar reread before accepting dependent Mail simulation', async () => {
    const fixture = createFixture('reread-required');
    await fixture.controller.dispatch(CALENDAR_READ_EVENT_TOOL, readArguments);
    await fixture.controller.dispatch(CALENDAR_STAGE_MOVE_TOOL, moveArguments);

    await expect(
      fixture.controller.dispatch(MAIL_STAGE_ATTENDEE_MESSAGE_TOOL, mailArguments),
    ).rejects.toMatchObject({
      code: 'TOOL_PRECONDITION_FAILED',
    });

    await fixture.controller.dispatch(CALENDAR_READ_EVENT_TOOL, readArguments);
    await expect(
      fixture.controller.dispatch(MAIL_STAGE_ATTENDEE_MESSAGE_TOOL, mailArguments),
    ).resolves.toBeDefined();
  });

  it('rejects extra arguments and every unknown tool before staging', async () => {
    const fixture = createFixture('strict-tools');
    await expect(fixture.controller.dispatch(
      CALENDAR_READ_EVENT_TOOL,
      JSON.stringify({ commit: true, eventId: 'event-1' }),
    )).rejects.toMatchObject({
      code: 'INVALID_TOOL_ARGUMENTS',
    });
    await expect(
      fixture.controller.dispatch('commit_transaction', '{}'),
    ).rejects.toBeInstanceOf(UnknownAgentToolError);
    await expect(
      fixture.controller.dispatch('commit_transaction', '{not-json'),
    ).rejects.toBeInstanceOf(UnknownAgentToolError);
  });
});
