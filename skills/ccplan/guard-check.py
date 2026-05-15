#!/usr/bin/env python3
"""Feature Guard Checker for ccplan ECL documents.

Scans docs/ecl/*.yaml for feature_guard sections and checks whether a given
file is protected by any active guard. Usable as:

  CLI:   python guard-check.py src/auth/oauth.ts
  Hook:  python guard-check.py --hook  (reads tool input JSON from stdin)
  List:  python guard-check.py --all
  Test:  python guard-check.py --verify

Ships with the ccplan skill. No external dependencies beyond Python 3.10+.
Uses PyYAML if available, falls back to regex-based parsing.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Optional dependency: PyYAML (checked once at import time)
# ---------------------------------------------------------------------------

try:
    import yaml as _yaml  # type: ignore[import-untyped]
except ImportError:
    _yaml = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Pre-compiled regex patterns for the ECL fallback parser
# ---------------------------------------------------------------------------

_RE_QUOTED_ITEM = re.compile(r'-\s*"([^"]*)"')
_RE_UNQUOTED_ITEM = re.compile(r'-\s+([^"\s][^\n]*)')
_RE_FEATURE = re.compile(r'^feature:\s*"?([^"\n]+)"?', re.MULTILINE)
_RE_STATUS = re.compile(r'^status:\s*"?([^"\n]+)"?', re.MULTILINE)
_RE_GUARD_START = re.compile(r'^feature_guard:\s*$', re.MULTILINE)
_RE_GUARD_SPLIT = re.compile(r'(?=\s+- id:\s)')
_RE_DESC = re.compile(r'description:\s*"([^"]*)"')
_RE_CMD = re.compile(r'command:\s*"([^"]*)"')


# ---------------------------------------------------------------------------
# Project root detection
# ---------------------------------------------------------------------------

def find_project_root() -> Path:
    """Walk up from cwd to find the nearest .git directory."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".git").exists():
            return parent
    return current


def find_ecl_files(root: Path) -> list[Path]:
    """Return all ECL YAML files under docs/ecl/, deduplicated."""
    ecl_dir = root / "docs" / "ecl"
    if not ecl_dir.exists():
        return []
    # Deduplicate on resolved path (handles case-insensitive filesystems)
    seen: dict[Path, Path] = {}
    for pattern in ("*.yaml", "*.yml"):
        for f in ecl_dir.glob(pattern):
            seen.setdefault(f.resolve(), f)
    return sorted(seen.values())


# ---------------------------------------------------------------------------
# YAML parsing (PyYAML → regex fallback)
# ---------------------------------------------------------------------------

def parse_yaml(path: Path) -> dict[str, Any] | None:
    """Parse a YAML file, preferring PyYAML with regex fallback."""
    text = path.read_text(encoding="utf-8")
    if _yaml is not None:
        return _yaml.safe_load(text)
    return _regex_parse(text)


def _extract_list_items(section: str) -> list[str]:
    """Extract YAML list items — both quoted and unquoted forms."""
    quoted = _RE_QUOTED_ITEM.findall(section)
    unquoted = [m.strip() for m in _RE_UNQUOTED_ITEM.findall(section)]
    return quoted + unquoted


def _extract_between(text: str, start_key: str, end_keys: tuple[str, ...]) -> str | None:
    """Extract text between start_key and the first occurring end_key."""
    if start_key not in text:
        return None
    section = text.split(start_key, 1)[1]
    for ek in end_keys:
        if ek in section:
            section = section.split(ek, 1)[0]
            break
    return section


