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
