# Codex Collaboration Evidence

This log records actual collaboration only. It is not a substitute for Git history or test output.

## 2026-07-14 — Dedicated PREVIEW implementation task

- Aru supplied `AGENTS.md` and `PREVIEW_EXECUTION_RUNBOOK.md` as controlling specifications.
- Codex read both documents before project actions, inspected the empty repository, and created the Gate 0 execution plan.
- Codex began the strict TypeScript/pnpm workspace, provider-neutral domain contract, invariant tests, CI, environment template, and evidence documents.
- No credentials, provider accounts, external actions, or provider mutations were used.

### Verified results

- `pnpm install --frozen-lockfile` passed with pnpm 11.7.0 after explicitly allowlisting esbuild's reviewed setup script.
- The first revision immutability test exposed nested caller-data aliasing; Codex fixed the ownership boundary by cloning parsed effects and constraints.
- `pnpm test:unit` passed: 3 files, 8 tests.
- `pnpm check` passed: ESLint, strict TypeScript typecheck, Vitest, and the domain production build.

## 2026-07-15 — Gate 1 Reference Calendar kernel proof

- Aru authorized continued local implementation and bounded subagent review.
- Codex normalized the local workspace with an offline frozen install and reran the complete Gate 0 quality gate successfully without relaxing the esbuild-only dependency-script allowlist or minimum-release-age policy.
- Codex implemented separate simulation/commit adapter capabilities, provider-neutral shadow staging, deterministic graph digests, content-bound approval, the Reference Calendar move operation, and the minimal worker commit path.
- A read-only review subagent identified a mutable-revision commit race, missing Calendar cross-field semantic validation, locale-sensitive canonical ordering, dependency-direction issues, and negative-test gaps.
- Codex fixed those findings by freezing a validated commit snapshot, defining a refined operation schema, using locale-independent key ordering, moving composition packages to development dependencies, and adding adversarial and concurrent tests.
- No credentials, model calls, UI work, external accounts, real provider calls, or real customer data were used.

### Verified results

- `pnpm install --frozen-lockfile --offline` passed after dependency normalization; pnpm retained the minimum-release-age policy and esbuild-only build-script allowlist.
- `pnpm test:gate1` passed: 1 file, 7 integration tests covering read-your-writes, exact effects/diff, byte-identical abort, content-bound approval, immutable commit snapshots, semantic effect consistency, sequential and concurrent idempotency, and relevant drift blocking.
- `pnpm check` passed: ESLint with zero warnings, topological production builds for six packages, strict TypeScript checks, and 20 tests across 6 files.

## 2026-07-15 — Gate 2 cross-adapter shadow execution

- Codex re-read the repository guidance and Gate 2, shadow-runtime, adapter-boundary, and pass-condition sections before implementation.
- Codex implemented Reference Mail as a read/stage-only adapter, staged its exact attendee message from the Calendar overlay's moved time, and sealed the Calendar → Mail dependency graph without changing either provider.
- A bounded read-only review found that the first implementation let the caller supply dependency IDs and final Mail content, and that graph causality was not revalidated at the domain sealing boundary.
- Codex moved dependency/value provenance into the provider-neutral runtime, made Mail derive the final body from that runtime context, enforced exact emitted dependencies, and added graph-wide duplicate/reference/cycle validation in the domain schema.
- The same reviewer audited the fixes and reported both findings resolved with no scoped bypasses or regressions.
- No credentials, model calls, UI work, real providers, external messages, or out-of-scope repositories were accessed.

### Verified results

- `pnpm test:gate2` passed: 1 file, 3 focused tests for staged Calendar-derived Mail content, immutable causal sealing, byte-identical abort, and missing-provenance rejection.
- `pnpm check` passed: ESLint with zero warnings, seven topological production builds and strict typechecks, and 29 tests across 8 files.

## 2026-07-15 — Gate 3 implementation to the credential boundary

