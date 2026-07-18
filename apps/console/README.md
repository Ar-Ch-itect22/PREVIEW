# PREVIEW Console

Judge Mode is an isolated, deterministic product surface over PREVIEW's real
transaction runtime. It uses synthetic Calendar, Mail, and CRM providers, needs
no OAuth, and exposes the sealed effect graph, replay invalidation, content-bound
approval, durable commit journal, and terminal receipt.

From the workspace root:

```sh
pnpm --filter @preview/console dev
```

Then open `http://localhost:4173`.
