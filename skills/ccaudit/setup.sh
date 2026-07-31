#!/usr/bin/env bash
# One-time setup for the ccaudit skill: installs a patched RepoAudit under
# ~/.devcompanion/tools/RepoAudit with a dedicated conda env.
# Idempotent: safe to re-run; use --force-reinstall to start over.
# Run from git bash on Windows (conda must be on PATH).
set -euo pipefail

PINNED_SHA="160f5bcd378a02a2417e32e999f93ef5fa0f5e64"
TOOLS_DIR="$HOME/.devcompanion/tools"
REPO_DIR="$TOOLS_DIR/RepoAudit"
ENV_NAME="repoaudit"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SKILL_DIR/cli-backend.patch"
STATE_FILE="$REPO_DIR/.ccaudit-setup-state.json"

if [[ "${1:-}" == "--force-reinstall" ]]; then
  echo "Removing $REPO_DIR and conda env $ENV_NAME ..."
  rm -rf "$REPO_DIR"
  conda env remove -n "$ENV_NAME" -y 2>/dev/null || true
fi

step() { echo ""; echo "=== $1 ==="; }

step "1/6 Clone RepoAudit @ $PINNED_SHA"
mkdir -p "$TOOLS_DIR"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  git clone https://github.com/PurCL/RepoAudit.git "$REPO_DIR"
fi
git -C "$REPO_DIR" checkout --quiet "$PINNED_SHA"

step "2/6 Apply CLI backend patch"
if grep -q "infer_with_cli" "$REPO_DIR/src/llmtool/LLM_utils.py"; then
  echo "Patch marker already present — skipping."
else
  git -C "$REPO_DIR" apply "$PATCH_FILE" \
    || { echo "ERROR: patch failed to apply — upstream drifted from pinned SHA? Aborting."; exit 1; }
fi

step "3/6 Conda env ($ENV_NAME, python 3.13)"
if ! conda env list | grep -qE "^$ENV_NAME\s"; then
  conda create -n "$ENV_NAME" python=3.13 -y
fi
PYTHON="$(conda run -n "$ENV_NAME" python -c 'import sys; print(sys.executable)')"
echo "Using: $PYTHON"

step "4/6 pip install requirements"
conda run -n "$ENV_NAME" pip install -r "$REPO_DIR/requirements.txt" \
  || { echo "ERROR: pip install failed. On Windows, tree-sitter needs a C compiler (install VS Build Tools) — or run this setup inside WSL instead."; exit 1; }

step "5/6 Build tree-sitter language libs"
(cd "$REPO_DIR/lib" && conda run -n "$ENV_NAME" python build.py) \
  || { echo "ERROR: tree-sitter build failed. Fallback: run RepoAudit under WSL."; exit 1; }

step "6/6 Smoke scan (toy Python project, claude-code backend)"
command -v claude >/dev/null || { echo "ERROR: claude CLI not on PATH."; exit 1; }
(cd "$REPO_DIR/src" && REPOAUDIT_CLI_MODEL="${REPOAUDIT_CLI_MODEL:-haiku}" conda run -n "$ENV_NAME" python repoaudit.py \
  --language Python --model-name claude-code --scan-type dfbscan --bug-type NPD \
  --project-path "$REPO_DIR/benchmark/Python/toy" \
  --temperature 0.0 --call-depth 1 --max-neural-workers 2) \
  || { echo "ERROR: smoke scan failed — inspect output above."; exit 1; }

cat > "$STATE_FILE" <<EOF
{ "pinned_sha": "$PINNED_SHA", "env": "$ENV_NAME", "patched": true, "smoke_scan": "passed" }
EOF
echo ""
echo "ccaudit setup complete. RepoAudit at $REPO_DIR (env: $ENV_NAME)."
