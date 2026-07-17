export class RecoverableToolCallError extends Error {
  public constructor(
    public readonly code: 'INVALID_TOOL_ARGUMENTS' | 'SIMULATION_REJECTED' | 'TOOL_PRECONDITION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'RecoverableToolCallError';
  }
}

export class UnknownAgentToolError extends Error {
  public constructor(public readonly toolName: string) {
    super(`Agent requested an unavailable tool: ${toolName}`);
    this.name = 'UnknownAgentToolError';
  }
}

export class AgentLoopInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AgentLoopInvariantError';
  }
}
