# Judge Guide

Judge Mode uses isolated synthetic state, requires no OAuth or API key, clearly
distinguishes simulation from provider mutation, and exposes the exact
deterministic consequence graph and receipt.

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev:judge
```

Open `http://127.0.0.1:4173` and follow the five visible steps:

1. Stage the agent instruction. The runtime seals six effects while the provider
   write counter remains zero.
2. Inspect the Acme and Globex cross-system consequences. Calendar and CRM are
   reversible; external Mail delivery is irreversible.
3. Protect the Acme renewal. PREVIEW invalidates Revision 1, replays from clean
   shadow state, and removes Acme's complete Calendar to Mail/CRM causal group.
4. Bind approval to Revision 2. The UI exposes the active graph, snapshot, and
   approval digests.
5. Commit the approved graph. The durable worker revalidates before mutation,
   commits in risk-aware dependency order, verifies each effect, and returns a
   `COMMITTED_VERIFIED` receipt with zero residual and unresolved state.

The page labels the orchestration as deterministic Judge Mode. It does not
pretend the credential-free demo is a live GPT call; Gate 3 separately verifies
the GPT-5.6 Responses API tool loop.

## Hosted judge path

Open `https://preview-transaction-runtime.onrender.com`. The Render deployment
serves the same no-login Guided Judge Mode publicly and adds the visibly
separate server-side GPT-5.6 Live Sandbox. `/healthz` is the deployment health
path. The Live Sandbox never receives approval or commit tools and is bounded
to eight model turns, one concurrent run, three runs per client per hour, and
24 runs per service instance per hour by default. Rate limits affect only the
cost-bearing Live Sandbox; the deterministic Guided Judge Mode remains usable
when the live limit is exhausted or OpenAI is unavailable.