- Aru authorized the official OpenAI JavaScript SDK, Responses API, and `gpt-5.6` alias for the strict tool loop.
- Codex re-read the repository guidance and Gate 3 pass condition, then implemented a bounded simulation-only loop over the existing read-only Calendar and Mail adapter ports.
- Official OpenAI documentation was consulted for the model alias, Responses function-call outputs, strict schema requirements, supported JSON Schema fields, and disabling parallel tool calls. The local OpenAI documentation MCP was unavailable, so the official developer documentation site was used as the fallback.
- The current SDK release was rejected by the unchanged minimum-release-age policy; Codex pinned the prior mature official release instead of weakening the control.
- No credential was read or requested, no live model call was made, no provider mutation capability was exposed, and no Gate 3 live-model pass is claimed. The local `.env` file is absent, so the pass condition remains blocked at the explicitly authorized credential boundary.

### Verified results

- `pnpm test:gate3` passed: 3 files, 7 tests covering the official SDK request mapping, strict mocked-client turns, deterministic cross-adapter orchestration, staged rereads, exact dependent content, local schema rejection, and unknown-write fail-closed behavior.
- Focused ESLint passed with zero warnings for `packages/agent-openai`.
- `pnpm install --frozen-lockfile --offline` passed with the 24-hour minimum release age and esbuild-only build-script allowlist unchanged.
- `pnpm check` passed: ESLint with zero warnings, eight topological production builds and strict typechecks, and 36 tests across 11 files.

## 2026-07-17 — Gate 3 live verification

- Aru configured API billing and retained the project-scoped OpenAI credential only in the ignored local `.env` file; the credential value was neither printed nor shared with Codex.
- Codex ran the live Gate 3 harness against `gpt-5.6` through the Responses API.
- The model completed four simulation-only tool calls spanning Reference Calendar and Reference Mail, producing two deterministic staged effects and a sealed revision.
- The live harness reported `providerMutationCount: 0`, `calendarProviderUnchanged: true`, and `mailProviderUnchanged: true`; no provider mutation capability was exposed or invoked.
- The sealed effect graph digest was `sha256:1bfe485b49ff7d914f625f338adbc7d7d71a65df748a95edc572083950f5ba27`.
- After the live pass, `pnpm check` passed again: ESLint with zero warnings, eight topological production builds and strict typechecks, and 36 tests across 11 files.

## 2026-07-17 — Gate 4 structured replay and Customer Ops hero

- Codex re-read the repository guidance and Gate 4 pass condition before implementation and kept the primary work in this Core task.
- Codex implemented immutable replay lineage, staging-boundary constraint enforcement, and approval-path invalidation before adding demo-specific behavior.
- Codex added a simulation-only Reference CRM adapter and isolated high-value Acme renewal, external attendee, recurrence-scope, and follow-up concepts inside the Customer Ops demo.
- Revision 1 stages Calendar, Mail, and CRM effects for Acme and Globex. Protecting the Acme Calendar event creates a clean replay on the same base snapshot; repeated guided runs omit Acme's Calendar root and both dependent effects while retaining identical Globex consequences.
- No Gate 4 model call, real provider, provider mutation, UI, or out-of-scope repository was used. The ignored `.env` was not read or changed.

### Verified results

- Focused replay kernel tests passed: 24 tests across domain, runtime, and approval, including immutable lineage, constraint atomicity, and invalidation of new and already-issued approvals.
- `pnpm test:gate4` passed: 1 hero integration test covering distinct graph digests, byte-identical providers, repeated deterministic replay, changed Mail consequences, and removal of the complete protected Calendar → Mail/CRM effect group.
- Focused ESLint and strict typechecks passed for all Gate 4 packages.
- `pnpm install --frozen-lockfile --offline` passed with the existing minimum-release-age and esbuild-only dependency controls unchanged.
- `pnpm check` passed: ESLint with zero warnings, ten topological production builds and strict typechecks, and 44 tests across 15 files.

## 2026-07-17 — Gate 5 approval, drift, and tamper resistance

