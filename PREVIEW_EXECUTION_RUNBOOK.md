# PREVIEW Execution Runbook

Last updated: 2026-07-14 (IST)

## 1. Product lock

> PREVIEW is a transactional runtime for tool-using agents: execute against shadow state, inspect one cross-system consequence diff, replay corrections, then commit and verify the exact approved effects.

The product is horizontal infrastructure. Customer operations is the hero proof, not the architecture.

Canonical flow:

```text
Agent connects
→ transaction opens
→ reads capture observed base state
→ writes mutate a shadow overlay
→ later reads see staged writes
→ effects form a dependency graph
→ revision seals
→ user reviews consequences
→ correction becomes a replay constraint
→ clean replay produces a new revision
→ user approves the exact revision digest
→ live state is revalidated
→ deterministic saga commits
→ every effect is verified
→ receipt reports committed, compensated, residual, or unresolved state
```

### Honest guarantee

For PREVIEW-certified operations, no provider mutation is issued before a human approves an immutable effect graph. PREVIEW then revalidates live state, executes that frozen graph, verifies actual results, and truthfully reports or compensates failures.

### Explicit non-goals

- No universal rollback claim.
- No cross-SaaS ACID claim.
- No claim that arbitrary MCP schemas reveal simulation or compensation semantics.
- No model-generated reversibility, commit, verification, or compensation decisions.
- No browser/computer-use writes inside the certified transaction boundary.
- No payment connector until the core is proven; email already demonstrates an irreversible boundary.

## 2. Non-negotiable invariants

1. No provider mutation before approval.
2. Every supported mutation produces complete deterministic effects.
3. Reads inside a revision observe its prior staged writes.
4. Abort leaves provider state unchanged.
5. Approval binds an immutable revision digest, not the original prompt.
6. Replay creates a new revision and invalidates the old approval path.
7. The model is never invoked during revalidation, commit, verification, or compensation.
8. Relevant live-state drift blocks commit before the first mutation.
9. Irreversible operations are committed last when dependencies permit.
10. Ambiguous irreversible operations are reconciled, never blindly retried.
11. Unknown mutations fail closed.
12. The agent plane cannot access approval or commit controls.
13. Every terminal run reports actual residual external state.
14. Customer, meeting, Gmail, Calendar, and CRM concepts never enter the transaction kernel.

## 3. Architecture

### Stack

- TypeScript in strict mode
- pnpm workspace
- Node.js 24
- Next.js console
- Express 5 gateway/control API
- Separate Node worker for commit and recovery
- Official OpenAI JavaScript SDK and GPT-5.6 Responses API
- MCP transport over the same tool gateway
- Zod schemas
- Postgres + Drizzle for hosted durable state
- Storage interfaces plus in-memory implementation for the first kernel slices and tests
- Vitest, `fast-check`, and Playwright
- Tailwind-based UI; graph library only if the causal view materially benefits

Docker is not currently installed. Local progress must not depend on Docker.

### Repository shape

```text
apps/
  console/                  # Review, replay, approval, receipt, judge mode
  gateway/                  # Agent plane, MCP transport, human control API
  worker/                   # Revalidate, commit, verify, reconcile, compensate
  customer-ops-demo/        # Hero prompt and demo orchestration only

packages/
  domain/                   # State machines, immutable Effect IR, invariants
  runtime/                  # Observed snapshot, overlay, staging, replay
  adapter-sdk/              # Certified adapter contracts
  adapter-testkit/          # Mandatory conformance and fault-injection suite
  persistence/              # Repositories, journal, Postgres implementation
  approval/                 # Canonicalization, digesting, approval records
  agent-openai/             # GPT-5.6 Responses tool loop
  diff/                     # Deterministic consequence model and presentation
  demo-fixtures/            # Synthetic Calendar, Mail, and CRM data
  adapters/
    reference-calendar/
    reference-mail/
    reference-crm/
    google-calendar/
    gmail/
    hubspot/

docs/
```

This is a modular monolith with a separate worker, not a microservice project.

### Control boundary

