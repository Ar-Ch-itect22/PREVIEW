# Engineering Decisions

Decisions are recorded when made and are never backdated.

## 2026-07-14 — Start as a modular monolith with a separate worker

- Status: accepted
- Context: PREVIEW needs strict control boundaries without operational microservice overhead.
- Decision: use a pnpm workspace with separated packages and applications; introduce a separate commit/recovery worker at the relevant gate.
- Consequence: package boundaries must remain explicit, while deployment can stay simple.

## 2026-07-14 — Keep Gate 0 kernel tests service-free

- Status: accepted
- Context: Docker is unavailable and transaction correctness should not depend on hosted infrastructure.
- Decision: domain tests run entirely in process. Persistence remains behind future interfaces until durable commit work.
- Consequence: clean installation is the only Gate 0 network-dependent step.

## 2026-07-14 — Reject mutations through an allowlisted operation registry

- Status: accepted
- Context: arbitrary tool schemas cannot establish effect, risk, verification, or compensation semantics.
- Decision: only explicitly registered mutation definitions can stage; unknown adapter operations throw before simulation.
- Consequence: adapter certification is explicit and unknown writes fail closed.

## 2026-07-14 — Allow only esbuild dependency scripts

- Status: accepted
- Context: pnpm 11 fails installation when a dependency build script has not been reviewed. Vitest depends on esbuild's platform-binary setup script.
- Decision: keep strict dependency-build enforcement and allow only `esbuild` in `pnpm-workspace.yaml`.
- Consequence: newly introduced dependency scripts fail CI until explicitly reviewed.

## 2026-07-15 — Separate simulation and commit capabilities

- Status: accepted
- Context: agent-facing simulation must be unable to obtain provider mutation capability.
- Decision: define distinct adapter interfaces and construct the Reference Calendar simulation adapter with a read-only port; only the worker-composed commit adapter receives a mutation port.
- Consequence: staged operations cannot accidentally call the synthetic provider mutation path.

## 2026-07-15 — Freeze a validated commit snapshot before asynchronous work

- Status: accepted
- Context: compile-time `Readonly` does not prevent a caller from mutating a revision after approval verification but before an awaited provider call.
- Decision: the worker clones, schema-validates, and deeply freezes the approval and revision before verification, reconciliation, revalidation, commit, or verification.
- Consequence: every asynchronous step consumes the exact content whose digest was approved.

## 2026-07-15 — Validate Calendar effects as a cross-field contract

- Status: accepted
- Context: separately valid payload, precondition, resource key, and verification fields can still contradict one another.
- Decision: one strict operation schema requires all Calendar move identities, versions, payload fields, and verification expectations to agree.
- Consequence: semantically inconsistent graphs fail before provider access even if their generic domain shape and approval digest are valid.

## 2026-07-15 — Reconcile repeat requests before revalidation

- Status: accepted
- Context: an already successful commit naturally changes the provider version, so blindly revalidating a repeated control request would report drift instead of returning the existing result.
- Decision: after approval validation, derive the idempotency key from graph digest and effect ID, reconcile it first, then revalidate only a not-yet-attempted effect.
- Consequence: sequential and concurrent duplicate requests produce exactly one synthetic provider mutation and return a verified prior result.

## 2026-07-15 — Build workspace dependencies before checks

- Status: accepted
- Context: clean package tests and typechecks cannot resolve production `dist` exports before dependency packages are built.
- Decision: root quality scripts build the workspace topologically before package typechecks and tests.
- Consequence: a clean workspace does not depend on stale build artifacts while production exports remain explicit.

## 2026-07-15 — Derive causal edges from runtime-owned staged provenance

- Status: accepted
- Context: allowing a caller to provide effect dependency IDs and a pre-rendered Mail body would make the causal graph an assertion rather than proof of data flow.
- Decision: callers select staged resource keys; the runtime resolves their overlay values and originating effect IDs, adapters derive exact output from that context, and runtime rejects emitted dependencies that do not match.
- Consequence: the Reference Mail body and Calendar dependency are deterministically bound to the staged moved event while the kernel remains provider-neutral.

## 2026-07-15 — Validate causality again at the domain sealing boundary

- Status: accepted
- Context: runtime staging validation alone could be bypassed by directly constructed or persisted effect graphs.
- Decision: the domain graph schema rejects duplicate effect IDs, duplicate edges, dangling dependencies, and cycles; sealing, revision parsing, and digesting all traverse it.
- Consequence: malformed causal graphs fail closed regardless of their construction path.

## 2026-07-15 — Keep Reference Mail simulation-only at Gate 2

- Status: accepted
- Context: Gate 2 proves cross-adapter shadow execution, not irreversible delivery or recovery.
- Decision: expose only a Mail read port and simulation adapter, classify send-message as irreversible with an external-delivery externality, and implement no Mail commit capability yet.
- Consequence: the agent can inspect exact Mail consequences but cannot deliver a message.