def _regex_parse(text: str) -> dict[str, Any]:
    """Extract feature name + feature_guard section via regex.

    Best-effort fallback for the structured ECL YAML format only. Limitations:
    - Does not handle YAML block scalars (| or >)
    - Does not strip inline comments (# ...)
    - Assumes consistent space-based indentation
    Use PyYAML when available for full correctness.
    """
    feature_m = _RE_FEATURE.search(text)
    feature_name = feature_m.group(1).strip().strip('"') if feature_m else "unknown"

    status_m = _RE_STATUS.search(text)
    ecl_status = status_m.group(1).strip().strip('"') if status_m else "unknown"

    guard_start = _RE_GUARD_START.search(text)
    if not guard_start:
        return {"feature": feature_name, "status": ecl_status}

    # Grab everything indented under feature_guard until next top-level key
    rest = text[guard_start.end():]
    section_lines: list[str] = []
    for line in rest.split("\n"):
        if line and not line[0].isspace() and line.strip():
            break
        section_lines.append(line)
    section_text = "\n".join(section_lines)

    guards: list[dict[str, Any]] = []
    for block in _RE_GUARD_SPLIT.split(section_text):
        if "id:" not in block:
            continue
        guard: dict[str, Any] = {}

        for key in ("id", "feature", "status"):
            m = re.search(rf"{key}:\s*(.+)", block)
            if m:
                guard[key] = m.group(1).strip().strip('"')

        desc_m = _RE_DESC.search(block)
        if desc_m:
            guard["description"] = desc_m.group(1)

        if kf_text := _extract_between(block, "key_files:", ("invariants:", "verification:", "status:", "history:")):
            guard["key_files"] = _extract_list_items(kf_text)

        if inv_text := _extract_between(block, "invariants:", ("verification:", "status:", "history:")):
            guard["invariants"] = _extract_list_items(inv_text)

        ver_m = _RE_CMD.search(block)
        if ver_m:
            guard["verification"] = {"command": ver_m.group(1)}

        if guard.get("id"):
            guards.append(guard)

    return {
        "feature": feature_name,
        "status": ecl_status,
        "feature_guard": {"guards": guards} if guards else None,
    }


# ---------------------------------------------------------------------------
# Guard matching
# ---------------------------------------------------------------------------

def _normalize(path_str: str, root: Path) -> str:
    """Normalize a path to forward-slash relative form, resolving '..' segments."""
    p = Path(path_str).resolve()
    root_resolved = root.resolve()
    try:
        p = p.relative_to(root_resolved)
    except ValueError:
        # Outside project root — return as-is (won't match any guard)
        return str(Path(path_str)).replace("\\", "/")
    return str(p).replace("\\", "/")


def check_file_guards(
    file_path: str, ecl_files: list[Path], root: Path
) -> list[dict[str, Any]]:
    """Return all active guards whose key_files match *file_path*."""
    norm = _normalize(file_path, root)
    matched: list[dict[str, Any]] = []

    for ecl_path in ecl_files:
        data = parse_yaml(ecl_path)
        if not data or not data.get("feature_guard"):
            continue
        for guard in data["feature_guard"].get("guards", []):
            if guard.get("status", "active") != "active":
                continue
            for kf in guard.get("key_files", []):
                kf_norm = kf.replace("\\", "/")
                # Support exact match, suffix match, prefix (directory) match,
                # and glob/wildcard patterns (e.g. "src/auth/*.ts")
                is_match = (
                    norm == kf_norm
                    or norm.endswith("/" + kf_norm)
                    or norm.startswith(kf_norm.rstrip("/") + "/")
                    or fnmatch(norm, kf_norm)
                )
                if is_match:
                    matched.append({
                        "ecl_file": str(ecl_path.relative_to(root)),
                        "guard_id": guard.get("id", "?"),
                        "feature": guard.get("feature", "?"),
                        "description": guard.get("description", ""),
                        "invariants": guard.get("invariants", []),
                        "verification": guard.get("verification", {}),
                    })
                    break
    return matched


def get_all_guards(ecl_files: list[Path], root: Path) -> list[dict[str, Any]]:
    """Collect all guards across every ECL file (returns copies, no mutation)."""
    result: list[dict[str, Any]] = []
    for ecl_path in ecl_files:
        data = parse_yaml(ecl_path)
        if not data or not data.get("feature_guard"):
            continue
        fname = data.get("feature", "unknown")
        for guard in data["feature_guard"].get("guards", []):
            entry = {
                **guard,
                "_ecl_file": str(ecl_path.relative_to(root)),
                "_feature_name": fname,
            }
            result.append(entry)
    return result


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def fmt_warning(guards: list[dict[str, Any]], file_path: str) -> str:
    """Format a human-readable warning for guarded file modifications."""
    lines = [
        f"⚠️  FEATURE GUARD: {file_path} is protected by "
        f"{len(guards)} guard(s)\n"
    ]
    for g in guards:
        lines.append(
            f"  [{g['guard_id']}] {g['description']} "
            f"(feature: {g['feature']})"
        )
        lines.append(f"  ECL: {g['ecl_file']}")
        if g.get("invariants"):
            lines.append("  Invariants that MUST be preserved:")
            for inv in g["invariants"]:
                lines.append(f"    - {inv}")
        cmd = g.get("verification", {}).get("command")
        if cmd:
            lines.append(f"  Verify after edit: {cmd}")
        lines.append("")
    return "\n".join(lines)