The agent receives only read and stage-capable tools. Approval and commit are separate authenticated control-plane operations and are never registered as model tools.

GPT-5.6:

- Chooses and coordinates tools.
- Receives simulated tool results.
- Replans after structured constraints.
- Summarizes deterministic effects and highlights salience.

Deterministic code:

- Defines effect semantics and risk class.
- Maintains snapshot and overlay state.
- Builds and hashes the effect graph.
- Enforces replay constraints.
- Revalidates, commits, verifies, reconciles, and compensates.

Use direct tool calls for side-effecting staged operations. Programmatic tool calling may later optimize bounded read-only fan-out; it is not the write or approval boundary.

## 4. Core domain model

```text
Transaction
  id, tenant, intent, activeRevision, status

SimulationRevision
  id, transactionId, revisionNumber, replayOf?
  baseSnapshotId, structuredConstraints
  modelRun, toolTrace, effectGraph, graphDigest, status

Observation
  provider, resource/query key, value digest
  provider version/ETag, observedAt, encrypted value reference

Effect
  immutable approved operation, exact commit payload, dependencies,
  preconditions, externalities, reversibility, verification, presentation

Approval
  revisionId, graphDigest, approver, policy version, expiration, signature

EffectAttempt
  effectId, attempt number, idempotency key, provider result, status

Receipt
  graph digest, effect-to-provider-result mapping, residuals, unresolved state
```

Execution state is stored separately from immutable effects.

### State machine

```text
CREATED
→ SIMULATING
→ REVIEW_READY
    → SIMULATING (new replay revision)
    → ABORTED
    → APPROVED
→ REVALIDATING
    → CONFLICTED
    → COMMITTING
→ VERIFYING
    → COMMITTED_VERIFIED
    → COMPENSATING
        → COMPENSATED
        → COMPLETED_WITH_RESIDUALS
        → REQUIRES_ATTENTION
```

## 5. Adapter contract

Every certified adapter must implement:

```text
read
stage/simulate
render deterministic diff
revalidate
commit
reconcile ambiguous outcomes
verify
compensate
```

Every supported operation declares:

- Strict input and output schemas
- Read or mutation status
- Known externalities
- Reversible, compensable, or irreversible classification
- Preconditions and provider version strategy
- Idempotency or reconciliation strategy
- Verification predicate
- Compensation and known residuals
- Required OAuth scopes

The simulation interface and commit interface remain separate so the agent-facing process cannot accidentally obtain write-capable provider clients.

## 6. Shadow execution and replay

PREVIEW uses an observed-state snapshot, not a fictional globally consistent cross-SaaS snapshot.

1. First read fetches provider state and records versions and observation time.
2. Writes create overlay operations and immutable draft effects atomically.
3. Later reads merge the observed base with the revision overlay.
4. Created resources receive symbolic IDs used by dependent effects.
5. Each adapter owns provider-specific query-merging semantics.
6. Abort discards the overlay and requires no external compensation.

A review edit becomes a structured constraint such as:

```text
deny mutation on calendar:event/acme-renewal
preserve calendar:event/acme-renewal.startTime
replace mail recipient set with [...]
```

Replay starts with a clean overlay, reuses the review snapshot for an ordinary correction, enforces constraints deterministically, reruns the entire agent session, and seals a new graph digest. If live state later drifts, commit is blocked and a refreshed preview is required.

## 7. Commit and recovery

1. Acquire a transaction lease.
2. Validate approval identity, signature, expiry, policy versions, and graph digest.
3. Revalidate the complete relevant read set.
4. Stop with `CONFLICTED` before any mutation if relevant state changed.
5. Topologically order effects, preferring reversible, then compensable, then irreversible effects among ready nodes.
6. Persist `COMMIT_STARTED` before each provider call.
7. Namespace idempotency by graph digest and effect ID.
8. Resolve symbolic IDs only from durable prior results.
9. Commit and remotely verify each effect.
10. Reconcile ambiguous timeouts before considering retry.
11. On failure, compensate eligible committed effects in reverse dependency order.
12. Emit a truthful receipt including uncompensated and unknown residuals.

