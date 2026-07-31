# CLAUDE.md

@AGENTS.md

## Claude Code notes

- `npm run test` and `npm run dashboard` never exit and will hang a Bash tool call. Use
  `npx vitest run [path]` for tests and `npm run dashboard:start` / `dashboard:stop` (detached) for
  the dashboard.
- Skills are invoked as slash commands (`/ccplan`, `/ccedit`, ...) registered by
  `.claude/commands/<name>.md`. A skill without a command file is not invocable from Claude Code;
  when adding one, create all three pieces: `skills/<name>/SKILL.md`, the `.claude/commands/`
  command file, and the Codex adapter `.agents/skills/<name>/SKILL.md`.
- This repo's own Edit/Write hooks (in `.claude/settings.json`) record every edit to
  `.devcompanion/queue/events.jsonl` via `packages/hook/dist` — expect hook output after edits, and
  rebuild after changing `packages/hook/src` so the hooks don't run stale code.
