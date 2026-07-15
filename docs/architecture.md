# Architecture

PREVIEW is a modular monolith with a separate worker. Domain, runtime, adapter contracts, persistence, OpenAI orchestration, and presentation are isolated packages.

## Control boundary

The agent plane receives read and stage-capable tools only. Approval and commit are authenticated human control-plane operations and are never model tools. Simulation adapters and commit adapters have separate interfaces and provider capabilities.

GPT may choose tools, coordinate a simulated session, and explain deterministic output. Deterministic code exclusively owns effect semantics, risk classification, sealing, approval validation, drift detection, commit, verification, reconciliation, compensation, and receipts.

## Dependency direction

The domain package has no provider or presentation dependencies. Runtime builds on domain. Adapter contracts depend on domain types. Provider adapters implement those contracts. Persistence is accessed through interfaces. Applications compose packages but do not move application concepts into the kernel.

Gate 1 adds a provider-neutral shadow revision session, capability-separated adapter contracts, deterministic content-bound approval, a synthetic Reference Calendar adapter, and a minimal worker-owned single-effect commit path.

The simulation adapter receives only a read port. Its staged writes exist in the runtime overlay and immutable effect graph. The commit adapter receives the separate mutation port and is composed only by the worker path. The reference adapter has no production dependency on runtime, approval, or worker packages; those layers compose it from above.

Before any asynchronous commit work, the worker clones, validates, and deeply freezes the revision and approval. It reconciles the digest-and-effect-scoped idempotency key before revalidation, blocks relevant drift before mutation, commits, and remotely rereads for verification. This is the Gate 1 in-memory proof, not the durable Gate 6 saga.
