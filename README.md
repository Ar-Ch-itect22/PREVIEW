# PREVIEW

PREVIEW is a horizontal transactional runtime for tool-using agents. It lets an agent stage work against shadow state, inspect the exact cross-system consequences, replay corrections, approve an immutable effect graph, and then commit and verify that graph.

The honest product claim is: **stage, inspect, replay, commit, verify, and recover what is recoverable.** PREVIEW does not claim universal rollback, cross-provider atomicity, exactly-once delivery, or universal connector support.

## Current status

Gates 0 through 8 are implemented. PREVIEW has a provider-neutral shadow runtime,
strict GPT-5.6 orchestration with no commit tools, structured replay, content-bound
approval, complete-read-set drift detection, durable journaled execution,
verification, reconciliation, compensation, narrow certified Google Calendar and
Gmail adapters, and a credential-free Judge Mode over isolated synthetic state.

Judge Mode stages six Calendar, Mail, and CRM effects with zero provider writes,
surfaces a high-value Acme consequence, replays a structured protection that
removes the complete causal group, binds approval to the new immutable graph,
then commits and renders the verified receipt.

## Local setup

Requirements: Node.js 24 and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev:judge
```

Judge Mode is available locally at `http://127.0.0.1:4173` and requires no API
key, OAuth credential, Docker service, or external provider.

Copy `.env.example` to `.env` only when a later gate needs local configuration. Gate 0 tests require no services, Docker, credentials, or network after installation.

## Architecture boundaries

- `packages/domain`: provider-neutral schemas, immutable effect IR, and state machines
- `packages/runtime`: provider-neutral observed state, overlay, and atomic staging
- `packages/adapter-sdk`: separate simulation and commit capability contracts
- `packages/approval`: deterministic graph canonicalization and content-bound approvals
- `packages/adapters/reference-calendar`: synthetic certified move-event proof
- `packages/adapters/reference-mail`: simulation-only irreversible send-message staging proof
- `apps/gateway`: reserved agent and human control-plane boundary
- `apps/worker`: approval-bound durable saga execution, reconciliation, verification, compensation, and receipts
- `apps/console`: credential-free product review, replay, approval, receipt, and Judge Mode
- `apps/customer-ops-demo`: customer-operations proof only; never kernel semantics

See [the transaction contract](docs/transaction-contract.md) and [architecture](docs/architecture.md).
