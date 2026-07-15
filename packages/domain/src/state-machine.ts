import { IllegalTransitionError } from './errors.js';
import { transactionStatusSchema, type TransactionStatus } from './schemas.js';

const transitions = {
  ABORTED: [],
  APPROVED: ['REVALIDATING'],
  COMMITTED_VERIFIED: [],
  COMMITTING: ['VERIFYING', 'COMPENSATING', 'REQUIRES_ATTENTION'],
  COMPENSATED: [],
  COMPENSATING: ['COMPENSATED', 'COMPLETED_WITH_RESIDUALS', 'REQUIRES_ATTENTION'],
  COMPLETED_WITH_RESIDUALS: [],
  CONFLICTED: [],
  CREATED: ['SIMULATING', 'ABORTED'],
  REQUIRES_ATTENTION: [],
  REVALIDATING: ['CONFLICTED', 'COMMITTING'],
  REVIEW_READY: ['SIMULATING', 'ABORTED', 'APPROVED'],
  SIMULATING: ['REVIEW_READY', 'ABORTED'],
  VERIFYING: ['COMMITTED_VERIFIED', 'COMPENSATING', 'COMPLETED_WITH_RESIDUALS', 'REQUIRES_ATTENTION'],
} as const satisfies Record<TransactionStatus, readonly TransactionStatus[]>;

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return (transitions[from] as readonly TransactionStatus[]).includes(to);
}

export function transitionTransaction(from: TransactionStatus, to: TransactionStatus): TransactionStatus {
  transactionStatusSchema.parse(from);
  transactionStatusSchema.parse(to);
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
  return to;
}

export const transactionTransitions: Readonly<Record<TransactionStatus, readonly TransactionStatus[]>> = transitions;
