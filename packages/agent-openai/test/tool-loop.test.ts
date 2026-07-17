import { describe, expect, it } from 'vitest';

import {
  CALENDAR_READ_EVENT_TOOL,
  CALENDAR_STAGE_MOVE_TOOL,
  MAIL_READ_MESSAGE_TOOL,
  MAIL_STAGE_ATTENDEE_MESSAGE_TOOL,
  PREVIEW_MODEL,
  PREVIEW_SIMULATION_TOOLS,
  PreviewResponsesToolLoop,
  type PreviewModelResponse,
  type PreviewResponseRequest,
  type PreviewResponsesClient,
  UnknownAgentToolError,
} from '../src/index.js';
import { createFixture } from './fixtures.js';

class ScriptedResponsesClient implements PreviewResponsesClient {
  readonly requests: PreviewResponseRequest[] = [];
  readonly #responses: PreviewModelResponse[];

  public constructor(responses: readonly PreviewModelResponse[]) {
    this.#responses = [...responses];
  }

  public create(request: PreviewResponseRequest): Promise<PreviewModelResponse> {
    this.requests.push(structuredClone(request));
    const response = this.#responses.shift();
    if (response === undefined) throw new Error('Mock response script exhausted');
    return Promise.resolve(response);
  }
}

function callResponse(
  sequence: number,
  name: string,
  argumentsValue: unknown,
): PreviewModelResponse {
  return {
    functionCalls: [{
      arguments: JSON.stringify(argumentsValue),
      callId: `call-${String(sequence)}`,
      name,
    }],
    id: `response-${String(sequence)}`,
    outputText: '',
    status: 'completed',
  };
}

function successfulScript(): readonly PreviewModelResponse[] {
  return [
    callResponse(1, CALENDAR_READ_EVENT_TOOL, { eventId: 'event-1' }),
    callResponse(2, CALENDAR_STAGE_MOVE_TOOL, {
      end: '2026-07-27T10:30:00.000Z',
      eventId: 'event-1',
      start: '2026-07-27T10:00:00.000Z',
    }),
    callResponse(3, CALENDAR_READ_EVENT_TOOL, { eventId: 'event-1' }),
    callResponse(4, MAIL_READ_MESSAGE_TOOL, { messageId: 'symbolic-message-1' }),
    callResponse(5, MAIL_STAGE_ATTENDEE_MESSAGE_TOOL, {
      calendarEventId: 'event-1',
      messageId: 'symbolic-message-1',
      recipients: ['attendee@example.test'],
    }),
    {
      functionCalls: [],
      id: 'response-6',
      outputText: 'The dependent preview is ready for inspection.',
      status: 'completed',
    },
  ];
}

describe('mocked Responses API tool loop', () => {
  it('uses gpt-5.6, exposes only strict simulation tools, and seals provider-neutral effects', async () => {
    const fixture = createFixture('mock-loop');
    const calendarBefore = fixture.calendarProvider.snapshotBytes();
    const mailBefore = fixture.mailProvider.snapshotBytes();
    const client = new ScriptedResponsesClient(successfulScript());
    const result = await new PreviewResponsesToolLoop(client, fixture.controller).run(
      'Move event-1 one week later and preview an attendee message to attendee@example.test.',
    );

    expect(result.revision.status).toBe('SEALED');
    expect(result.revision.effectGraph?.effects[1]?.dependencies).toEqual([
      'effect:calendar-move:0001',
    ]);
    expect(result.toolTrace).toHaveLength(5);
    expect(client.requests).toHaveLength(6);
    for (const request of client.requests) {
      expect(request.model).toBe(PREVIEW_MODEL);
      expect(request.tools).toEqual(PREVIEW_SIMULATION_TOOLS);
      expect(request.tools.every((tool) => tool.strict === true)).toBe(true);
      expect(request.tools.every((tool) => tool.parameters?.additionalProperties === false)).toBe(true);
    }
    expect(PREVIEW_SIMULATION_TOOLS.map((tool) => tool.name)).toEqual([
      CALENDAR_READ_EVENT_TOOL,
      CALENDAR_STAGE_MOVE_TOOL,
      MAIL_READ_MESSAGE_TOOL,
      MAIL_STAGE_ATTENDEE_MESSAGE_TOOL,
    ]);
    expect(PREVIEW_SIMULATION_TOOLS.some((tool) => /commit|approve|deliver|provider_mutation/u.test(tool.name))).toBe(false);
    expect(client.requests.slice(1).map((request) => request.previousResponseId)).toEqual([
      'response-1',
      'response-2',
      'response-3',
      'response-4',
      'response-5',
    ]);
    expect(fixture.calendarProvider.snapshotBytes().equals(calendarBefore)).toBe(true);
    expect(fixture.mailProvider.snapshotBytes().equals(mailBefore)).toBe(true);
  });

  it('returns a strict validation failure to the model without staging the malformed call', async () => {
    const fixture = createFixture('retry');
    const script = [...successfulScript()];
    script.splice(1, 0, callResponse(99, CALENDAR_STAGE_MOVE_TOOL, {
      commit: true,
      end: '2026-07-27T10:30:00.000Z',
      eventId: 'event-1',
      start: '2026-07-27T10:00:00.000Z',
    }));
    const client = new ScriptedResponsesClient(script);
    const result = await new PreviewResponsesToolLoop(client, fixture.controller).run('Preview the move.');

    expect(result.revision.effectGraph?.effects).toHaveLength(2);
    expect(result.toolTrace[1]).toMatchObject({ outcome: 'REJECTED' });
    const retryInput = client.requests[2]?.input;
    expect(JSON.stringify(retryInput)).toContain('INVALID_TOOL_ARGUMENTS');
  });

  it('fails closed and aborts the revision when the model requests an unknown write', async () => {
    const fixture = createFixture('unknown-write');
    const calendarBefore = fixture.calendarProvider.snapshotBytes();
    const mailBefore = fixture.mailProvider.snapshotBytes();
    const client = new ScriptedResponsesClient([
      callResponse(1, CALENDAR_READ_EVENT_TOOL, { eventId: 'event-1' }),
      callResponse(2, CALENDAR_STAGE_MOVE_TOOL, {
        end: '2026-07-27T10:30:00.000Z',
        eventId: 'event-1',
        start: '2026-07-27T10:00:00.000Z',
      }),
      callResponse(3, 'commit_transaction', {}),
    ]);

    await expect(
      new PreviewResponsesToolLoop(client, fixture.controller).run('Commit this now.'),
    ).rejects.toBeInstanceOf(UnknownAgentToolError);
    expect(fixture.controller.status).toBe('ABORTED');
    expect(fixture.calendarProvider.snapshotBytes().equals(calendarBefore)).toBe(true);
    expect(fixture.mailProvider.snapshotBytes().equals(mailBefore)).toBe(true);
  });
});
