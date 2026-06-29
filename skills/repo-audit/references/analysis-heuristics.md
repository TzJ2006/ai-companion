# Analysis Heuristics

7 个优先级的检测规则、阈值和语言特定约定。Phase 3 按此文件执行分析。

---

## Priority 1: 项目结构合理性

### 通用规则

| Check | Threshold | Severity | Confidence |
|-------|-----------|----------|------------|
| 根目录非配置文件数 | >15 | medium | 0.85 |
| 目录嵌套深度 | >4 层 | low | 0.75 |
| 空目录（或仅含 `__init__.py`） | any | info | 0.9 |
| 单文件目录（目录只有一个源文件） | any | info | 0.7 |
| 超大目录（单目录 >30 源文件） | >30 | medium | 0.8 |

### 根目录"杂乱度"评估

非配置文件指排除以下后剩余的文件：
`README*`, `LICENSE*`, `CHANGELOG*`, `CLAUDE.md`, `Makefile`, `Dockerfile*`,
`docker-compose*`, `.*` (dotfiles), `*.toml`, `*.yaml`, `*.yml`, `*.json`,
`*.lock`, `*.cfg`, `*.ini`, `*.txt` (requirements 等)

### 语言约定

**Python:**
- 推荐结构：`src/<package>/` 或顶层 `<package>/` + `tests/`
- `__init__.py` 是否存在且有意义（空的 `__init__.py` 仅在 Python <3.3 必要）
- `setup.py` vs `pyproject.toml`（后者为现代推荐）

**JavaScript/TypeScript:**
- 推荐结构：`src/` + `tests/` 或 `__tests__/`
- `index.ts/js` 是否作为模块入口
- `lib/` vs `src/` 命名约定

**Rust:**
- 标准结构：`src/main.rs` + `src/lib.rs`
- `mod.rs` vs 直接文件名（Rust 2018 edition 推荐后者）

**Go:**
- `cmd/` 为可执行入口，`internal/` 为私有包，`pkg/` 为公共包
- `go.mod` 必须在根目录

---

## Priority 2: 逻辑疑问

| Check | Threshold | Severity | Confidence |
|-------|-----------|----------|------------|
| 函数/方法行数 | >100 lines | medium | 0.85 |
| 文件行数 | >500 lines | medium | 0.8 |
| 嵌套深度（缩进层级） | >4 levels | low | 0.75 |
| 函数参数数 | >5 params | low | 0.8 |
| 空 except/catch block | any | high | 0.9 |
| `TODO`/`FIXME`/`HACK`/`XXX` 注释 | any | info | 0.95 |
| 注释掉的代码块 | >10 lines | low | 0.7 |

### 检测方法

**函数长度** — 按语言匹配函数定义：
- Python: `def ` / `async def `
- JS/TS: `function ` / `=> {` / `async `
- Rust: `fn ` / `pub fn `
- Go: `func `

计算从定义到闭合大括号/下一个同级定义之间的行数。

**空异常处理:**
- Python: `except.*:\s*pass` 或 `except.*:\s*$`
- JS/TS: `catch\s*\(.*\)\s*\{\s*\}`
- Rust: 不适用（Result 类型系统强制处理）
- Go: `if err != nil \{\s*\}` 或丢弃 `_ = `

---

## Priority 3: 代码重复/冗余

| Check | Method | Severity | Confidence |
|-------|--------|----------|------------|
| 相似函数名跨文件 | 函数名编辑距离 ≤2 且在不同文件 | medium | 0.6 |
| 重复 utility 函数 | 相同函数名在多个文件中定义 | medium | 0.8 |
| 文件内容高度相似 | 两个文件 >70% 行相同 | medium | 0.85 |

### 检测方法

**函数名重复:** 用 grep 提取所有函数定义，按函数名分组，标记出现在多个文件中的。

**文件相似度:** 对同扩展名的文件两两比对，用行级 diff 计算相似率。仅比对同目录下或兄弟目录下的文件（避免 O(n²) 爆炸）。

**注意:** Priority 3 的误报率较高（相似函数名可能是合理的多态/重载），所以默认 confidence 偏低，多数会生成 question。

---

## Priority 4: 配置管理

