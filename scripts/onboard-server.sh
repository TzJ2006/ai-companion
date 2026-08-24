#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/onboard-server.sh --host USER@HOST --public-key PATH \
  --companion-repo REPOSITORY --project REMOTE_PATH [options]

Provision one remote server from this machine.

Required:
  --host USER@HOST                 Existing remote account (password login is fine on first run)
  --public-key PATH                SSH public key to add with ssh-copy-id
  --companion-repo REPOSITORY      The ai-companion Git repository (e.g. git@github.com:TzJ2006/ai-companion.git)
  --project REMOTE_PATH            Existing remote project to configure

Claude Platform on AWS (auto-discovered from ~/.claude/settings.json when omitted):
  --aws-region REGION              Claude Platform on AWS region
  --anthropic-workspace-id ID      Claude Platform on AWS workspace ID

Optional:
  --port PORT                      SSH port (default: 22)
  --bootstrap-identity PATH        Existing private key for the initial SSH connection
  --companion-ref REF              Branch, tag, or commit to clone
  --no-sudo                        Target host without sudo: skip apt-get and require that
                                   curl and git already exist on the remote.
  --copy-secrets                   Copy local ~/.aws/{config,credentials} and ~/.codex/auth.json
                                   to the remote (chmod 600). Needed for hosts with no AWS IAM
                                   role. WARNING: long-lived plaintext credentials land on the
                                   remote machine; only use on hosts you trust.
  --dry-run                        Validate arguments and print actions without connecting
  --help                           Show this message

On an AWS EC2 host with an IAM role, omit --copy-secrets: Claude Code uses the instance role and
Codex authentication remains `codex login`. On other hosts (no IAM role, no sudo) pass both
--copy-secrets and --no-sudo to replicate local credentials and skip system package installs.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

HOST=""
PUBLIC_KEY=""
AWS_REGION=""
WORKSPACE_ID=""
COMPANION_REPO=""
COMPANION_REF=""
PROJECT=""
PORT="22"
BOOTSTRAP_IDENTITY=""
DRY_RUN=0
NO_SUDO=0
COPY_SECRETS=0

LOCAL_CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
LOCAL_AWS_CONFIG="${HOME}/.aws/config"
LOCAL_AWS_CREDENTIALS="${HOME}/.aws/credentials"
LOCAL_CODEX_AUTH="${HOME}/.codex/auth.json"

while (($#)); do
  case "$1" in
    --host|--public-key|--aws-region|--anthropic-workspace-id|--companion-repo|--companion-ref|--project|--port|--bootstrap-identity)
      (($# >= 2)) || die "$1 requires a value"
      case "$1" in
        --host) HOST="$2" ;;
        --public-key) PUBLIC_KEY="$2" ;;
        --aws-region) AWS_REGION="$2" ;;
        --anthropic-workspace-id) WORKSPACE_ID="$2" ;;
        --companion-repo) COMPANION_REPO="$2" ;;
        --companion-ref) COMPANION_REF="$2" ;;
        --project) PROJECT="$2" ;;
        --port) PORT="$2" ;;
        --bootstrap-identity) BOOTSTRAP_IDENTITY="$2" ;;
      esac
      shift 2
      ;;
    --no-sudo) NO_SUDO=1; shift ;;
    --copy-secrets) COPY_SECRETS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

# Auto-discover Claude Platform on AWS settings from the local Claude config when not supplied.
discover_local_env() {
  local key="$1"
  [[ -r "$LOCAL_CLAUDE_SETTINGS" ]] || return 1
  command -v python3 >/dev/null || return 1
  python3 - "$LOCAL_CLAUDE_SETTINGS" "$key" <<'PY' 2>/dev/null
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
value = (data.get("env") or {}).get(sys.argv[2])
if not value:
    sys.exit(1)
print(value)
PY
}

if [[ -z "$AWS_REGION" ]]; then
  AWS_REGION="$(discover_local_env AWS_REGION || true)"
  [[ -n "$AWS_REGION" ]] && printf 'Discovered AWS region from %s: %s\n' "$LOCAL_CLAUDE_SETTINGS" "$AWS_REGION"
