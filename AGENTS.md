# PREVIEW Repository Guidance

## Product identity

PREVIEW is a horizontal transactional runtime for tool-using agents. Customer operations is a demo package only. Do not put customer, CRM, meeting, Gmail, Calendar, or HubSpot assumptions in core packages.

## Safety-critical invariants

- Never issue a provider mutation before content-bound human approval.
- Reads in a simulation revision must observe its staged writes.
- Approval binds an immutable effect graph digest.
- Replay creates a new revision and invalidates the old approval path.
- GPT may orchestrate and explain; it never owns effect semantics, risk class, commit, verification, reconciliation, or compensation.
- Commit controls are never exposed as agent tools.
- Relevant drift blocks commit before mutation.
- Unknown writes fail closed.
- Irreversible ambiguous outcomes are reconciled, never blindly retried.
- Receipts must report residual and unresolved state honestly.

## Architecture rules

- Keep domain, runtime, adapter contracts, persistence, OpenAI orchestration, and presentation separated.
- Keep simulation and commit adapter interfaces separate.
- Keep effects immutable; store execution attempts separately.
- Use deterministic effect data for the raw diff. LLM salience annotations are supplemental and excluded from the approval digest.
- Use a modular monolith and separate worker. Do not introduce microservices or workflow platforms without a demonstrated need.
- Use storage interfaces so early kernel tests run without Docker; hosted persistence must be durable before real commit testing.

## Build order

1. Domain contract and invariants
2. One reference Calendar staged mutation
3. Cross-adapter read-your-writes
4. GPT-5.6 tool loop
5. Replay after structured constraints
6. Content-bound approval and drift detection
7. Durable commit, verification, reconciliation, and compensation
8. Real adapters
9. Product UX and Judge Mode
10. Submission evidence and demo

Do not advance past a gate because the next layer is more visually interesting.

## Verification expectations

Every implementation change should run the narrowest relevant tests. Before a milestone is considered complete, run the repository typecheck, lint, unit/integration suite, and production build. Before submission, also run adapter conformance, fault-injection, Playwright, fresh-clone, secret, and license checks.

## Evidence

- Keep material product and engineering decisions in `docs/decisions.md`.
- Keep Codex collaboration evidence in `docs/codex-collaboration.md`.
- Never fabricate or backdate evidence.
- Keep the majority of core implementation in the primary Build Week Codex task.

## Claims

Use “stage, inspect, replay, commit, verify, and recover what is recoverable.” Never claim universal undo, global atomicity, universal connector support, or exactly-once delivery where providers do not guarantee it.
