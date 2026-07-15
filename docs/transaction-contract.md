# Transaction Contract

## Invariants

1. No provider mutation occurs before content-bound human approval.
2. Supported mutations produce complete deterministic effects; unknown mutations fail closed.
3. Reads in a revision observe its staged writes.
4. Aborting simulation leaves provider state unchanged.
5. Approval binds an immutable revision graph digest, not a prompt.
6. Replay creates a new revision and invalidates the old approval path.
7. Models are absent from revalidation, commit, verification, and compensation.
8. Relevant drift blocks commit before the first mutation.
9. Irreversible ambiguous outcomes are reconciled and never blindly retried.
10. Terminal receipts disclose residual and unresolved external state.

## State machine

`CREATED → SIMULATING → REVIEW_READY → APPROVED → REVALIDATING → COMMITTING → VERIFYING → COMMITTED_VERIFIED`

Review may instead replay to `SIMULATING` or abort. Revalidation may end `CONFLICTED`. Commit or verification failures may enter compensation and finish as `COMPENSATED`, `COMPLETED_WITH_RESIDUALS`, or `REQUIRES_ATTENTION`.

Only enumerated transitions are legal. Terminal states have no outgoing transition.

## Effect boundary

An effect is immutable approved operation data: exact payload, dependencies, preconditions, declared externalities, deterministic risk/reversibility class, verification predicate, and presentation summary. Execution attempts are separate records and never mutate the effect.

Each adapter validates its operation-specific effect as one cross-field contract. For the Reference Calendar move, resource identity, observed version, before-state identity, exact commit payload, and verification predicate must agree or the operation fails before provider access.
