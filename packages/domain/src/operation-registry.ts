import { UnsupportedOperationError } from './errors.js';
import { identifierSchema } from './schemas.js';

export interface MutationDefinition<Input, Output> {
  readonly parseInput: (input: unknown) => Input;
  readonly simulate: (input: Input) => Output;
}

type AnyMutationDefinition = MutationDefinition<unknown, unknown>;

export class MutationRegistry {
  readonly #definitions = new Map<string, AnyMutationDefinition>();

  public register<Input, Output>(
    adapterId: string,
    operation: string,
    definition: MutationDefinition<Input, Output>,
  ): void {
    const key = this.#key(adapterId, operation);
    if (this.#definitions.has(key)) {
      throw new Error(`Mutation already registered: ${key}`);
    }
    this.#definitions.set(key, definition as AnyMutationDefinition);
  }

  public stage(adapterId: string, operation: string, input: unknown): unknown {
    const definition = this.#definitions.get(this.#key(adapterId, operation));
    if (definition === undefined) {
      throw new UnsupportedOperationError(adapterId, operation);
    }
    return definition.simulate(definition.parseInput(input));
  }

  #key(adapterId: string, operation: string): string {
    return `${identifierSchema.parse(adapterId)}:${identifierSchema.parse(operation)}`;
  }
}
