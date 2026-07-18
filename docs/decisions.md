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

## 2026-07-15 — Keep GPT orchestration behind a strict simulation-only dispatcher

- Status: accepted
- Context: Gate 3 needs a real Responses API loop without allowing model output to define transaction semantics or reach provider mutation capability.
- Decision: expose only four strict Reference Calendar and Reference Mail read/stage tools, validate arguments again locally with strict Zod schemas, disable parallel tool calls, assign effect IDs in PREVIEW, require the Calendar stage/reread/Mail dependency sequence, and seal only after the controller validates the deterministic graph.
- Consequence: GPT-5.6 may choose and sequence simulation calls, but PREVIEW remains the sole owner of effect content, risk, externalities, causality, digesting, and the fail-closed boundary; no commit capability is present in the agent package.

## 2026-07-15 — Pin a mature official OpenAI SDK release

- Status: accepted
- Context: the current `openai` release was younger than the workspace's 24-hour minimum release age and pnpm correctly rejected it.
- Decision: pin official OpenAI JavaScript SDK `6.46.0`, the newest tested release that passes the existing supply-chain policy, without changing the minimum release age or build-script allowlist.
- Consequence: Gate 3 uses the official Responses API SDK while preserving the repository's dependency controls.

## 2026-07-17 — Model replay as immutable revision lineage

- Status: accepted
- Context: a review correction must not edit a sealed graph in place or leave a stale approval usable.
- Decision: replay returns an immutable invalidated copy of the prior sealed revision, a clean draft with a new ID and incremented revision number on the same base snapshot, and notifies an injected approval-path invalidator for the prior revision ID.
- Consequence: prior effects and their digest remain exact evidence, replay constraints have explicit lineage, and both future and already-issued approvals for the old revision fail closed. Durable invalidation storage remains a later persistence concern.

## 2026-07-17 — Enforce structured constraints at the staging boundary

- Status: accepted
- Context: prompts alone cannot guarantee that a replay respects a user's correction.
- Decision: the provider-neutral shadow runtime rejects denied mutations before simulation and validates preserve/replacement constraints before atomically appending an effect or overlay value.
- Consequence: orchestration may replan around a protected resource, but it cannot silently stage an effect that violates the revision's structured constraints.

## 2026-07-17 — Keep Gate 4 customer semantics in the demo composition

- Status: accepted
- Context: the hero scenario needs renewals, external attendees, recurrence scope, and CRM follow-ups without specializing the transaction kernel.
- Decision: keep those concepts in `@preview/customer-ops-demo`; implement Reference CRM as a generic read/stage adapter whose exact follow-up value and causal edge derive from runtime-owned staged provenance.
- Consequence: the hero can group Calendar, Mail, and CRM effects while domain and runtime packages remain horizontal and the CRM provider remains mutation-free at Gate 4.

## 2026-07-17 — Bind approval to a complete canonical manifest

- Status: accepted
- Context: a graph-only digest cannot detect a changed constraint, stale adapter or policy semantics, a substituted observation snapshot, or a changed execution order.
- Decision: compute a second canonical approval digest over the validated immutable graph, graph digest, snapshot digest, structured constraints, dependency-safe effect order, adapter-version manifest, policy-version manifest, identity, tenant, transaction/revision identity, and expiration; sign the parsed approval record containing that digest.
- Consequence: any exact-content, snapshot, constraint, version, ordering, identity, tenant, or expiration mismatch invalidates the approval before provider access.

## 2026-07-17 — Separate complete-read-set preflight from commit capability

- Status: accepted
- Context: effect-local revalidation cannot cover absent resources or reads that do not directly produce an effect, and accepting commit adapters during drift checking would weaken the no-write-before-preflight boundary.
- Decision: every shadow base read records a runtime-owned present/absent observation, sealing writes the canonical snapshot digest into the immutable revision, approval rejects any substituted snapshot, and the worker revalidates the entire signed snapshot through versioned read-only adapters before returning a frozen commit plan.
- Consequence: changed, missing, or newly appeared effect targets and read-only dependencies block the whole plan while preflight has no provider mutation capability; the existing single-effect mutation control also requires this preflight before a new provider write. Durable execution and closing the preflight-to-commit race remain Gate 6 work.

## 2026-07-17 — Bind approval to deterministic risk-aware execution order

