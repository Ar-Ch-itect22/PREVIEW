import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { MutationRegistry, UnsupportedOperationError } from '../src/index.js';

describe('mutation registry', () => {
  it('fails closed for unknown writes without invoking simulation', () => {
    const registry = new MutationRegistry();
    const simulate = vi.fn();
    registry.register('known-adapter', 'known-operation', {
      parseInput: (input) => z.object({ value: z.string() }).parse(input),
      simulate,
    });

    expect(() => registry.stage('known-adapter', 'unknown-operation', {})).toThrow(
      UnsupportedOperationError,
    );
    expect(simulate).not.toHaveBeenCalled();
  });

  it('validates input before simulating a registered write', () => {
    const registry = new MutationRegistry();
    const simulate = vi.fn((input: { value: string }) => ({ staged: input.value }));
    registry.register('adapter', 'update', {
      parseInput: (input) => z.object({ value: z.string() }).parse(input),
      simulate,
    });

    expect(() => registry.stage('adapter', 'update', { value: 42 })).toThrow(z.ZodError);
    expect(simulate).not.toHaveBeenCalled();
    expect(registry.stage('adapter', 'update', { value: 'next' })).toEqual({ staged: 'next' });
  });
});
