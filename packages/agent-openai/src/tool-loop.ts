import { computeEffectGraphDigest } from '@preview/approval';
import type { SimulationRevision } from '@preview/domain';

import { AgentLoopInvariantError, RecoverableToolCallError } from './errors.js';
import type { PreviewResponsesClient } from './responses-client.js';
import type { PreviewSimulationController } from './simulation-controller.js';
import { PREVIEW_SIMULATION_TOOLS } from './tool-schemas.js';

export const PREVIEW_MODEL = 'gpt-5.6' as const;

export const PREVIEW_AGENT_INSTRUCTIONS = `You orchestrate one PREVIEW shadow simulation using only the supplied tools.
Read the Calendar event before staging its move. After staging, reread that same Calendar event so the read observes the staged time. Then stage the attendee message that depends on that staged event. PREVIEW deterministically derives effect semantics and exact message content.
These tools only read or stage simulated state. No approval, commit, provider mutation, or delivery capability is available. Never claim that provider state changed. Do not finish until every required tool call reports success.`;

export interface ToolTraceEntry {
  readonly callId: string;
  readonly name: string;
  readonly outcome: 'REJECTED' | 'SUCCEEDED';
}

export interface AgentSimulationResult {
  readonly modelOutput: string;
  readonly responseId: string;
  readonly revision: Readonly<SimulationRevision>;
  readonly toolTrace: readonly ToolTraceEntry[];
}

interface ToolLoopOptions {
  readonly maxTurns?: number;
}

export class PreviewResponsesToolLoop {
  readonly #client: PreviewResponsesClient;
  readonly #controller: PreviewSimulationController;
  readonly #maxTurns: number;

  public constructor(
    client: PreviewResponsesClient,
    controller: PreviewSimulationController,
    options: ToolLoopOptions = {},
  ) {
    this.#client = client;
    this.#controller = controller;
    this.#maxTurns = options.maxTurns ?? 12;
    if (!Number.isInteger(this.#maxTurns) || this.#maxTurns < 1) {
      throw new AgentLoopInvariantError('maxTurns must be a positive integer');
    }
  }

  public async run(intent: string): Promise<AgentSimulationResult> {
    if (intent.trim().length === 0) throw new AgentLoopInvariantError('Agent intent is required');
    const toolTrace: ToolTraceEntry[] = [];
    let input: string | readonly { callId: string; output: string }[] = intent;
    let previousResponseId: string | undefined;

    try {
      for (let turn = 1; turn <= this.#maxTurns; turn += 1) {
        const response = await this.#client.create({
          input,
          instructions: PREVIEW_AGENT_INSTRUCTIONS,
          model: PREVIEW_MODEL,
          ...(previousResponseId === undefined ? {} : { previousResponseId }),
          tools: PREVIEW_SIMULATION_TOOLS,
        });
        if (response.status !== 'completed') {
          throw new AgentLoopInvariantError(
            `OpenAI response ended with status ${String(response.status)}`,
          );
        }
        if (response.functionCalls.length > 1) {
          throw new AgentLoopInvariantError('Parallel function calls are not accepted');
        }
        if (response.functionCalls.length === 0) {
          const revision = this.#controller.seal(computeEffectGraphDigest);
          return {
            modelOutput: response.outputText,
            responseId: response.id,
            revision,
            toolTrace: Object.freeze([...toolTrace]),
          };
        }

        const call = response.functionCalls[0];
        if (call === undefined) throw new AgentLoopInvariantError('Missing function call');
        let output: string;
        try {
          const result = await this.#controller.dispatch(call.name, call.arguments);
          output = JSON.stringify({ ok: true, result });
          toolTrace.push({ callId: call.callId, name: call.name, outcome: 'SUCCEEDED' });
        } catch (error) {
          if (!(error instanceof RecoverableToolCallError)) throw error;
          output = JSON.stringify({
            error: { code: error.code, message: error.message },
            ok: false,
          });
          toolTrace.push({ callId: call.callId, name: call.name, outcome: 'REJECTED' });
        }
        input = [{ callId: call.callId, output }];
        previousResponseId = response.id;
      }
      throw new AgentLoopInvariantError(`Tool loop exceeded ${String(this.#maxTurns)} turns`);
    } catch (error) {
      this.#controller.abort();
      throw error;
    }
  }
}
