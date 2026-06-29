# Data Project Rules

适用于数据分析、ML/DL 实验项目（Jupyter / pandas / PyTorch / TensorFlow 等）。

**保守程度最高** — 数据和模型文件一旦误删可能不可恢复。默认只标记、不自动归档。

## Extra Junk Targets

除默认垃圾清单外，还清理：

### Jupyter
- `.ipynb_checkpoints/`
- Jupyter kernel specs in project dir

### ML Frameworks
- `__pycache__/`, `*.pyc`
- `wandb/` 本地日志（标注 `[需确认]`——可能需要保留）
- `mlruns/` (MLflow 本地 tracking, 标注 `[需确认]`)
- `lightning_logs/` (标注 `[需确认]`)
- `runs/` (TensorBoard, 标注 `[需确认]`)

### Python
- `.pytest_cache/`, `.mypy_cache/`
- `*.egg-info/`

## Misplaced File Heuristics

- 根目录下的 `Untitled*.ipynb`（未命名 notebook）
- `test_*.py`, `scratch_*`, `tmp_*` 在根目录
- 根目录下的 `*.csv`, `*.parquet`, `*.h5` 散落文件（建议归入 `data/`）
- 根目录下的 `*.png`, `*.jpg` 输出图片（建议归入 `figures/` 或 `outputs/`）

## Protected Files — NEVER touch

这些文件/目录**绝对不能**自动清理（即使看起来很大）：

- `data/`, `datasets/`, `raw/`, `processed/`（数据目录）
- `models/`, `checkpoints/`, `weights/`, `saved_models/`（模型文件）
- `*.pt`, `*.pth`, `*.ckpt`, `*.h5`, `*.safetensors`, `*.onnx`（模型权重）
- `*.csv`, `*.parquet`, `*.feather`, `*.arrow`（数据文件——只标记散落的，不清理）
- `configs/`, `config/`（实验配置）
- `results/`, `outputs/`, `figures/`（实验结果）
- `requirements*.txt`, `environment.yml`, `pyproject.toml`
- `.env`, `*.yaml`, `*.toml`（配置文件）
- `README.md`, `LICENSE`
- `.gitignore`, `.gitattributes`, `.gitlfs`
- `CLAUDE.md`, `.claude/`
- `Makefile`, `Dockerfile`, `docker-compose.yml`

## Special Rules

1. **NEVER auto-archive model checkpoints.** 即使它们很大（GB 级别），也只在 Git 建议中提醒，不列入清理计划。
2. **NEVER auto-archive data files.** 只建议将散落的数据文件归入 `data/` 目录。
3. **Experiment logs** (`wandb/`, `mlruns/`, `runs/`) 全部标注 `[需确认]`，让用户决定。
4. 如果发现大型数据/模型文件被 git 跟踪，优先建议 `.gitignore` + git-lfs，而非归档。

## Git-Specific Checks

- 检查是否有 >100MB 的模型/数据文件被 git 跟踪（建议 git-lfs）
- 检查 `.gitignore` 是否覆盖了常见数据/模型路径
- 检查是否有 Jupyter notebook outputs 被 git 跟踪（建议 `nbstripout`）