The target is effectively-once execution using provider idempotency, journaling, and reconciliation. We will not claim exactly once where a provider cannot guarantee it.

## 8. Mechanism-first build gates

### Gate 0 — Contract and skeleton

Build the repo, domain schemas, state machine, invariant tests, CI, environment template, and evidence docs.

Pass when:

- Clean install and build work.
- Illegal transitions fail.
- Sealed revisions cannot be mutated.
- Unknown writes fail closed.

### Gate 1 — One staged Calendar mutation, no model and no UI

```text
open transaction
→ read event
→ stage move
→ read moved event from overlay
→ inspect exact effect
→ abort
```

Pass when base state is byte-for-byte unchanged.

Repeat with approval and commit. Verify exactly one external mutation and prove a repeated commit does not duplicate it.

### Gate 2 — Cross-adapter read-your-writes

Add reference Mail:

```text
stage Calendar move
→ reread moved event
→ stage attendee email containing the staged new time
```

Pass when the dependency graph is correct and abort changes neither base system.

### Gate 3 — Real GPT-5.6 tool loop

Route strict Calendar and Mail tools through PREVIEW using the Responses API.

Pass when a real model session produces a sealed dependent effect graph while provider state remains untouched.

### Gate 4 — CRM and hero replay

Add the reference CRM adapter and the Customer Ops Pack.

Hero instruction:

> I am at an offsite next week. Move every customer meeting to the following week, email attendees with their new times, and push the corresponding CRM follow-up dates.

Seed a high-value Acme renewal, external attendees, and recurrence scope. Revision 1 must group the Acme causal effects:

```text
Acme renewal
├── Calendar event moved
├── External email staged
└── CRM follow-up moved
```

Clicking **Protect Acme renewal** creates a constraint and triggers a complete replay. Revision 2 must remove all three downstream effects.

Pass when:

- Both graph digests differ.
- Base state remains unchanged.
- The same dependent effects disappear across repeated guided runs.
- The old revision cannot be approved.

### Gate 5 — Approval, drift, and tamper resistance

Canonicalize and hash the exact graph, snapshot digest, constraints, adapter versions, policy versions, ordering, and expiration.

Pass when:

- Changing one recipient or one payload byte invalidates approval.
- Changing provider state after preview blocks all writes.
- Wrong-user, wrong-tenant, expired, and replayed approvals fail.

### Gate 6 — Durable saga and Failure Lab

Failure scenario:

1. Calendar commits and verifies.
2. CRM fails before writing.
3. Mail remains withheld.
4. Calendar compensates and verifies.
5. Receipt shows Calendar `compensated`, CRM `failed`, Mail `not attempted`, and residual state `0`.

Pass when process death and injected failure at every journal boundary never cause a blind duplicate irreversible action, and every run ends with an honest receipt.

### Gate 7 — Real provider adapters

Order:

1. Google Calendar with a narrow certified operation set
2. Gmail drafts and exact-message sending
3. HubSpot only after workflow-trigger externalities are either controlled, exposed, or the adapter is labelled non-certified

Each real adapter must pass the same test kit as its reference adapter.

### Gate 8 — Product UX and no-login Judge Mode

Build:

- New transaction screen
- Live shadow tool trace
- Persistent **Real systems unchanged** indicator
- Cross-system causal consequence view
- Raw deterministic before/after diff
- Revision comparison
- Protect/edit, replay, abort, and approve actions
- Separate irreversible confirmation
- Revalidation/commit timeline
- Verified receipt
- Developer view with generic MCP endpoint and adapter registry
- Failure Lab

Judge Mode must work in incognito with one click, no OAuth, isolated synthetic data, server-side GPT-5.6, reset, rate limits, and a clearly labelled read-only reference run for third-party outages.

## 9. Day-by-day execution

The official deadline is 2026-07-22 at 05:30 IST. Internal submission cutoff is 2026-07-21 at 23:59 IST; the remaining time is emergency buffer only.

### July 14 — Lock and bootstrap