- Status: accepted
- Context: the hero graph records Calendar, Mail, then CRM, but the sibling CRM effect is reversible while Mail delivery is irreversible.
- Decision: approval and execution use one deterministic topological planner that chooses ready reversible effects before compensable and irreversible effects, with graph position as the stable tie-break.
- Consequence: the approved hero order is Calendar, CRM, Mail without changing causal dependencies, so a CRM failure withholds Mail and permits verified Calendar compensation.

## 2026-07-17 — Recover durable attempts by reconciliation, never assumption

- Status: accepted
- Context: process death can occur after a provider call but before its result is journaled, and a second worker can acquire an expired lease while the first call is still in flight.
- Decision: persist intent before every provider call, use graph-scoped idempotency keys, fenced leases, strict persisted-result parsing, and explicit applied/not-applied/unknown reconciliation. Retry only authoritatively non-applied calls, with a deterministic two-attempt limit; unknown irreversible outcomes stop for attention.
- Consequence: restart and lease-expiry paths reconcile before acting, stale workers cannot append, Mail delivery is not blindly duplicated, and every supported fault path reaches an honest terminal receipt.

## 2026-07-17 — Persist authorization without blocking required recovery

- Status: accepted
- Context: replay invalidation must block a new commit, but invalidation after a mutation intent must not prevent reconciliation, compensation, or receipt generation.
- Decision: journal successful authorization before execution. A run with no mutation intent must still repeat full approval and read-only snapshot preflight; a run with durable mutation intent resumes from its authorized journal state and provider reconciliation.
- Consequence: invalidation before the first mutation intent produces zero provider writes, while invalidation after intent cannot strand an already-started execution without recovery.

## 2026-07-17 — Report partial provider state as residual or unresolved

- Status: accepted
- Context: an unresolved irreversible outcome can leave earlier verified mutations in place, and compensation can be refused when provider state drifts after commit.
- Decision: receipts separately enumerate known residual state and unresolved possible state. Verified mutations left after an incomplete run are known residuals; unknown Mail delivery is unresolved; failed or unknown compensation never reports residual zero.
- Consequence: PREVIEW claims only verified compensation and reports remaining provider state without implying universal undo or global atomicity.

## 2026-07-17 — Certify narrow Google Workspace operations

- Status: accepted
- Context: Calendar and Gmail expose broader mutation surfaces than PREVIEW can honestly verify and recover in the first real-provider gate.
- Decision: certify only owned, confirmed, timed, non-recurring Calendar event moves with no attendees and explicit `sendUpdates=none`; exact UTF-8 plain-text Gmail draft creation; and exact UTF-8 plain-text Gmail sending. Reject all other event types, recipient/header variants, HTML, attachments, threading, aliases, and unknown operations.
- Consequence: deterministic PREVIEW effects remain the source of provider payloads, while unsupported provider behavior fails before mutation.

## 2026-07-17 — Treat real-provider restoration as compensation with residuals

- Status: accepted
- Context: restoring Calendar start/end or deleting a Gmail draft cannot erase provider revision metadata, mailbox history, timestamps, or audit/change-feed records.
- Decision: classify Calendar move and Gmail draft creation as `COMPENSABLE`, add provider-neutral residual evidence to compensation verification and durable journals, and surface a compensated visible state with persistent provider history as a residual receipt rather than universal undo.
- Consequence: receipts distinguish restored controlled fields from unavoidable provider history and never claim byte-identical reversal.

## 2026-07-17 — Never infer Gmail non-delivery from an empty search

- Status: accepted
- Context: Gmail exact sending has no provider idempotency key, and message search can lag after an ambiguous network outcome.
- Decision: bind deterministic MIME bytes and RFC `Message-ID` during simulation. One matching message with exact controlled semantics proves `APPLIED`; empty, duplicate, or mismatched results remain `UNKNOWN` and are never a retry authorization.
- Consequence: ambiguous delivery stops for attention instead of risking duplicate external email.

## 2026-07-17 — Require two-phase live certification approval