def fmt_all(guards: list[dict[str, Any]]) -> str:
    """Format a summary of all guards grouped by status."""
    if not guards:
        return "No feature guards found in docs/ecl/."

    by_status: dict[str, list[dict[str, Any]]] = {
        "active": [], "suspended": [], "retired": [],
    }
    for g in guards:
        by_status.get(g.get("status", "active"), by_status["active"]).append(g)
    active, suspended, retired = (
        by_status["active"], by_status["suspended"], by_status["retired"],
    )

    lines = [
        f"Feature Guards: {len(active)} active, "
        f"{len(suspended)} suspended, {len(retired)} retired\n"
    ]
    for g in active:
        gid = g.get("id", "?")
        desc = g.get("description", "")
        feat = g.get("_feature_name", "")
        lines.append(f"  [{gid}] {desc} — {feat}")
        kf = g.get("key_files", [])
        if kf:
            lines.append(f"    Files: {', '.join(kf)}")
        inv = g.get("invariants", [])
        if inv:
            lines.append(f"    Invariants: {len(inv)}")
        cmd = g.get("verification", {}).get("command")
        if cmd:
            lines.append(f"    Verify: {cmd}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------

def run_hook() -> None:
    """PreToolUse hook mode: read tool input JSON from stdin.

    Outputs guard warnings to stderr so they appear in Claude Code's context
    without interfering with structured tool output.
    """
    try:
        raw = sys.stdin.read()
        tool_input = json.loads(raw)
    except json.JSONDecodeError:
        return  # malformed input — don't block the tool call
    except Exception as exc:
        print(f"guard-check hook error: {exc}", file=sys.stderr)
        return

    file_path = tool_input.get("input", {}).get("file_path", "")
    if not file_path:
        return

    root = find_project_root()
    ecl_files = find_ecl_files(root)
    if not ecl_files:
        return

    guards = check_file_guards(file_path, ecl_files, root)
    if guards:
        print(fmt_warning(guards, file_path), file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Check ccplan feature guards for file protection"
    )
    parser.add_argument("file_path", nargs="?", help="File path to check")
    parser.add_argument("--all", action="store_true", help="Show all guards")
    parser.add_argument("--verify", action="store_true", help="Run verifications")
    parser.add_argument("--hook", action="store_true", help="Hook mode (stdin JSON)")
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()

    if args.hook:
        run_hook()
        return

    root = find_project_root()
    ecl_files = find_ecl_files(root)

    if not ecl_files:
        print("No ECL files found in docs/ecl/. Run /ccplan to create one.")
        return

    # Lazy-load guards once, shared across --all and --verify
    _cached_guards: list[dict[str, Any]] | None = None

    def _guards() -> list[dict[str, Any]]:
        nonlocal _cached_guards
        if _cached_guards is None:
            _cached_guards = get_all_guards(ecl_files, root)
        return _cached_guards

    if args.all or (not args.file_path and not args.verify):
        if args.json:
            print(json.dumps(_guards(), indent=2, ensure_ascii=False))
        else:
            print(fmt_all(_guards()))

    if args.verify:
        active = [g for g in _guards() if g.get("status", "active") == "active"]
        if not active:
            print("No active guards to verify.")
            return

        # Collect commands and show them before execution
        commands = [
            (g.get("id", "?"), g.get("verification", {}).get("command"))
            for g in active
            if g.get("verification", {}).get("command")
        ]
        if not commands:
            print("No verification commands found in active guards.")
            return

        print("The following commands will be executed:\n")
        for gid, cmd in commands:
            print(f"  [{gid}] {cmd}")
        print()

        # Non-interactive mode (e.g. CI) skips confirmation
        if sys.stdin.isatty():
            confirm = input("Run these commands? [y/N] ").strip().lower()
            if confirm not in ("y", "yes"):
                print("Aborted.")
                return

        print("Running verification commands...\n")
        passed = failed = 0
        for gid, cmd in commands:
            print(f"  [{gid}] {cmd}")
            result = subprocess.run(
                cmd, shell=True, cwd=root,
                capture_output=True, text=True,
            )
            if result.returncode == 0:
                print("    ✓ PASS")
                passed += 1
            else:
                print("    ✗ FAIL")
                failed += 1
                for line in result.stderr.strip().split("\n")[:5]:
                    print(f"    {line}")
            print()
        print(f"Results: {passed} passed, {failed} failed")
        return

    if args.file_path:
        guards = check_file_guards(args.file_path, ecl_files, root)
        if args.json:
            print(json.dumps(guards, indent=2, ensure_ascii=False))
        elif guards:
            print(fmt_warning(guards, args.file_path))
        else:
            print(f"No guards protect {args.file_path}")


if __name__ == "__main__":
    main()