- Create product, contract, hero scenario, decision, and evidence documents.
- Scaffold the workspace and CI.
- Implement domain schemas and state transitions.
- Begin Gate 1.
- In parallel, Aru prepares OpenAI, Google, HubSpot, GitHub, and deployment credentials.

### July 15 — Kernel proof

- Finish Gates 1 and 2.
- Build adapter test kit foundations.
- Persist a dated milestone commit.

### July 16 — Live model and cross-system staging

- Finish Gate 3.
- Add CRM reference adapter.
- Persist tool traces and deterministic effects.
- Start hero fixture and replay constraints.

### July 17 — Hero replay and Day-4 kill gate

- Finish Gate 4 and the minimal review UI.
- Run repeated demo-shape evals.

Day-4 pass condition:

- A real GPT-5.6 agent calls a certified tool through PREVIEW.
- A write is staged without modifying base.
- A later read observes the staged write.
- Exact diff is produced.
- Abort leaves base untouched.
- Approval commits once and verification proves it.

If this fails, cut connector breadth and UI—not transaction semantics. No heroic replacement of the mechanism with a mocked dashboard.

### July 18 — Approval and recovery

- Finish Gates 5 and 6.
- Implement drift test, idempotency, reconciliation, compensation, and receipts.
- Start real Google adapter work.

### July 19 — Real providers and Judge Mode

- Finish Google Calendar and Gmail certified paths.
- Integrate HubSpot sandbox only if its declared boundary is honest.
- Deploy no-login Judge Mode early and test from incognito.
- Save a complete Devpost draft.

### July 20 — Product quality

- Finish Gate 8 UX.
- Run unit, integration, conformance, fault-injection, Playwright, secret, and license checks.
- Complete README and submission documentation.
- Run a fresh-clone setup test.

### July 21 — Freeze and submit

- Freeze functionality by 18:00 IST.
- Run ten consecutive guided demo attempts.
- Record multiple video takes and produce a public YouTube video under three minutes.
- Verify video, judge sandbox, repository access, README, and submission from incognito.
- Run `/feedback` and preserve the Codex Session ID.
- Submit by 23:59 IST.

## 10. Aru + Codex operating workflow

### This task

Keep the majority of core implementation in this Codex task so the `/feedback` evidence is clean. VS Code may remain open on the same workspace; edits appear immediately.

### Per milestone

1. Codex states the active gate and pass condition.
2. Codex inspects before editing.
3. Codex implements one coherent vertical slice.
4. Codex runs the narrow tests first, then broader verification.
5. Aru tests the visible behaviour and makes product calls.
6. Codex records material decisions and updates the runbook.
7. Commit only after the gate passes; use one honest, meaningful commit per gate.

### Aru owns

- Product judgment and final scope decisions
- External accounts, credentials, OAuth consent, and provider test tenants
- Visual taste calls and demo narration
- Devpost ownership, final submission, and any repository sharing

### Codex owns

- Architecture, implementation, tests, debugging, and refactoring
- UI execution and visual QA
- Documentation, decision/evidence logs, and submission checklist
- Deployment configuration and verification within authorized accounts
- Calling out scope drift and unsafe or dishonest claims

### Scope-control rule

New work enters only if it strengthens one of these:

- Transaction correctness
- Hero replay
- Judge comprehension
- Submission compliance

Everything else waits.

## 11. External setup checklist

Aru completes these without pasting secrets into chat:

- OpenAI API project and `OPENAI_API_KEY`
- Request Build Week credits if needed before the official credit-request cutoff
- Google Cloud project
- Gmail and Google Calendar APIs enabled
- OAuth consent screen in testing mode
- Dedicated synthetic Google test user(s)
- OAuth client credentials stored only in local/deployment secrets
- HubSpot developer sandbox or test account
- Private GitHub repository if the local repository will be pushed
- Deployment accounts selected once the runtime shape is proven

Use fictional companies, synthetic calendars, and `.test`/sink email addresses. Never use real customer data.

## 12. Test matrix

### Domain

- Legal and illegal state transitions
- Immutability after sealing
- Stable canonical digest and one-byte tampering
- Dependency ordering and cycle detection
- Deterministic classification

### Shadow runtime

