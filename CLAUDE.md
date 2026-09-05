# Working in AI Companion

Read README.md. Companion installations and their mandatory approval workflow were retired on 2026-09-05 at the owner's request. Do not load archived instructions as active policy or reinstall hooks/skills automatically.

The current source is in `companion/`; tests are in `.devcompanion/tests/`. Use `npm test` for source changes and `node companion/build.mjs` when a bundle rebuild is needed. Preserve existing uncommitted changes.

Retired implementations, installation backups, and old ledgers are under `archive/`. Current reasoning stays in `ideas/graph.yaml` and `ideas/log.md`. The hierarchical thoughts and persistent per-thought approval changes described in README.md remain to be implemented.