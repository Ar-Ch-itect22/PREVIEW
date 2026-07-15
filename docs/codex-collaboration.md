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