- Codex re-read the repository guidance and exact Gate 5 pass condition before implementation and kept commit/recovery, UI, and real-provider work out of scope.
- Codex extended shadow execution so every base read must capture a runtime-owned immutable present or absent observation, sealing binds the complete snapshot digest into the revision, and the Customer Ops hero produces its real synthetic snapshot manifest.
- Codex implemented a canonical approval manifest binding the exact effect graph, snapshot digest, constraints, dependency-safe ordering, adapter versions, policy versions, identity, tenant, revision/transaction identity, and expiration.
- Codex implemented a worker preflight over separate versioned read-only revalidation adapters. It checks the complete signed read set concurrently and returns a deeply frozen plan only when every resource is unchanged; no commit capability is accepted by this boundary.
- A bounded read-only design review identified missing snapshot capture/coverage, absent-resource semantics, current version-manifest checks, and the need to keep preflight separate from mutation capability.
- A second bounded final audit then demonstrated three bypasses in the initial implementation: caller-supplied snapshot substitution, optional observation capture for read-only dependencies, and the exported Gate 1 commit path skipping complete-read-set preflight. Codex bound the snapshot digest into sealed revisions, made capture mandatory and runtime-owned, and routed every new single-effect mutation through full snapshot preflight. Persistence, durable replay invalidation, and the preflight-to-commit lease remain Gate 6 work.
- No credential, model call, UI, real provider, provider write, external message, or out-of-scope repository was used. The ignored `.env` was not read or changed.

### Verified results

- Focused Gate 5 and affected regression suites passed: domain 15 tests, runtime 6 tests, approval 6 tests, worker preflight 3 tests, Gate 1 Calendar 8 tests, Gate 2 Mail 3 tests, Gate 3 orchestration 7 tests, and Gate 4 hero replay 1 test.
- Tests prove recipient and one-byte payload tampering rejection; sealed snapshot, constraint, adapter-version, and policy-version binding; snapshot-substitution rejection; wrong-user, wrong-tenant, expiration, and replay invalidation; complete Calendar/CRM-present and Mail-absent revalidation; read-only dependency drift blocking through the exported commit control; immutable plans; and zero PREVIEW provider mutations.
- `pnpm check` passed: ESLint with zero warnings, ten topological production builds and strict package typechecks, and 51 tests across 16 files.

## 2026-07-17 — Gate 6 durable saga and Failure Lab

- Codex first reverified Gate 5 with a frozen offline install and the complete quality gate before changing commit execution.
- Codex implemented one provider-neutral risk-aware planner shared by approval and execution, then added durable adapter reconciliation contracts, graph-scoped idempotency, bounded attempts, fenced leases, immutable run seeds, append-only execution journals, persistent replay invalidation, atomic file-backed records, verification, compensation, and honest terminal receipts.
- The Customer Ops demo composes Reference Calendar, CRM, and Mail commit adapters into the canonical Failure Lab without moving meeting or customer assumptions into the kernel. The required path commits and verifies Calendar, fails CRM before writing, withholds Mail, compensates and verifies Calendar, and reports zero residual and unresolved state.
- The first bounded read-only audit identified recovery and evidence gaps in residual accounting, replay invalidation after intent, retry bounds, file-store crash behavior, recovery-only crash coverage, and the read-only preflight capability boundary. Codex fixed each issue and added targeted regression tests.
- A follow-up audit found live-lock ownership, caller-variable retry policy, and missing journal-outcome boundaries. Codex made lock release token-owned, retained live-PID locks, fixed the retry policy at two attempts, distinguished attempt checkpoints, and injected process death before and after every previously missing outcome.
- The final bounded read-only audit reported no remaining Gate 6 milestone blocker and made no edits.
- No credential, model call, UI, real provider, external message, or out-of-scope repository was accessed. The ignored `.env` was not read or changed.

### Verified results

