# Docs Project Rules

适用于文档、笔记、写作项目（Markdown / LaTeX / Obsidian / Wiki 等）。

## Extra Junk Targets

除默认垃圾清单外，还清理：

### LaTeX
- `*.aux`, `*.bbl`, `*.blg`, `*.fls`, `*.fdb_latexmk`
- `*.log`, `*.out`, `*.toc`, `*.lof`, `*.lot`
- `*.synctex.gz`, `*.synctex(busy)`
- `_minted-*/`

### Obsidian
- `.obsidian/workspace.json` (频繁变化的 workspace 状态)
- `.trash/` (Obsidian 自带回收站)

### Hugo / Jekyll / Static Site
- `public/`, `_site/`
- `resources/_gen/`
- `.hugo_build.lock`

### General Docs
- `*.bak`, `*.backup`, `*~`
- `*-copy.*`, `* (1).*`, `* copy.*` (重复文件)

## Misplaced File Heuristics

- 根目录下的 `draft_*`, `old_*`, `backup_*` 文件
- 根目录下的图片文件（建议归入 `images/` 或 `assets/`）
- 未分类的 `.md` 文件超过 10 个在根目录——建议按主题分目录
- `*.pdf` 散落在根目录（建议归入 `pdfs/` 或 `references/`）

## Protected Files — NEVER touch

- `README.md`, `LICENSE`
- `_config.yml` (Jekyll), `config.toml` / `hugo.toml` (Hugo)
- `.obsidian/` 目录中除 `workspace.json` 外的配置
- `mkdocs.yml`, `book.toml`
- `.gitignore`, `.gitattributes`
- `CLAUDE.md`, `.claude/`
- 任何 `index.md` 或 `_index.md`

## Git-Specific Checks

- 检查是否有大型 PDF 或图片被 git 跟踪（建议 git-lfs）
- 检查是否有编译产物（`*.pdf` from LaTeX）被跟踪
