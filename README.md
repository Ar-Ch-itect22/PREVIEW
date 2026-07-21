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

## From demo to platform

Customer operations is the reference package, not the product boundary. The
larger opportunity is a horizontal transaction layer between autonomous agents
and consequential tools: agents propose work, while PREVIEW owns the boundary
where that work is staged, inspected, approved, committed, and verified.

The platform path is an SDK or MCP-compatible gateway that agent frameworks can
route write-capable tools through, backed by an ecosystem of operation-specific
certified adapters. Those adapters can extend the same contract to
communications, files, finance, infrastructure, and business systems without
moving provider semantics into the model. Above the runtime, teams could add
risk policies, approval routing, reusable constraints, replay environments, and
durable receipts for governance and incident recovery. The current three-system
proof is deliberately narrow; the architecture is designed for this broader
transaction boundary without claiming that connector surface today.

## Local setup

Requirements: Node.js 24 and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev:judge
```

Judge Mode is available locally at `http://127.0.0.1:4173` and requires no API
key, OAuth credential, Docker service, or external provider.

The public no-login deployment is available at
`https://preview-transaction-runtime.onrender.com`.

## Judge path

1. Open the public deployment; no login or credential is required.
2. Run the deterministic shadow simulation. Six exact Calendar, Mail, and CRM
   effects appear while the provider-write counter remains zero.
3. Protect the Acme renewal. PREVIEW creates Revision 2 from clean shadow state,
   invalidates the prior approval path, and removes the complete three-effect
   Acme branch.
4. Bind approval to Revision 2, then commit. The worker revalidates before its
   first mutation and returns a 3/3 verified synthetic receipt.
5. Optionally open `Try Live GPT-5.6`. This separate rate-limited proof gives
   the model four strict read/stage tools, seals the resulting Calendar-to-Mail
   graph, and exposes no approval or commit capability.

The sample uses fictional Acme and Globex records and reserved `.test` email
addresses. Guided Judge Mode is isolated per server session and resettable.

Copy `.env.example` to `.env` only when a later gate needs local configuration. Gate 0 tests require no services, Docker, credentials, or network after installation.

## Architecture boundaries

- `packages/domain`: provider-neutral schemas, immutable effect IR, and state machines
- `packages/runtime`: provider-neutral observed state, overlay, and atomic staging
- `packages/adapter-sdk`: separate simulation and commit capability contracts
- `packages/adapter-testkit`: reusable adapter conformance assertions
- `packages/approval`: deterministic graph canonicalization and content-bound approvals
- `packages/persistence`: immutable seeds, invalidations, journals, leases, and receipts
- `packages/adapters/reference-calendar`: synthetic certified move-event proof
- `packages/adapters/reference-mail`: simulation-only irreversible send-message staging proof
- `packages/adapters/google-common`: shared OAuth token exchange and HTTP transport
- `packages/adapters/google-calendar`: certified timed-event move adapter
- `packages/adapters/gmail`: certified exact draft and send adapters
- `apps/gateway`: reserved agent and human control-plane boundary
- `apps/worker`: approval-bound durable saga execution, reconciliation, verification, compensation, and receipts
- `apps/console`: credential-free product review, replay, approval, receipt, and Judge Mode
- `apps/google-workspace-certification`: two-phase credential-backed certification harness
- `apps/customer-ops-demo`: customer-operations proof only; never kernel semantics

See [the transaction contract](docs/transaction-contract.md) and [architecture](docs/architecture.md).

## GPT-5.6 and Codex

The Live Sandbox uses the official OpenAI JavaScript SDK and Responses API with
the `gpt-5.6` model alias. GPT chooses among four strict Calendar/Mail read and
stage tools. PREVIEW-owned deterministic code validates every call, owns effect
semantics and risk, seals the graph, and proves both synthetic providers remain
unchanged. Approval, commit, verification, reconciliation, and compensation are
not model tools.