- `pnpm install --frozen-lockfile --offline` passed across all 12 workspace projects with dependency controls unchanged.
- `pnpm test:gate6` passed: 17 focused tests covering the canonical Failure Lab, happy and compensation crash matrices, recovery-only reconciliation, ambiguous and unresolved irreversible Mail outcomes, deterministic commit and compensation retry bounds, replay-invalidation recovery, stale and duplicate workers, in-flight lease expiry, atomic file-store recovery, live-lock ownership, post-commit compensation drift, terminal receipt reconstruction, and before/after failure-outcome boundaries.
- `pnpm check` passed: ESLint with zero warnings, eleven topological production builds and strict package typechecks, and 69 tests across 16 files.

## 2026-07-17 — Gate 7 local implementation to the Google credential boundary

- Codex re-read the repository guidance and exact Gate 7 pass condition before implementation, then used a bounded read-only design review to define the smallest honest Calendar and Gmail certification surfaces.
- Codex implemented a shared Google OAuth/HTTP transport, a provider-neutral adapter conformance kit, a narrow Google Calendar adapter, exact Gmail draft/send adapters, and a two-phase credential-backed certification harness.
- The mocked durable integration seals a Calendar → Gmail dependency graph, performs the complete content-bound snapshot preflight, and executes only through the existing file-backed saga. No commit capability is exposed to GPT or simulation adapters.
- Calendar uses conditional `If-Match` mutation and explicitly suppresses attendee notifications. Gmail binds deterministic MIME and treats empty/duplicate/mismatched reconciliation searches as unknown. Provider restoration reports persistent history as residual state.
- Official Google Calendar, Gmail, and OAuth documentation was consulted for conditional ETags, event patching, raw MIME sending, draft semantics, Message-ID search, and least-privilege scopes.
- No Google credential was read, requested in chat, or available to the implementation. No live Google API call, provider mutation, draft, or external message has been made, so Gate 7 is not yet claimed complete and no milestone commit is created at this boundary.

### Verified local results

- Focused Google transport tests passed: 2 tests for bearer-token isolation and refresh-token exchange caching.
- Focused Google Calendar tests passed: 6 tests for deterministic simulation, exact conditional patching, verification/compensation residuals, timeout-after-apply reconciliation, drift/unknown-write fail-closed behavior, unsupported-event rejection, and post-commit drift refusal.
- Focused Gmail and durable integration tests passed: 9 tests for deterministic MIME, strict operation rejection, draft lifecycle, irreversible send reconciliation, unknown ambiguous outcomes, identity checks, causal staging, post-commit draft drift refusal, and the signed file-backed Calendar → Gmail saga.
- `pnpm install --offline --frozen-lockfile` passed with dependency safety controls unchanged. `pnpm check` passed with ESLint at zero warnings, 16 production builds, strict package typechecks, and 86 tests across 21 files.
- The explicitly approved live credential-backed session remains pending; Gate 7 is not yet complete.

## 2026-07-17 — Gate 7 credential-backed certification attempts and verification correction

- Aru completed the Google Cloud/OAuth setup, kept every credential in the ignored local `.env`, created a disposable Calendar fixture, and explicitly approved each reviewed graph digest before execution.
- A file-change transcript exposed the first local approval-signing key. Codex stopped further live execution; Aru rotated that key manually without placing it in chat or tool output, removed the old approval, and prepared a newly signed graph. The Google OAuth values were not surfaced.
- The first authorized live run moved and verified Calendar and created a Gmail draft, then stopped before delivery because draft reconciliation could not reliably observe the newly created controlled message. It compensated Calendar, retained an honest residual/unresolved receipt, and did not send an email.
- Codex changed draft discovery to authoritative draft listing/direct reads and unfolded RFC continuation headers. Focused mocked tests passed before the next live attempt.
- The second authorized live run passed complete preflight, moved and verified Calendar, created and verified the exact draft, and issued exactly one Gmail send. Gmail returned an applied provider result, but immediate search-based verification did not yet find the sent message. PREVIEW did not resend; it removed the draft, restored the Calendar event, and emitted `COMPLETED_WITH_RESIDUALS` with the irreversible sent message and provider history reported honestly.
- Codex changed successful Gmail verification to read the provider ID returned by the mutation response, leaving search-only reconciliation fail-closed for ambiguous outcomes. A regression test now hides the message from search while direct returned-ID verification succeeds with one mutation.
- Gate 7 remains incomplete pending one new read-only prepare, a new content-bound approval, and a fresh live run that reaches a clean verified receipt. Neither prior terminal run nor its approval will be reused.