- Status: accepted
- Context: a credential-backed test includes a real Calendar mutation, a Gmail draft, and an external message, so a test command must not silently cross the approval boundary.
- Decision: the live prepare command performs reads and writes an ignored sealed artifact with zero provider mutations; the execute command requires the human to copy the exact reviewed graph digest into `PREVIEW_GATE7_APPROVE_GRAPH_DIGEST`, then revalidates the complete signed snapshot and uses the existing file-backed durable saga.
- Consequence: possessing OAuth credentials alone cannot trigger a provider mutation, and repeated execution resumes from durable evidence rather than bypassing the saga.

## 2026-07-17 — Verify successful Gmail writes by returned provider identity

- Status: accepted
- Context: Gmail accepted an exact-message send and returned its provider message ID, but an immediate `rfc822msgid` search did not yet expose the new message. Treating that indexing delay as a content mismatch produced a truthful residual receipt, but it could not certify the otherwise known successful write.
- Decision: after a successful Gmail API response, verify the exact controlled MIME by reading the returned provider draft/message ID directly. Reserve Message-ID search for reconciliation when a mutation response is ambiguous and no trustworthy provider ID is available.
- Consequence: normal verification is independent of Gmail search-index lag, while ambiguous irreversible sends still remain `UNKNOWN` on empty, duplicate, or mismatched search results and are never blindly retried.

## 2026-07-18 — Make Judge Mode a real runtime composition

- Status: accepted
- Context: a polished but disconnected dashboard would make the core safety claim unverifiable, while live credentials and model nondeterminism would weaken a three-minute judge path.
- Decision: compose the existing Customer Ops simulation, replay coordinator, approval authority, durable saga, and reference provider adapters behind a credential-free local human control plane. The static presentation consumes the exact deterministic effect data, digests, journal, provider counters, and receipt; it does not reconstruct transaction semantics in the browser.
- Consequence: every Judge Mode button exercises the real mechanism. Stage, replay, and abort produce zero provider writes; replay invalidates the old approval path; approve and commit remain separate human-only operations; and the terminal UI is backed by the worker's actual verified receipt.

## 2026-07-18 — Keep the submission demo deterministic and claims explicit

- Status: accepted
- Context: the live GPT-5.6 orchestration proof is important evidence, but variable tool choices, API availability, and credentials are unnecessary failure modes for the recorded hero demonstration.
- Decision: label the UI path “deterministic Judge Mode,” use fixed synthetic fixtures, and keep the live GPT-5.6 proof as separately tested Gate 3 evidence. Render the raw deterministic consequence diff as primary evidence and avoid claiming live model judgment in the credential-free path.
- Consequence: judges can replay the same disaster/correction/commit story reliably without OAuth or API billing, while the repository still contains and verifies the strict GPT-5.6 tool loop used by PREVIEW.

## 2026-07-18 - Make the staging boundary the visual architecture

- Status: accepted
- Context: the first Judge Mode interface exposed the real mechanism but read as a conventional dark administration dashboard. PREVIEW needs the simulation-to-reality boundary, replay, and receipt to be understandable in a three-minute demonstration without sacrificing exact operational evidence.
- Decision: use one coherent Dimension-inspired atmospheric glass environment across both the narrative rail and transaction stage, with an original causal graph informed only behaviorally by n8n's workflow readability. Resend contributes precision and status discipline as principles, not a visibly separate black design language. Evidence, approval controls, digests, and receipts use stronger translucent surfaces and hairline boundaries within the same continuous blue-to-warm environment. Semantic colors are reserved for staged activity and deterministic risk or verification state.
- Consequence: the interface makes shadow state spatially distinct from reality, turns structured replay into a visible branch-removal moment, and preserves the raw deterministic diff and human commit boundary. PREVIEW does not copy any reference product's layout, palette, assets, or brand identity.

## 2026-07-18 - Give the verified state its own transaction topology

- Status: accepted
- Context: stacking a green receipt above the pre-commit graph made the committed state feel like a differently themed review screen and weakened the final reveal.
- Decision: replace the committed review composition with a dedicated topology that places PREVIEW at the commit boundary, draws verified paths only to the Calendar, Mail, and CRM adapters exercised by the receipt, and draws separate dotted paths to explicitly labelled future Files, Payments, and Messaging surfaces. Keep receipt counts, effect evidence, and approval bindings beside the topology in the same continuous glass system.
- Consequence: the terminal state now communicates both verified proof and horizontal product ambition without implying that future adapters are currently supported or that the transaction has universal undo semantics.
