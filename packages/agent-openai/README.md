# OpenAI Agent

Strict OpenAI Responses API orchestration for PREVIEW's Reference Calendar and
Reference Mail simulations.

The model receives four strict tools: Calendar read/stage and Mail read/stage.
It never receives approval, commit, provider mutation, verification,
reconciliation, or compensation capabilities. PREVIEW owns tool validation,
staged read-your-writes, effect construction, risk and externality semantics,
causal dependencies, and graph sealing.

`pnpm test:gate3` runs entirely against a mocked Responses client. The live Gate
3 pass condition is intentionally separate and requires a local ignored `.env`
with `OPENAI_API_KEY`; run it from the workspace root with
`pnpm test:gate3:live`. Never commit the `.env` file or its value.