fi
if [[ -z "$WORKSPACE_ID" ]]; then
  WORKSPACE_ID="$(discover_local_env ANTHROPIC_AWS_WORKSPACE_ID || true)"
  [[ -n "$WORKSPACE_ID" ]] && printf 'Discovered workspace ID from %s: %s\n' "$LOCAL_CLAUDE_SETTINGS" "$WORKSPACE_ID"
fi

for required in HOST PUBLIC_KEY COMPANION_REPO PROJECT; do
  [[ -n "${!required}" ]] || die "--${required,,} is required"
done
[[ -n "$AWS_REGION" ]] || die "--aws-region is required (or set it in $LOCAL_CLAUDE_SETTINGS)"
[[ -n "$WORKSPACE_ID" ]] || die "--anthropic-workspace-id is required (or set it in $LOCAL_CLAUDE_SETTINGS)"
[[ "$HOST" == *@* ]] || die "--host must include the remote user (for example ubuntu@example.com)"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be numeric"
[[ -r "$PUBLIC_KEY" ]] || die "SSH public key is not readable: $PUBLIC_KEY"
if [[ -n "$BOOTSTRAP_IDENTITY" ]]; then
  [[ -r "$BOOTSTRAP_IDENTITY" ]] || die "bootstrap identity is not readable: $BOOTSTRAP_IDENTITY"
fi
if ((COPY_SECRETS)); then
  for secret in "$LOCAL_AWS_CONFIG" "$LOCAL_AWS_CREDENTIALS" "$LOCAL_CODEX_AUTH"; do
    [[ -r "$secret" ]] || die "--copy-secrets needs a readable local file: $secret"
  done
fi
command -v ssh >/dev/null || die "ssh is required on the local machine"
command -v ssh-copy-id >/dev/null || die "ssh-copy-id is required on the local machine"
if ((COPY_SECRETS)); then
  command -v scp >/dev/null || die "scp is required on the local machine for --copy-secrets"
fi

ssh_options=(-p "$PORT")
scp_options=(-P "$PORT")
if [[ -n "$BOOTSTRAP_IDENTITY" ]]; then
  ssh_options+=(-i "$BOOTSTRAP_IDENTITY")
  scp_options+=(-i "$BOOTSTRAP_IDENTITY")
fi

if ((DRY_RUN)); then
  printf '[dry-run] add %q to %q with ssh-copy-id (password prompt on first connect)\n' "$PUBLIC_KEY" "$HOST"
  if ((COPY_SECRETS)); then
    printf '[dry-run] copy %q, %q and %q to %q (chmod 600)\n' \
      "$LOCAL_AWS_CONFIG" "$LOCAL_AWS_CREDENTIALS" "$LOCAL_CODEX_AUTH" "$HOST"
  fi
  if ((NO_SUDO)); then
    printf '[dry-run] skip apt-get; require curl and git already present on %q\n' "$HOST"
  else
    printf '[dry-run] sudo apt-get install base packages on %q\n' "$HOST"
  fi
  printf '[dry-run] configure Claude Platform on AWS in %q (workspace %q)\n' "$AWS_REGION" "$WORKSPACE_ID"
  printf '[dry-run] clone %q and configure AI Companion in %q\n' "$COMPANION_REPO" "$PROJECT"
  printf '[dry-run] no SSH connection or remote change was made\n'
  exit 0
fi

printf 'Adding SSH public key to %s...\n' "$HOST"
printf 'You may be prompted for the SSH password of %s now (one time, to install your key).\n' "$HOST"
ssh-copy-id -i "$PUBLIC_KEY" "${ssh_options[@]}" "$HOST"

