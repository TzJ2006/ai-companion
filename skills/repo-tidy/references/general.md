# General Project Rules

适用于混合项目或不确定类型的 repo。Fallback 规则，保守程度适中。

## Extra Junk Targets

除默认垃圾清单外，还清理：
- `*.bak`, `*.backup`, `*~`
- `*.orig` (merge conflict remnants)
- `*-copy.*`, `* (1).*`, `* copy.*` (重复文件)
- `*.log` 在根目录
- `core`, `core.*` (core dumps)

## Misplaced File Heuristics

General 模式比较保守，只标记最明显的散落文件：
- `scratch_*`, `tmp_*`, `temp_*`, `debug_*`
- `test_*` 不在 `tests/` 或 `test/` 下
- `TODO.txt`, `notes.txt` 在根目录（标注 `[需确认]`，可能是有意放置的）
- 根目录下超过 5 个同类型文件（如 5+ 个 `.py` 脚本不在子目录中）——建议分目录

## Protected Files — NEVER touch

- `README.md`, `LICENSE`, `CHANGELOG.md`
- `Makefile`, `Dockerfile`, `docker-compose.yml`
- 任何 `*config*`, `*.toml`, `*.yaml`, `*.yml`（除非明确是临时生成的）
- `requirements*.txt`, `package.json`, `Cargo.toml`, `go.mod`
- `.gitignore`, `.gitattributes`
- `CLAUDE.md`, `.claude/`
- CI/CD configs
- `.env.example`

## Special Rules

1. 对于无法判断用途的文件，一律标注 `[需确认]`
2. 不主动建议重新归类（因为不了解项目结构），只建议将明显的垃圾归档
3. 如果根目录文件数 > 20，建议用户考虑创建子目录组织

## Git-Specific Checks

- 检查未跟踪文件数量，超过 20 个时提醒
- 检查是否有已合并分支可以清理
- 检查是否有 >10MB 文件被 git 跟踪