The majority of the kernel, adapters, recovery tests, product UX, debugging,
deployment preparation, and evidence work was completed in the primary Build
Week Codex task. See [Codex collaboration evidence](docs/codex-collaboration.md)
and the [judging map](docs/judging-map.md).

## Verification

`pnpm check` builds every production package before running zero-warning ESLint,
strict package typechecks, and the complete 91-test suite. The suite includes
adapter conformance, tamper/drift checks, process-death and fault-injection
matrices, reconciliation, compensation, and receipt assertions. Final
submission verification also includes a clean frozen install, browser-level
Playwright exercise of the hosted path, ten consecutive guided runs, tracked
secret scanning, and dependency-license inspection.

## Supported and certified surfaces

- Development/runtime: Node.js 24 and pnpm 11; verified on Windows 11 locally
  and Render's Linux Node runtime.
- No-login product proof: synthetic Reference Calendar, Mail, and CRM.
- Credential-certified operations: one narrow Google Calendar event move,
  exact Gmail draft creation, and exact Gmail sending path.
- Reference and Google adapter behavior is deliberately operation-specific;
  PREVIEW does not claim universal connector coverage.

## Real Google certification and OAuth boundary

The repository contains real, capability-separated Google adapters rather than
only UI mocks. `google-common` exchanges a refresh token and supplies the shared
authenticated transport. The Calendar adapter certifies one timed,
non-recurring event move without attendee notifications, uses provider etags to
block drift, and reconciles through PREVIEW-owned private extended properties.
The Gmail adapter certifies exact plain-text draft creation and exact sending,
binds controlled MIME bytes into the approved effect, reconciles by Message-ID,
allows compensation only for drafts, and treats delivery as irreversible.

Live certification is intentionally two phase. The prepare command performs
reads and stages an immutable Calendar-to-Gmail graph with zero provider writes.
Only after a human reviews that graph and supplies its exact digest can the
execute command cross the mutation boundary, revalidate state, commit in
dependency order, and verify a durable receipt. Certification uses a dedicated
synthetic account with the Calendar owned-events scope plus `gmail.compose` and
`gmail.readonly`. OAuth credentials, the approval-signing key, and fixture IDs
remain in the ignored local `.env`; they are not required for the public demo or
normal Judge Mode.

```sh
pnpm test:gate7
pnpm test:gate7:live:prepare
pnpm test:gate7:live:execute
```

The two live commands are evidence procedures for an explicitly configured test
account, not general judge setup instructions. See the scoped adapter READMEs and
the certification record in [Codex collaboration evidence](docs/codex-collaboration.md).

## Limitations

- The public Guided Judge Mode uses isolated synthetic providers; it does not
  mutate a judge's Google account.
- The displayed Google `COMMITTED_VERIFIED` result is evidence from a separate
  controlled credential-backed Gate 7 run, not an active public write path.
- Public Live Sandbox quotas are in-memory and scoped to the single Render
  instance; they are submission abuse/cost guards, not distributed rate limits.
- The Render free instance can cold-start after inactivity.
- PREVIEW does not promise global atomicity, universal undo, or exactly-once
  delivery where a provider cannot guarantee it. Receipts instead report known
  residual and unresolved state explicitly.

## Render deployment

Create a public Render Web Service from the repository root. PREVIEW keeps its
workspace packages in the deployed checkout, so do not set a subdirectory as
the service root.

- Runtime: Node.js 24
- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Start command: `node apps/console/dist/server.js`
- Health check path: `/healthz`
- Environment: `HOST=0.0.0.0`; Render supplies `PORT`; add `OPENAI_API_KEY` only as a secret server-side value

The deterministic Guided Judge Mode remains available without an API key. The
public Live Sandbox keeps the key server-side, exposes stage-only tools, caps
the model loop at eight turns, permits one concurrent run, and defaults to
three runs per client and 24 total runs per service instance each hour. The two
hourly limits can be lowered with `PREVIEW_LIVE_SANDBOX_CLIENT_LIMIT` and
`PREVIEW_LIVE_SANDBOX_GLOBAL_LIMIT`.
