# Judging Map

| Claim | Planned evidence |
| --- | --- |
| Unknown mutations fail closed | Domain invariant test |
| Illegal transaction transitions fail | Exhaustive/property state-machine tests |
| Sealed revisions are immutable | Revision invariant tests |
| No provider writes before approval | Gate 1 invalid-approval and abort tests |
| Reads observe staged writes | Gate 1 Reference Calendar integration test |
| Repeated approved commit does not duplicate | Gate 1 sequential and concurrent idempotency tests |
| Relevant drift blocks before mutation | Gate 1 Reference Calendar drift test |
| Replay changes the exact graph | Gate 4 digest and causal-removal tests |
| Approved content cannot drift or be tampered | Gate 5 approval tests |
| Recovery reports residual state honestly | Gate 6 fault-injection receipts |

Only the first three rows are in Gate 0 scope.
