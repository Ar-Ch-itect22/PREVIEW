# Judging Map

| Claim | Verified evidence |
| --- | --- |
| Unknown mutations fail closed | Domain invariant test |
| Illegal transaction transitions fail | Exhaustive/property state-machine tests |
| Sealed revisions are immutable | Revision invariant tests |
| No provider writes before approval | Gate 1 invalid-approval and abort tests |
| Reads observe staged writes | Gate 1 Reference Calendar integration test |
| Repeated approved commit does not duplicate | Gate 1 sequential and concurrent idempotency tests |
| Relevant drift blocks before mutation | Gate 1 Reference Calendar drift test |
| Mail content uses the staged Calendar value | Gate 2 cross-adapter integration test |
| Causal edge is runtime-owned, not caller-authored | Gate 2 missing-provenance adversarial test |
| Abort changes neither synthetic provider | Gate 2 byte-snapshot integration test |
| Malformed causal graphs fail closed | Domain graph and direct-sealing tests |
| Replay changes the exact graph | Gate 4 digest and causal-removal tests |
| Approved content cannot drift or be tampered | Gate 5 approval tests |
| Recovery reports residual state honestly | Gate 6 fault-injection receipts |
| Process death never blindly duplicates an irreversible action | Gate 6 happy/failure crash matrices |
| Real Calendar and Gmail operations use the same durable saga | Gate 7 mocked integration suite and credential-backed certification receipt |
| Real Google execution was content-bound and fully verified | `COMMITTED_VERIFIED`: Calendar move, Gmail draft, Gmail send; one attempt each; zero residuals/unresolved |
| GPT cannot approve, commit, or mutate a provider | Four-tool strict Responses API registry and Live Sandbox controller tests |
| A real GPT-5.6 session creates the dependent graph without writes | Public Live Sandbox: 4 strict calls, 2 sealed Calendar-to-Mail effects, 0 provider writes |
| A judge can inspect and commit without credentials | Public incognito Guided Judge Mode and browser-level Playwright verification |
| Direct Revision 1 approval remains distinct from replay | Console regression test and 6/6 verified public receipt |
| Repeated demo behavior is stable | 10/10 consecutive guided submission-audit runs |
| Repository is reproducible and safe to inspect | Fresh-clone frozen install, 17 builds, 91 tests, secret scan, and permissive-license audit |

The public Guided Judge Mode uses synthetic providers. Real Google certification
is separate evidence and is never represented as an active public write path.