- Isolation between transactions and tenants
- Read-your-writes for create, update, and delete
- Provider-specific query merging
- Symbolic ID dependencies
- Abort-never-writes
- Atomic stage: overlay and effects append together or neither does

### Approval and security

- Replay invalidates prior approval
- Wrong user, tenant, digest, policy version, and expiration
- Agent cannot invoke commit
- Simulation process lacks write clients
- Secret and sensitive-data redaction
- CSRF and authorization boundaries

### Commit and recovery

- Complete read-set drift detection
- Idempotency under duplicate workers
- Crash recovery at each journal boundary
- Ambiguous timeout reconciliation
- Verification mismatch detection
- Reverse-order compensation
- Exact residual-state reporting
- Irreversible actions remain withheld until dependencies verify

### Adapter conformance

- Simulation fidelity
- Unsupported writes fail closed
- Externalities are declared separately
- Real sandbox output matches the certified contract

### Product

- GPT-5.6 produces the expected guided transaction shape repeatedly
- Protecting Acme removes Calendar, Mail, and CRM effects
- Judge flow works in incognito
- Reset restores the fixture
- Playwright covers happy path, drift, abort, and failure recovery

## 13. Demo and submission

### Video target: 2:50–2:57

```text
0:00  Hook: agents show plans; PREVIEW shows consequences
0:12  Horizontal transaction-boundary definition
0:25  Run customer-ops instruction
0:38  Live GPT-5.6 shadow execution; real state unchanged
0:55  Reveal Acme Calendar, Mail, and CRM consequences
1:20  Protect Acme and trigger replay
1:32  Three downstream effects disappear
1:50  Approve, revalidate, commit, verify, receipt
2:10  Failure Lab: CRM fails, Calendar compensates, Mail withheld
2:27  Generic MCP endpoint and adapter contract
2:40  Explain GPT-5.6 and Codex contributions
2:52  Close: PREVIEW is the transaction layer for agents
```

### Required submission artifacts

- Developer Tools category
- English description
- Public YouTube demo with audio, under three minutes
- Hosted no-login judge sandbox
- Repository URL
- Public repository with relevant license, or private repository shared with:
  - `testing@devpost.com`
  - `build-week-event@openai.com`
- README with setup, supported platforms, sample data, testing path, limitations, GPT-5.6 use, and Codex collaboration
- `/feedback` Codex Session ID from the task containing most core work
- Installation instructions and a way to test without rebuilding
- Synthetic assets and compatible third-party licenses

### Evidence documents built alongside the code

- `README.md`
- `PRODUCT.md`
- `docs/architecture.md`
- `docs/transaction-contract.md`
- `docs/hero-scenario.md`
- `docs/decisions.md`
- `docs/codex-collaboration.md`
- `docs/judge-guide.md`
- `docs/judging-map.md`
- `docs/demo-script.md`
- `SUBMISSION_CHECKLIST.md`
- `THIRD_PARTY_NOTICES.md`

### Final audit

- All tests and production builds pass.
- Fresh clone works from documented commands.
- No secrets, real contacts, or unlicensed assets exist.
- Hosted demo works without prior state.
- Reset and Failure Lab work.
- Public video plays with audio from incognito and stays under three minutes.
- Repository access works for judges.
- Every claim matches demonstrated behaviour.
- Submission reopens with every field intact.
- Hosting remains available through the judging period.

## 14. Definition of finished

PREVIEW is real when we can prove all of the following in one coherent product:

- A real GPT-5.6 agent completes a dependent cross-system session.
- Provider state remains unchanged before approval.
- Later tool calls observe staged earlier mutations.
- One correction produces a clean replay and changes downstream effects.
- Approval is bound to the exact immutable consequence graph.
- Tampered and stale graphs cannot commit.
- Deterministic adapters commit and verify actual provider results.
- Failure recovery never lies about irreversible or residual state.
- A judge can experience the complete flow without rebuilding or supplying credentials.

Build order, always:

> Kernel → live agent → cross-system shadow execution → replay → approval and recovery → real adapters → UX → Judge Mode → evidence → video → submission.
