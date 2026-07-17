# Architecture

PREVIEW is a modular monolith with a separate worker. Domain, runtime, adapter contracts, persistence, OpenAI orchestration, and presentation are isolated packages.

## Control boundary

The agent plane receives read and stage-capable tools only. Approval and commit are authenticated human control-plane operations and are never model tools. Simulation adapters and commit adapters have separate interfaces and provider capabilities.

GPT may choose tools, coordinate a simulated session, and explain deterministic output. Deterministic code exclusively owns effect semantics, risk classification, sealing, approval validation, drift detection, commit, verification, reconciliation, compensation, and receipts.

## Dependency direction

The domain package has no provider or presentation dependencies. Runtime builds on domain. Adapter contracts depend on domain types. Provider adapters implement those contracts. Persistence is accessed through interfaces. Applications compose packages but do not move application concepts into the kernel.

Gate 1 adds a provider-neutral shadow revision session, capability-separated adapter contracts, deterministic content-bound approval, a synthetic Reference Calendar adapter, and a minimal worker-owned single-effect commit path.

The simulation adapter receives only a read port. Its staged writes exist in the runtime overlay and immutable effect graph. The commit adapter receives the separate mutation port and is composed only by the worker path. The reference adapter has no production dependency on runtime, approval, or worker packages; those layers compose it from above.

Before a new durable execution can mutate, the worker validates the signed approval and complete snapshot through stripped read-only adapter views. It journals authorization and intent under a fenced lease, uses graph-digest/effect-scoped idempotency keys, reconciles interrupted calls before retry, verifies provider results, and compensates eligible prior effects in reverse order after definite failure. Commit and compensation attempts are bounded, unknown irreversible outcomes stop for attention, and receipts enumerate known residual and unresolved state separately.

The persistence boundary supplies immutable run seeds, append-only journal events, leases with fencing tokens, replay invalidation, and terminal receipts. Gate 6 includes in-memory and file-backed reference stores; the file store uses atomic durable record replacement, recoverable lock ownership, and incomplete-journal-tail repair for process-reconstruction tests. Hosted durable persistence remains required before real-provider commit testing.

Gate 2 adds runtime-owned staged-resource provenance. A caller may choose which staged resource to use, but cannot supply effect dependency IDs or the final derived Mail body. The runtime resolves the resource only from its current overlay, clones its value and originating effect ID into the adapter context, and rejects any emitted dependency list that differs. Reference Mail deterministically renders the exact body from the selected staged field and declares external delivery as irreversible.

Graph-wide uniqueness, dependency references, duplicate edges, and acyclicity are validated again in the domain schema. Runtime staging requires dependencies to precede their consumers for atomic construction; the domain sealing boundary accepts any acyclic ordering but rejects malformed persisted or directly constructed graphs.
