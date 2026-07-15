import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  IllegalTransitionError,
  canTransition,
  transactionStatusSchema,
  transactionTransitions,
  transitionTransaction,
} from '../src/index.js';

describe('transaction state machine', () => {
  it('accepts every declared transition', () => {
    for (const [from, destinations] of Object.entries(transactionTransitions)) {
      for (const to of destinations) {
        expect(transitionTransaction(transactionStatusSchema.parse(from), to)).toBe(to);
      }
    }
  });

  it('rejects every undeclared transition', () => {
    const statuses = transactionStatusSchema.options;
    fc.assert(
      fc.property(fc.constantFrom(...statuses), fc.constantFrom(...statuses), (from, to) => {
        if (!canTransition(from, to)) {
          expect(() => transitionTransaction(from, to)).toThrow(IllegalTransitionError);
        }
      }),
    );
  });

  it('has no outgoing transitions from terminal states', () => {
    for (const terminal of [
      'ABORTED',
      'CONFLICTED',
      'COMMITTED_VERIFIED',
      'COMPENSATED',
      'COMPLETED_WITH_RESIDUALS',
      'REQUIRES_ATTENTION',
    ] as const) {
      expect(transactionTransitions[terminal]).toEqual([]);
    }
  });
});
