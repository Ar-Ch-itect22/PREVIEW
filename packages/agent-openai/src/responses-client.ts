import OpenAI from 'openai';
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
} from 'openai/resources/responses/responses';

export interface PreviewFunctionCall {
  readonly arguments: string;
  readonly callId: string;
  readonly name: string;
}

export interface PreviewFunctionOutput {
  readonly callId: string;
  readonly output: string;
}

export interface PreviewResponseRequest {
  readonly input: string | readonly PreviewFunctionOutput[];
  readonly instructions: string;
  readonly model: 'gpt-5.6';
  readonly previousResponseId?: string;
  readonly tools: readonly FunctionTool[];
}

export interface PreviewModelResponse {
  readonly functionCalls: readonly PreviewFunctionCall[];
  readonly id: string;
  readonly outputText: string;
  readonly status: Response['status'];
}

export interface PreviewResponsesClient {
  create(request: PreviewResponseRequest): Promise<PreviewModelResponse>;
}

type ResponseCreate = (parameters: ResponseCreateParamsNonStreaming) => Promise<Response>;

export class OfficialOpenAIResponsesClient implements PreviewResponsesClient {
  readonly #createResponse: ResponseCreate;

  public constructor(apiKey: string, createResponse?: ResponseCreate) {
    if (apiKey.trim().length === 0) throw new Error('OPENAI_API_KEY is required');
    if (createResponse === undefined) {
      const client = new OpenAI({ apiKey });
      this.#createResponse = (parameters) => client.responses.create(parameters);
    } else {
      this.#createResponse = createResponse;
    }
  }

  public async create(request: PreviewResponseRequest): Promise<PreviewModelResponse> {
    const input: string | ResponseInput = typeof request.input === 'string'
      ? request.input
      : request.input.map((item) => ({
          call_id: item.callId,
          output: item.output,
          type: 'function_call_output' as const,
        }));
    const parameters: ResponseCreateParamsNonStreaming = {
      input,
      instructions: request.instructions,
      model: request.model,
      parallel_tool_calls: false,
      store: true,
      tools: [...request.tools],
      ...(request.previousResponseId === undefined
        ? {}
        : { previous_response_id: request.previousResponseId }),
    };
    const response = await this.#createResponse(parameters);
    return {
      functionCalls: response.output
        .filter((item): item is ResponseFunctionToolCall => item.type === 'function_call')
        .map((item) => ({
          arguments: item.arguments,
          callId: item.call_id,
          name: item.name,
        })),
      id: response.id,
      outputText: response.output_text,
      status: response.status,
    };
  }
}
