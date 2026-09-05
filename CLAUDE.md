# Working in AI Companion

Read README.md. Companion installations and their mandatory approval workflow were retired on 2026-09-05 at the owner's request. Do not load archived instructions as active policy or reinstall hooks/skills automatically.

The current source is in `companion/`; tests are in `.devcompanion/tests/`. Use `npm test` for source changes and `node companion/build.mjs` when a bundle rebuild is needed. Preserve existing uncommitted changes.

Retired implementations, installation backups, and old ledgers are under `archive/`, which `.gitignore` excludes — nothing there is in version control (the old ledgers survive in git history as deleted files). Current reasoning stays in `ideas/graph.yaml` and `ideas/log.md`.

Because nothing is installed here, an edit to `companion/guard.ts` changes no behaviour in this session; it only changes what an installed copy would do after `node companion/build.mjs`.

The idea tree (`parent`, at most seven per level, one page per idea) and the per-idea approval (one `plan` gate bound to that idea's own content, several ideas per challenge) landed on 2026-09-05 — see `companion/FORMAT.md`, "The tree" and D7.