| Check | Method | Severity | Confidence |
|-------|--------|----------|------------|
| `.env` 被 git 跟踪 | `git ls-files .env` | high | 0.95 |
| `.env` 存在但无 `.env.example` | 文件检查 | low | 0.85 |
| Magic numbers | 正则匹配裸数字常量 | low | 0.5 |
| 配置散落 | 多个 config 文件在不同目录 | info | 0.6 |

### Magic Number 检测

匹配模式（排除常见无害值 0, 1, 2, -1, 100, 1000）：
```
# Python/JS/TS: 赋值语句中的裸数字
= \d{3,}[^.]\b          # 3+ 位整数
timeout.*= \d+           # timeout 相关
port.*= \d+              # port 相关
```

Magic number 的 confidence 固定为 0.5（误报率高），全部生成 question。

### 不读取 .env 内容

仅检查：
1. `.env` 文件是否存在
2. 是否被 `git ls-files` 跟踪
3. `.gitignore` 是否包含 `.env` 规则

绝不 `cat` 或读取 `.env` 内容。

---

## Priority 5: 死代码/未用文件

| Check | Source | Severity | Confidence |
|-------|--------|----------|------------|
| Orphan files（Phase 2 产出） | 依赖图 | medium | 0.7 |
| 注释掉的代码块 >10 行 | grep | low | 0.7 |
| 未使用的 import | 静态分析 | low | 0.6 |
| 空文件（0 行或仅含 docstring） | wc -l | info | 0.9 |

### Orphan File 降置信度条件

以下情况 orphan file 的 confidence 应降至 0.5：
- 项目中存在动态 import 模式（`importlib`, `__import__`, `require(variable)`）
- 文件是配置/数据文件（`.json`, `.yaml`, `.toml`）而非源代码
- 文件名含 `test`、`spec`、`bench`（可能由测试框架自动发现）
- 文件是 CLI script（在 `pyproject.toml [project.scripts]` 或 `package.json bin` 中注册）

---

## Priority 6: 硬编码路径

| Pattern | Example | Severity | Confidence |
|---------|---------|----------|------------|
| Unix 绝对路径 | `/Users/`, `/home/`, `/opt/`, `/tmp/` | medium | 0.85 |
| Windows 绝对路径 | `C:\`, `D:\` | medium | 0.85 |
| 硬编码 URL (非 localhost) | `https://api.example.com` | low | 0.7 |
| 硬编码端口 | `:8080`, `:3000`, `:5432` | low | 0.6 |
| 硬编码 IP | `\d+\.\d+\.\d+\.\d+` (非 127.0.0.1/0.0.0.0) | medium | 0.8 |

### 排除规则

以下位置的路径不报告：
- 注释中的路径（文档性质）
- 测试文件中的 fixture 路径
- `Dockerfile` 中的标准路径（`/app`, `/usr/local`）
- `.gitignore` 中的路径模式
- shebang 行（`#!/usr/bin/env`）

---

## Priority 7: 依赖健康度

| Check | Method | Severity | Confidence |
|-------|--------|----------|------------|
| 未固定版本 | 正则匹配 manifest | medium | 0.85 |
| 已知弃用包 | 查阅弃用清单 | medium | 0.7 |
| dev 依赖在 prod 中 | 检查分组 | low | 0.7 |
| 重复功能依赖 | 同类包多个 | low | 0.6 |

### 常见已弃用包（参考清单）

**Python:**
- `optparse` → `argparse`
- `imp` → `importlib`
- `distutils` → `setuptools`
- `nose` → `pytest`
- `mock` → `unittest.mock` (Python 3.3+)

**JavaScript/TypeScript:**
- `request` → `node-fetch` / `axios`
- `moment` → `dayjs` / `date-fns`
- `tslint` → `eslint`
- `left-pad` (已废弃)

---

## 大规模 Repo 采样规则

| Repo 规模 | Phase 2 采样 | Phase 3 P2-P3 采样 | 其他优先级 |
|-----------|-------------|-------------------|-----------|
| ≤100 文件 | 全量 | 全量 | 全量 |
| 101-200 文件 | 全量 | Top 30 最近修改 + 入口 + hub | 全量 |
| >200 文件 | Top 50 最近修改 + 入口 | Top 30 最近修改 + 入口 + hub | grep 全量（不读文件内容） |

**始终在报告中注明：** "已分析 N/M 文件 (X%)"
