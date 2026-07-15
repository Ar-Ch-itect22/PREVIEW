# PREVIEW

PREVIEW is a horizontal transactional runtime for tool-using agents. It lets an agent stage work against shadow state, inspect the exact cross-system consequences, replay corrections, approve an immutable effect graph, and then commit and verify that graph.

The honest product claim is: **stage, inspect, replay, commit, verify, and recover what is recoverable.** PREVIEW does not claim universal rollback, cross-provider atomicity, exactly-once delivery, or universal connector support.

## Current status

Gates 0 and 1 are implemented. The provider-neutral shadow runtime and the synthetic Reference Calendar adapter prove one staged move, read-your-writes, exact deterministic effect inspection, byte-identical abort, content-bound approval, revalidation, one verified provider mutation, and idempotent repeated commit.

This is an in-memory kernel proof, not a real provider integration or durable recovery system. Gate 2 cross-adapter staging is next. No GPT loop or UI exists yet.

## Local setup

Requirements: Node.js 24 and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm check
```

Copy `.env.example` to `.env` only when a later gate needs local configuration. Gate 0 tests require no services, Docker, credentials, or network after installation.

## Architecture boundaries

- `packages/domain`: provider-neutral schemas, immutable effect IR, and state machines
- `packages/runtime`: provider-neutral observed state, overlay, and atomic staging
- `packages/adapter-sdk`: separate simulation and commit capability contracts
- `packages/approval`: deterministic graph canonicalization and content-bound approvals
- `packages/adapters/reference-calendar`: synthetic certified move-event proof
- `apps/gateway`: agent and human control planes (future gate)
- `apps/worker`: minimal approval-bound single-effect commit path; durable saga work is future
- `apps/customer-ops-demo`: customer-operations proof only; never kernel semantics

See [the transaction contract](docs/transaction-contract.md) and [architecture](docs/architecture.md).