if ((COPY_SECRETS)); then
  printf 'Copying local credentials to %s...\n' "$HOST"
  ssh "${ssh_options[@]}" "$HOST" 'mkdir -p ~/.aws ~/.codex ~/.claude && chmod 700 ~/.aws ~/.codex'
  scp "${scp_options[@]}" "$LOCAL_AWS_CONFIG" "$LOCAL_AWS_CREDENTIALS" "$HOST:.aws/"
  scp "${scp_options[@]}" "$LOCAL_CODEX_AUTH" "$HOST:.codex/"
  ssh "${ssh_options[@]}" "$HOST" 'chmod 600 ~/.aws/config ~/.aws/credentials ~/.codex/auth.json'
fi

printf 'Configuring %s...\n' "$HOST"
# Pass values as a safely-quoted preamble instead of ssh command-line args:
# ssh re-splits a joined command string on the remote, which drops empty
# arguments (for example an unset --companion-ref) and mangles spaces.
{
  printf 'set -euo pipefail\n'
  printf 'aws_region=%q\n' "$AWS_REGION"
  printf 'workspace_id=%q\n' "$WORKSPACE_ID"
  printf 'companion_repo=%q\n' "$COMPANION_REPO"
  printf 'companion_ref=%q\n' "$COMPANION_REF"
  printf 'project_path=%q\n' "$PROJECT"
  printf 'no_sudo=%q\n' "$NO_SUDO"
  printf 'copy_secrets=%q\n' "$COPY_SECRETS"
  cat <<'REMOTE'
. /etc/os-release
if [[ "$no_sudo" != "1" ]]; then
  [[ "$ID" == "ubuntu" ]] || { echo "error: Ubuntu is required, found $ID" >&2; exit 1; }
  case "$VERSION_ID" in
    22.04|24.04) ;;
    *) echo "error: Ubuntu 22.04 or 24.04 is required, found $VERSION_ID" >&2; exit 1 ;;
  esac
fi
[[ -d "$project_path" ]] || { echo "error: project path does not exist: $project_path" >&2; exit 1; }

if [[ "$no_sudo" == "1" ]]; then
  for tool in curl git; do
    command -v "$tool" >/dev/null || { echo "error: $tool is required on the remote host but is missing (no sudo to install it)" >&2; exit 1; }
  done
else
  sudo apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git awscli
fi

export NVM_DIR="$HOME/.nvm"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
. "$NVM_DIR/nvm.sh"
if ! nvm which 22 >/dev/null 2>&1; then
  nvm install 22
fi
nvm alias default 22

export PATH="$HOME/.local/bin:$PATH"
if ! command -v claude >/dev/null; then
  curl -fsSL https://claude.ai/install.sh | bash
fi
export PATH="$HOME/.local/bin:$PATH"
command -v claude >/dev/null

if ! command -v codex >/dev/null; then
  npm install -g @openai/codex
fi
command -v codex >/dev/null

mkdir -p "$HOME/.claude"
node - "$HOME/.claude/settings.json" "$workspace_id" "$aws_region" <<'NODE'
const fs = require("node:fs");
const [settingsPath, workspaceId, region] = process.argv.slice(2);
let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}
settings.env ??= {};
settings.env.CLAUDE_CODE_USE_ANTHROPIC_AWS = "1";
settings.env.ANTHROPIC_AWS_WORKSPACE_ID = workspaceId;
settings.env.AWS_REGION = region;
delete settings.env.CLAUDE_CODE_USE_BEDROCK;
delete settings.env.CLAUDE_CODE_USE_FOUNDRY;
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
NODE

plugin_installed() {
  local command="$1"
  local name="$2"
  "$command" plugin list --json | node -e '
    const name = process.argv[1];
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const plugins = Array.isArray(data) ? data : data.installed ?? [];
    process.exit(plugins.some((plugin) =>
      (plugin.name ?? plugin.id?.split("@")[0]) === name && plugin.enabled
    ) ? 0 : 1);
  ' "$name"
}

install_claude_plugin() {
  local name="$1"
  local selector="$2"
  local source="${3:-}"
  if plugin_installed claude "$name"; then return; fi
  if ! claude plugin install "$selector" --scope user; then
    [[ -n "$source" ]] || { echo "SKIP: Claude plugin $name is unavailable"; return; }
    claude plugin marketplace add "$source" || { echo "SKIP: Claude marketplace for $name is unavailable"; return; }
    claude plugin install "$selector" --scope user || echo "SKIP: Claude plugin $name is unavailable"
  fi
}

