import {
  CALENDAR_READ_EVENT_TOOL,
  CALENDAR_STAGE_MOVE_TOOL,
  MAIL_READ_MESSAGE_TOOL,
  MAIL_STAGE_ATTENDEE_MESSAGE_TOOL,
  type PreviewModelResponse,
  type PreviewResponseRequest,
  type PreviewResponsesClient,
} from '@preview/agent-openai';
import { describe, expect, it } from 'vitest';

import { LIVE_SANDBOX_SAMPLE_INTENT, LiveSandboxRunner } from '../src/live-sandbox.js';

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

describe('Live GPT-5.6 Sandbox surface', () => {
  it('returns a sealed two-effect graph while keeping both providers unchanged', async () => {
    const client = new ScriptedResponsesClient([
      callResponse(1, CALENDAR_READ_EVENT_TOOL, { eventId: 'event-1' }),
      callResponse(2, CALENDAR_STAGE_MOVE_TOOL, {
        end: '2026-07-27T10:30:00.000Z',
        eventId: 'event-1',
        start: '2026-07-27T10:00:00.000Z',
      }),
      callResponse(3, CALENDAR_READ_EVENT_TOOL, { eventId: 'event-1' }),
      callResponse(4, MAIL_READ_MESSAGE_TOOL, { messageId: 'message-1' }),
      callResponse(5, MAIL_STAGE_ATTENDEE_MESSAGE_TOOL, {
        calendarEventId: 'event-1',
        messageId: 'message-1',
        recipients: ['attendee@example.test'],
      }),
      {
        functionCalls: [],
        id: 'response-6',
        outputText: 'The dependent preview is ready for human inspection.',
        status: 'completed',
      },
    ]);
    const result = await new LiveSandboxRunner(() => client).run(LIVE_SANDBOX_SAMPLE_INTENT);

    expect(result.model).toBe('gpt-5.6');
    expect(result.effectCount).toBe(2);
    expect(result.effects.map(({ system }) => system)).toEqual(['Calendar', 'Mail']);
    expect(result.toolTrace).toHaveLength(5);
    expect(result.providerMutationCount).toBe(0);
    expect(result.providerStateUnchanged).toBe(true);
    expect(client.requests.every((request) => (
      request.tools.every(({ name }) => !/approve|commit|deliver|mutation/u.test(name))
    ))).toBe(true);
  });
});