### Verified results after the correction

- Focused Gmail strict typecheck and ESLint passed; Gmail and durable saga tests passed: 10 tests across 2 files.
- A clean secret-free temporary workspace installed the frozen lockfile with the dependency safety policies intact, then `pnpm check` passed: ESLint with zero warnings, 16 production builds, strict package typechecks, and 85 tests across 21 files.
- No additional provider mutation was performed while diagnosing or correcting verification.

## 2026-07-17 — Gate 7 live Google certification pass

- Aru replaced both prior terminal session identifiers with a new session, cleared the old digest, and saved the resulting read-only prepare digest only after reviewing the exact Calendar, draft, and send effects. Prepare reported `providerMutationCount: 0`.
- Aru explicitly approved the exact new graph digest and authorized live execution. PREVIEW revalidated the complete approved read set before mutation and executed only through the existing file-backed durable saga.
- Google Calendar move, exact Gmail draft creation, and exact Gmail send each recorded one commit attempt and remote verification. No effect was retried or compensated.
- The terminal receipt was `COMMITTED_VERIFIED`; all three effect statuses were `committed_verified`, `knownResidualCount` was `0`, and `unresolvedCount` was `0`.
- This credential-backed result completes the Gate 7 Calendar/Gmail certification boundary. No broader Calendar/Gmail surface, HubSpot access, GPT commit capability, UI work, or out-of-scope repository is included in this milestone.

## 2026-07-18 — Gate 8 Product UX and Judge Mode

- Aru asked Codex to start Gate 8 after completing the real Google adapter gate and emphasized that the product interface must be visually strong.
- Codex audited the repository, confirmed that the presentation package contained no implementation, and defined the judge flow against the existing immutable runtime rather than creating a disconnected UI mock.
- Codex implemented a credential-free Judge Mode server and product interface. The server composes the real six-effect Customer Ops simulation, structured Acme protection replay, approval authority, durable risk-aware saga, reference commit adapters, journal, provider counters, and receipt.
- The browser receives deterministic presentation data only. Approval and commit are separate POST actions on the human control plane and are never agent tools. The browser does not own effect semantics, risk, ordering, verification, reconciliation, or compensation.
- The UI explicitly labels its synthetic deterministic mode, shows zero provider writes during simulation and replay, exposes the invalidated and active graph digests, and renders the actual terminal receipt after commit.
- No local credential, ignored `.env` value, live model call, real provider, external message, or out-of-scope repository was used for Gate 8.

### Focused verified results

- Five Judge Mode tests passed for zero-write six-effect staging, full causal-group replay, Revision 2 approval binding, verified durable commit, fail-closed commit without approval, and byte-identical abort.
- An end-to-end local HTTP exercise passed through READY → REVIEW → REPLAYED → APPROVED → COMMITTED: 6 staged effects and 0 writes became 3 replayed effects and 0 writes, approval matched the active digest, and commit returned `COMMITTED_VERIFIED` with 3 provider writes, 0 residuals, and 0 unresolved outcomes.
- A clean temporary copy outside OneDrive installed the frozen lockfile with dependency safety policies intact, then `pnpm check` passed: ESLint with zero warnings, 17 production builds, strict package typechecks, and 92 tests across 21 files. Package test execution is serialized to avoid Windows/OneDrive locking a shared Vitest module; test-file behavior is unchanged.