install_codex_plugin() {
  local name="$1"
  local marketplace="$2"
  local source="$3"
  if plugin_installed codex "$name"; then return; fi
  if ! codex plugin marketplace list --json | node -e '
    const name = process.argv[1];
    const marketplaces = JSON.parse(require("fs").readFileSync(0, "utf8")).marketplaces ?? [];
    process.exit(marketplaces.some((marketplace) => marketplace.name === name) ? 0 : 1);
  ' "$marketplace"; then
    codex plugin marketplace add "$source" || { echo "SKIP: Codex marketplace for $name is unavailable"; return; }
  fi
  codex plugin add "$name" --marketplace "$marketplace" || echo "SKIP: Codex plugin $name is unavailable"
}

install_claude_plugin superpowers superpowers@claude-plugins-official
install_claude_plugin ponytail ponytail@ponytail DietrichGebert/ponytail
install_codex_plugin superpowers superpowers obra/superpowers
install_codex_plugin ponytail ponytail https://github.com/DietrichGebert/ponytail.git

# Auto-accept GitHub's host key on first contact (the remote shell is non-interactive)
# and let an SSH URL authenticate through a forwarded agent (see ssh -A below).
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o StrictHostKeyChecking=accept-new}"
companion_root="$HOME/.local/share/ai-companion-source"
if [[ -d "$companion_root/.git" ]]; then
  if [[ -n "$companion_ref" ]]; then
    git -C "$companion_root" fetch --depth 1 origin "$companion_ref"
    git -C "$companion_root" checkout --detach FETCH_HEAD
  else
    git -C "$companion_root" pull --ff-only
  fi
else
  rm -rf "$companion_root"  # clear any partial clone left by a previous failed run
  clone_args=(clone --depth 1)
  [[ -n "$companion_ref" ]] && clone_args+=(--branch "$companion_ref")
  git "${clone_args[@]}" "$companion_repo" "$companion_root"
fi

companion_path="$companion_root"
[[ -f "$companion_path/package.json" ]] || { echo "error: $companion_repo is not an ai-companion repo (no package.json at clone root)" >&2; exit 1; }
(
  cd "$companion_path"
  npm ci
  npm run build
  npx tsx scripts/install.ts "$project_path" --enforce
)

if command -v aws >/dev/null; then
  aws sts get-caller-identity >/dev/null || echo "WARN: aws sts get-caller-identity failed; verify the copied credentials"
else
  echo "NOTE: aws CLI is not installed on the remote; skipping STS verification"
fi
claude --version
codex --version
node - "$HOME/.claude/settings.json" "$project_path/.codex/hooks.json" "$workspace_id" "$aws_region" <<'NODE'
const fs = require("node:fs");
const [settingsPath, hooksPath, workspaceId, region] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
if (settings.env?.CLAUDE_CODE_USE_ANTHROPIC_AWS !== "1" ||
    settings.env?.ANTHROPIC_AWS_WORKSPACE_ID !== workspaceId ||
    settings.env?.AWS_REGION !== region ||
    settings.env?.CLAUDE_CODE_USE_BEDROCK || settings.env?.CLAUDE_CODE_USE_FOUNDRY) {
  throw new Error("Claude Platform on AWS settings are incomplete or conflicting");
}
const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
if (!hooks.hooks?.PreToolUse || !hooks.hooks?.PostToolUse) {
  throw new Error("AI Companion Codex hooks are missing");
}
NODE

if [[ "$copy_secrets" == "1" ]]; then
  echo "Onboarding complete. Local AWS and Codex credentials were copied to this host."
else
  echo "Onboarding complete. Run 'codex login' manually, then review and trust plugin lifecycle hooks when Codex asks."
fi
REMOTE
} | ssh -A "${ssh_options[@]}" "$HOST" bash -s
