# Code Project Rules

适用于 Python/JS/TS/Rust/Go/Java 等代码项目。

## Extra Junk Targets

除默认垃圾清单外，还清理：

### Python
- `*.pyc`, `*.pyo`, `__pycache__/`
- `.eggs/`, `*.egg-info/`, `*.egg`
- `.tox/`, `.nox/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`
- `.coverage`, `htmlcov/`, `coverage.xml`
- `.venv/`, `venv/`, `env/` (虚拟环境——标注 `[需确认]`，可能是用户故意放在项目内的)

### JavaScript / TypeScript
- `node_modules/`
- `.next/`, `.nuxt/`, `.output/`
- `.parcel-cache/`, `.turbo/`
- `coverage/`, `.nyc_output/`
- `*.tsbuildinfo`

### Rust
- `target/` (标注 `[需确认]`，可能是故意保留的编译缓存)

### Go
- `vendor/` (标注 `[需确认]`，可能是 vendored dependencies)

### General Build
- `dist/`, `build/`, `out/`
- `*.o`, `*.so`, `*.dylib`, `*.dll`

## Misplaced File Heuristics

以下文件在根目录中可能是散落的临时文件：
- `test_*.py`, `*_test.py` 不在 `tests/` 或 `test/` 目录下
- `scratch_*`, `tmp_*`, `temp_*`, `debug_*`
- `*.ipynb` 在非 notebook 项目的根目录
- `*.sql` 散落在根目录（建议归入 `sql/` 或 `migrations/`）
- `*.csv`, `*.json` 数据文件在根目录（建议归入 `data/`）

## Protected Files — NEVER touch

- `README.md`, `LICENSE`, `CHANGELOG.md`
- `Makefile`, `Dockerfile`, `docker-compose.yml`
- `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements*.txt`
- `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- `Cargo.toml`, `Cargo.lock`
- `go.mod`, `go.sum`
- `.gitignore`, `.gitattributes`
- `CLAUDE.md`, `.claude/`
- CI/CD configs: `.github/`, `.gitlab-ci.yml`, `.circleci/`
- `.env.example` (但 `.env` 本身如果被 git 跟踪应该警告)

## Git-Specific Checks

- 检查是否有 `.env` 被 git 跟踪（安全风险）
- 检查是否有大于 10MB 的二进制文件被 git 跟踪
- 建议清理已合并到 main/master 的旧分支