## 2026-07-18 - Gate 8 visual-system redesign

- Aru supplied extended design guidance, CSS variables, design tokens, and screenshots for Dimension, Resend, n8n, and Twingate, then explicitly locked the visual exploration after reviewing the proposed synthesis.
- Codex's first reference synthesis made the Dimension rail and black Resend-style transaction surface feel like separate products. Aru rejected that visible split. Codex removed Resend as a visible style, unified the full interface under one continuous Dimension-inspired blue-to-warm glass environment, and retained only its precision/status discipline as a nonvisual principle. The causal graph still makes cross-system replay visible without inheriting n8n's branding.
- Codex replaced the generic dashboard composition with a responsive Judge Mode experience covering ready, review, replayed, approved, committed, and aborted states. The UI remains a consumer of the existing deterministic session and does not acquire effect, risk, commit, verification, reconciliation, or compensation authority.
- Codex exercised the live local browser through the entire hero path. Revision 1 showed six effects and zero writes; protecting Acme visibly removed its Calendar, Mail, and CRM branch; Revision 2 bound approval to the new digest; commit produced three verified provider writes and a zero-residual, zero-unresolved receipt. Browser console inspection reported no warnings or errors.
- The 390px responsive breakpoint had no horizontal overflow. The 1280x720 opening frame keeps the primary simulation action visible, and every state transition resets to the top so the next reveal is camera-ready.

### Verified results after the redesign

- Judge Mode tests passed: 5 tests.
- `pnpm check` passed: ESLint with zero warnings, all 17 production builds, strict package typechecks, and 92 tests across 21 files.

## 2026-07-18 - Committed-state finale revision

- Aru identified that the terminal verified screen broke visual continuity and asked for a workflow-like structure that also communicates PREVIEW's future app surface.
- Codex replaced the stacked review graph and receipt with a dedicated committed-state transaction topology. Solid paths represent only the Calendar, Mail, and CRM effects verified in the current receipt; dotted nodes describe Drive/Dropbox, Stripe/Razorpay, and Slack/Teams as future adapter surfaces.
- The actual receipt remains visible beside the topology with 3/3 verification, zero residuals, zero unresolved outcomes, per-adapter evidence, graph and approval digests, and the deterministic rerun control.

## 2026-07-18 - Judge Mode demo-motion pass

- Aru locked the visual system and requested motion only for three truthful runtime transitions: replay, commit verification, and provider-write progression.
- Codex preserved the existing layout and styling. Replay now visibly removes the Acme Calendar, Mail, and CRM branch in dependency order, rolls the sealed-effect count from six to three, and reveals the newly active graph digest after the prior digest is invalidated.
- Commit now reveals Calendar, Mail, and CRM verification sequentially, advances the provider-write counter in the same rhythm, then introduces the durable receipt and verified-effects badge only after the adapter sequence completes.
- The motion layer does not invent intermediate runtime states or move authority into the browser; it presents the already-returned deterministic state using transform and opacity animations, with a reduced-motion fallback.

## 2026-07-18 - Locked-design presentation polish

- Aru identified a clipped reset control in the committed receipt while explicitly keeping the existing visual system locked.
- Codex corrected the reset control's width specificity so it maintains equal insets inside the receipt.
- The focused console suite passed all five tests and its production build passed. Live layout inspection confirmed equal reset-button insets and no horizontal overflow.
## 2026-07-19 — Honest scenario context, explicit decisions, and Live Sandbox

