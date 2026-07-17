import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
import { describe, expect, it } from 'vitest';

import {
  OfficialOpenAIResponsesClient,
  PREVIEW_SIMULATION_TOOLS,
} from '../src/index.js';

describe('official OpenAI Responses SDK boundary', () => {
  it('maps PREVIEW turns to a non-parallel Responses request and normalizes function calls', async () => {
    const requests: ResponseCreateParamsNonStreaming[] = [];
    const createResponse = (request: ResponseCreateParamsNonStreaming): Promise<Response> => {
      requests.push(structuredClone(request));
      return Promise.resolve({
        id: 'response-sdk-mock',
        output: [{
          arguments: '{"eventId":"event-1"}',
          call_id: 'call-sdk-mock',
          name: 'calendar_read_event',
          type: 'function_call',
        }],
        output_text: '',
        status: 'completed',
      } as Response);
    };
    const client = new OfficialOpenAIResponsesClient('synthetic-test-key', createResponse);
    const response = await client.create({
      input: [{ callId: 'prior-call', output: '{"ok":true}' }],
      instructions: 'Synthetic instructions',
      model: 'gpt-5.6',
      previousResponseId: 'prior-response',
      tools: PREVIEW_SIMULATION_TOOLS,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      input: [{
        call_id: 'prior-call',
        output: '{"ok":true}',
        type: 'function_call_output',
      }],
      instructions: 'Synthetic instructions',
      model: 'gpt-5.6',
      parallel_tool_calls: false,
      previous_response_id: 'prior-response',
      store: true,
    });
    expect(requests[0]?.tools).toEqual(PREVIEW_SIMULATION_TOOLS);
    expect(response).toEqual({
      functionCalls: [{
        arguments: '{"eventId":"event-1"}',
        callId: 'call-sdk-mock',
        name: 'calendar_read_event',
      }],
      id: 'response-sdk-mock',
      outputText: '',
      status: 'completed',
    });
  });
});
