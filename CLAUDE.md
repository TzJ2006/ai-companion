# Working in AI Companion

Read README.md. Companion installations were retired on 2026-09-05 at the owner's request and then installed here again the same day: `.companion/companion.mjs` is wired into `.claude/settings.json`, `.cursor/hooks.json` and `.codex/hooks.json`, the five skills sit under `.claude/skills/` and `.agents/skills/`, and the mandatory approval workflow (D7/D17) is in force in this session — `set <id> doing` and product writes both refuse without a current plan approval. Do not load archived instructions as active policy, and do not install or uninstall hooks/skills automatically.

The current source is in `companion/`; tests are in `.devcompanion/tests/`. Use `npm test` for source changes and `node companion/build.mjs` when a bundle rebuild is needed. Preserve existing uncommitted changes.

Retired implementations, installation backups, and old ledgers used to sit under `archive/`, which `.gitignore` excludes; that directory is now empty and nothing there is in version control — they survive only in git history, as the files commit 48e1f51 deleted (`git show 48e1f51^:archive/...`). Current reasoning stays in `ideas/graph.yaml` and `ideas/log.md`.

The guard that gates this session is the installed bundle `.companion/companion.mjs`, not the source, so an edit to `companion/guard.ts` changes no behaviour on its own — but this checkout IS an installed copy: `node companion/build.mjs` writes `companion/dist/companion.mjs` and nothing else, and an install (`npx tsx companion/install.ts --update`) is what copies that bundle over `.companion/companion.mjs` and changes this session.

The idea tree (`parent`, at most seven per level, one page per idea) and the per-idea approval (one `plan` gate bound to that idea's own content, several ideas per challenge) landed on 2026-09-05 — see `companion/FORMAT.md`, "The tree" and D7.