- Aruvansh challenged whether the polished browser surface was merely a canned demo and pointed out that accept/decline controls were not obvious. Codex audited the actual boundary: Judge Mode already exercised the real runtime and worker over synthetic providers, while the previously verified GPT-5.6 loop and Google adapters were not visible in the UI.
- Codex replaced the unsupported `$1.25M at risk` assertion with customer-operations fixture facts: contract value, renewal deadline, proposed meeting date, and external recipient. Human controls are now grouped as protect-and-replay, approve the exact graph, or abort with zero writes.
- Codex connected the existing strict GPT-5.6 Responses API orchestration to a separate Live Sandbox endpoint and product panel. The API key remains server-side; the model receives only four read/stage tools; the server verifies synthetic Calendar and Mail providers remain unchanged before returning a sealed graph.
- Codex added an implementation-evidence panel that explicitly distinguishes synthetic Judge Mode providers from the real runtime and from the separately credential-certified Google Calendar/Gmail run. It preserves the claim boundary rather than implying Judge Mode touches real accounts.

### Verified results

- Repository ESLint, all 17 production builds, and all strict package typechecks passed.
- The focused console suite passed 6 tests, including the new Live Sandbox provider-integrity proof. Customer Operations passed 18 tests and the OpenAI orchestration package passed 7 tests using Vitest's runner config loader to avoid the known Windows/OneDrive config-bundling failure.
- A synthetic HTTP run passed READY → REVIEW with 6 effects → REPLAYED with 3 effects → APPROVED on Revision 02 → `COMMITTED_VERIFIED`, with 3 approved writes, 0 residuals, and 0 unresolved outcomes.
- One live request through the new HTTP bridge used `gpt-5.6`, made 4 strict tool calls, sealed a Calendar → Mail graph with 2 effects, and returned 0 provider writes with both provider snapshots unchanged.

## 2026-07-19 - Live sandbox discoverability and consequence handoff

- Aruvansh asked for two tightly scoped changes while explicitly locking all other typography, spacing, layout, and visual language.
- Codex promoted only the top-bar Live Sandbox trigger into a compact `Try Live GPT-5.6` status pill and left the existing Guided Judge Mode surfaces unchanged.
- A successful live run now offers `Open in PREVIEW`, which carries the exact sealed Calendar and Mail graph into a dedicated read-only consequence review. The view shows the GPT-5.6 tool trace, graph binding, external recipient, risk classes, and zero provider writes; approval and commit remain unavailable to the model-facing path.
- ESLint, the console production build, strict console typecheck, and all 6 focused console tests passed. A browser verification completed a real GPT-5.6 run with 4 strict tool calls, 2 sealed effects, and 0 provider writes, then returned cleanly to the untouched Guided Judge Mode.

## 2026-07-21 - Render deployment boundary and public Live Sandbox guard

- Codex resumed from the clean pushed `bffd03e` baseline in the primary Build Week task and changed no locked UI typography, spacing, layout, or styling.
- The console retains `127.0.0.1:4173` as its local default while accepting a strictly validated `HOST=0.0.0.0` and Render-supplied `PORT` for deployment. A credential-free `GET /healthz` path reports service health without invoking GPT.
- The public cost-bearing Live Sandbox now has a fixed eight-turn ceiling, one global in-flight run, a sliding three-runs-per-client hourly default, and a 24-runs-per-instance hourly hard cap. Exhaustion returns HTTP 429 with `Retry-After`; Guided Judge Mode remains available because its deterministic routes are outside the guard.
- `OPENAI_API_KEY` remains server-side. The deployment documentation uses placeholders only, and neither `.env` nor a credential was read or copied into the deployment changes.

### Verified results

- Focused console verification passed: strict typecheck and 9 tests across 3 files, including client/global limit exhaustion and reset, invalid configuration rejection, local/Render binding, and a real HTTP `/healthz` response.
- A clean temporary workspace excluded `.env`, `.git`, `.preview`, and `node_modules`, installed the frozen lockfile with supply-chain controls unchanged, then passed repository ESLint, 17 production builds, all strict package typechecks, and 96 tests across 22 files.
- The first Render build proved Node 24.14.1 and the correct private `main` commit were selected, then failed before dependency installation because `corepack enable` attempted to replace Render's read-only `/usr/bin/pnpm`. The documented build command was narrowed to Render's already-provisioned `pnpm install --frozen-lockfile && pnpm build`; no application code or safety control changed.
