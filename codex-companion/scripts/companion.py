#!/usr/bin/env python3
"""Zero-dependency Idea Graph tooling for Codex Companion."""

from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import html
import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Iterable


AGENT = "codex"
STATE_DIR = ".codex-companion"
AGENT_STATE_DIR = f"{STATE_DIR}.{AGENT}"
PROJECT_SCHEMA = "idea-graph/v1"
NODE_SCHEMA = "idea-node/v1"
STATUSES = (
    "draft",
    "aligned",
    "planned",
    "approved",
    "implementing",
    "blocked",
    "done",
    "superseded",
)
TRANSITIONS = {
    "draft": {"aligned", "blocked", "superseded"},
    "aligned": {"draft", "planned", "blocked", "superseded"},
    "planned": {"aligned", "approved", "blocked", "superseded"},
    "approved": {"planned", "implementing", "blocked", "superseded"},
    "implementing": {"approved", "blocked", "done"},
    "blocked": {"draft", "aligned", "planned", "approved", "implementing", "superseded"},
    "done": {"blocked", "superseded"},
    "superseded": {"draft"},
}
REQUIRED_NODE_KEYS = (
    "schema_version",
    "id",
    "name",
    "status",
    "what",
    "why",
    "expected_result",
    "implementation",
    "code_refs",
    "verification",
    "future_use",
    "depends_on",
    "inputs",
    "outputs",
    "created_at",
    "updated_at",
)
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
PATCH_PATH_PATTERN = re.compile(
    r"^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$", re.MULTILINE
)
PATCH_OPERATION_PATTERN = re.compile(
    r"^\*\*\* (Add|Update|Delete) File: (.+?)\s*$", re.MULTILINE
)
PROTECTED_NODE_PATCH_PATTERN = re.compile(
    r'^[+-]\s*"(?:schema_version|id|status|created_at)"\s*:', re.MULTILINE
)
APPROVAL_PATTERN = re.compile(r"^\s*(APPROVE|REJECT)\s+([A-Z0-9-]+)\s*$", re.IGNORECASE)
MUTATING_SHELL_PATTERN = re.compile(
    r"(?:^|[\s;&|])(?:rm|del|erase|rmdir|mv|move|cp|copy|tee|touch)\b"
    r"|(?:^|[\s;&|])(?:sed|perl)\s+-[^\r\n]*i"
    r"|(?:^|[\s;&|])git\s+(?:apply|checkout|clean|commit|merge|mv|reset|restore|revert)\b"
    r"|(?:^|[\s;&|])(?:npm|pnpm|yarn|pip|pip3|poetry)\s+(?:add|install|remove|uninstall|update)\b"
    r"|(?:^|[\s;&|])(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item)\b"
    r"|(?:^|[\s;&|])(?:python|python3|py|node|ruby)\s+(?:-c|-e)\b"
    r"|(?:^|[^<])(?:>>|>)(?!=)",
    re.IGNORECASE,
)
COMPANION_CLI_PATTERN = re.compile(
    r"^\s*&?\s*(?:\"[^\"]*python(?:3)?(?:\.exe)?\"|python3?|python|py)\s+"
    r"(?:\"[^\"]*companion\.py\"|'[^']*companion\.py'|\S*companion\.py)\s+"
    r"(?:init|new|validate|status|set-status|activate|deactivate|record|request-approval|"
    r"run-check|scan|reviewed|render)(?:\s|$)[^;&|>]*$",
    re.IGNORECASE,
)
SCRIPTING_SHELL_PATTERN = re.compile(
    r"^\s*&?\s*(?:python3?|py|node|npx|tsx|ruby|bash|sh|pwsh|powershell|cmd|npm|pnpm|yarn)\b",
    re.IGNORECASE,
)
APPROVAL_GATES = ("intent", "decomposition", "plan", "red-waiver", "manual-check")


class CompanionError(RuntimeError):
    pass


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def agent_suffixed_path(path: Path, agent: str = AGENT) -> Path:
    """Insert an agent suffix before the extension, or append it to a dotfile."""
    dot = path.name.rfind(".")
    name = (
        f"{path.name[:dot]}.{agent}{path.name[dot:]}"
        if dot > 0
        else f"{path.name}.{agent}"
    )
    return path.with_name(name)


def project_owner(path: Path) -> str | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    owner = value.get("agent")
    if isinstance(owner, str):
        return owner
    return AGENT if value.get("schema_version") == PROJECT_SCHEMA else None


def state_path(root: Path) -> Path:
    """Claim the plain state name, or use the sticky agent suffix on collision."""
    plain = root / STATE_DIR
    suffixed = root / AGENT_STATE_DIR
    if (suffixed / "project.json").is_file():
        return suffixed
    project_file = plain / "project.json"
    if project_file.is_file():
        return plain if project_owner(project_file) == AGENT else suffixed
    try:
        occupied = plain.exists() and any(plain.iterdir())
    except OSError:
        occupied = True
    return suffixed if occupied else plain


def is_managed_state_path(relative: str) -> bool:
    normalized = relative.replace("\\", "/")
    return any(
        normalized == name or normalized.startswith(f"{name}/")
        for name in (STATE_DIR, AGENT_STATE_DIR)
    )


def file_owned_by_agent(path: Path) -> bool:
    try:
        return f'name="ai-companion-agent" content="{AGENT}"' in path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return False


def find_root(start: str | Path = ".", require: bool = True) -> Path:
    candidate = Path(start).resolve()
    if candidate.is_file():
        candidate = candidate.parent
    for directory in (candidate, *candidate.parents):
        if (state_path(directory) / "project.json").is_file():
            return directory
    if require:
        raise CompanionError(
            f"No Codex Companion project found from {candidate}; run `companion.py init`."
        )
    return candidate


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CompanionError(f"Cannot read {path}: {error}") from error
    if not isinstance(value, dict):
        raise CompanionError(f"{path} must contain a JSON object.")
    return value


def load_project(root: Path) -> dict[str, Any]:
    project = load_json(state_path(root) / "project.json")
    if project.get("schema_version") != PROJECT_SCHEMA:
        raise CompanionError(
            f"Unsupported project schema: {project.get('schema_version')!r}."
        )
    return project


def strict_mode(root: Path) -> bool:
    try:
        enforcement = load_project(root).get("enforcement", {})
    except CompanionError:
        return False
    return isinstance(enforcement, dict) and enforcement.get("mode") == "strict"


def load_nodes(root: Path) -> tuple[dict[str, dict[str, Any]], list[str]]:
    nodes: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    for path in sorted((state_path(root) / "nodes").glob("*.json")):
        try:
            node = load_json(path)
        except CompanionError as error:
            errors.append(str(error))
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            errors.append(f"{path}: id must be a non-empty string.")
            continue
        if node_id in nodes:
            errors.append(f"{path}: duplicate node id {node_id!r}.")
            continue
        if path.stem != node_id:
            errors.append(f"{path}: filename must be {node_id}.json.")
        nodes[node_id] = node
    return nodes, errors


def blank_node(node_id: str, name: str) -> dict[str, Any]:
    timestamp = now()
    return {
        "schema_version": NODE_SCHEMA,
        "id": node_id,
        "name": name,
        "status": "draft",
        "what": "",
        "why": "",
        "expected_result": "",
        "implementation": {
            "how": "",
            "why_this_way": "",
            "target_paths": [],
            "research": {
                "local_findings": [],
                "external_findings": [],
                "reuse_decision": "",
            },
            "weekly_plan": [],
        },
        "code_refs": [],
        "verification": [],
        "future_use": "",
        "depends_on": [],
        "inputs": [],
        "outputs": [],
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_node_shape(node: dict[str, Any], root: Path) -> list[str]:
    node_id = str(node.get("id", "<unknown>"))
    errors: list[str] = []
    missing = [key for key in REQUIRED_NODE_KEYS if key not in node]
    if missing:
        errors.append(f"{node_id}: missing keys: {', '.join(missing)}")
    if node.get("schema_version") != NODE_SCHEMA:
        errors.append(f"{node_id}: schema_version must be {NODE_SCHEMA!r}.")
    if not ID_PATTERN.fullmatch(node_id):
        errors.append(f"{node_id}: id must match {ID_PATTERN.pattern}.")
    if not nonempty(node.get("name")):
        errors.append(f"{node_id}: name must be non-empty.")
    if node.get("status") not in STATUSES:
        errors.append(f"{node_id}: invalid status {node.get('status')!r}.")
    for key in ("what", "why", "expected_result", "future_use"):
        if key in node and not isinstance(node[key], str):
            errors.append(f"{node_id}: {key} must be a string.")
    implementation = node.get("implementation")
    if not isinstance(implementation, dict):
        errors.append(f"{node_id}: implementation must be an object.")
    else:
        for key in ("how", "why_this_way", "target_paths", "research", "weekly_plan"):
            if key not in implementation:
                errors.append(f"{node_id}: implementation.{key} is required.")
        if not isinstance(implementation.get("target_paths"), list):
            errors.append(f"{node_id}: implementation.target_paths must be an array.")
        elif any(not nonempty(path) for path in implementation["target_paths"]):
            errors.append(f"{node_id}: implementation.target_paths must contain path strings.")
        if "weekly_plan" in implementation and not isinstance(
            implementation["weekly_plan"], list
        ):
            errors.append(f"{node_id}: implementation.weekly_plan must be an array.")
        elif isinstance(implementation.get("weekly_plan"), list):
            for index, item in enumerate(implementation["weekly_plan"]):
                if not isinstance(item, dict) or not nonempty(item.get("outcome")):
                    errors.append(
                        f"{node_id}: implementation.weekly_plan[{index}] needs an outcome."
                    )
        research = implementation.get("research")
        if not isinstance(research, dict):
            errors.append(f"{node_id}: implementation.research must be an object.")
        else:
            for key in ("local_findings", "external_findings"):
                if not isinstance(research.get(key), list):
                    errors.append(f"{node_id}: implementation.research.{key} must be an array.")
            if not isinstance(research.get("reuse_decision"), str):
                errors.append(
                    f"{node_id}: implementation.research.reuse_decision must be a string."
                )
    for key in ("code_refs", "verification", "depends_on", "inputs", "outputs"):
        if key in node and not isinstance(node[key], list):
            errors.append(f"{node_id}: {key} must be an array.")
    for index, ref in enumerate(node.get("code_refs", [])):
        if not isinstance(ref, dict):
            errors.append(f"{node_id}: code_refs[{index}] must be an object.")
            continue
        path_value = ref.get("path")
        start_line = ref.get("start_line")
        end_line = ref.get("end_line")
        if not nonempty(path_value):
            errors.append(f"{node_id}: code_refs[{index}].path is required.")
        elif Path(path_value).is_absolute():
            errors.append(f"{node_id}: code_refs[{index}].path must be project-relative.")
        if not isinstance(start_line, int) or start_line < 1:
            errors.append(f"{node_id}: code_refs[{index}].start_line must be >= 1.")
        if not isinstance(end_line, int) or not isinstance(start_line, int) or end_line < start_line:
            errors.append(f"{node_id}: code_refs[{index}].end_line must be >= start_line.")
        if not nonempty(ref.get("role")):
            errors.append(f"{node_id}: code_refs[{index}].role is required.")
        if nonempty(path_value):
            referenced = (root / path_value).resolve()
            try:
                referenced.relative_to(root)
            except ValueError:
                errors.append(f"{node_id}: code_refs[{index}] escapes the project root.")
                continue
            if node.get("status") == "done":
                if not referenced.is_file():
                    errors.append(f"{node_id}: code_refs[{index}] does not exist: {path_value}.")
                elif isinstance(end_line, int):
                    try:
                        data = referenced.read_bytes()
                        line_count = 0 if not data else data.count(b"\n") + (
                            0 if data.endswith(b"\n") else 1
                        )
                        if end_line > line_count:
                            errors.append(
                                f"{node_id}: code_refs[{index}].end_line={end_line} exceeds "
                                f"{path_value} line count {line_count}."
                            )
                    except OSError as error:
                        errors.append(f"{node_id}: cannot inspect {path_value}: {error}")
    for index, check in enumerate(node.get("verification", [])):
        if not isinstance(check, dict):
            errors.append(f"{node_id}: verification[{index}] must be an object.")
            continue
        if not nonempty(check.get("id")):
            errors.append(f"{node_id}: verification[{index}].id is required.")
        if check.get("kind") not in ("automated", "manual"):
            errors.append(
                f"{node_id}: verification[{index}].kind must be automated or manual."
            )
        if not nonempty(check.get("plan")):
            errors.append(f"{node_id}: verification[{index}].plan is required.")
        if check.get("status") not in ("pending", "passed", "failed"):
            errors.append(
                f"{node_id}: verification[{index}].status must be pending, passed, or failed."
            )
        if not isinstance(check.get("evidence"), list):
            errors.append(f"{node_id}: verification[{index}].evidence must be an array.")
        test_paths = check.get("test_paths")
        if not isinstance(test_paths, list):
            errors.append(f"{node_id}: verification[{index}].test_paths must be an array.")
        elif check.get("kind") == "automated" and (
            not test_paths or any(not nonempty(path) for path in test_paths)
        ):
            errors.append(
                f"{node_id}: automated verification[{index}] needs test_paths."
            )
        command = check.get("command")
        if check.get("kind") == "automated" and not (
            nonempty(command)
            or (
                isinstance(command, list)
                and bool(command)
                and all(nonempty(part) for part in command)
            )
        ):
            errors.append(
                f"{node_id}: automated verification[{index}] needs a command string or argv array."
            )
    return errors


def readiness_gaps(
    node: dict[str, Any], nodes: dict[str, dict[str, Any]], target_status: str | None = None
) -> list[str]:
    status = target_status or str(node.get("status", "draft"))
    rank = {
        "draft": 0,
        "aligned": 1,
        "planned": 2,
        "approved": 3,
        "implementing": 4,
        "blocked": 4,
        "done": 5,
        "superseded": 0,
    }[status]
    gaps: list[str] = []
    if rank >= 1:
        for key in ("what", "why", "expected_result"):
            if not nonempty(node.get(key)):
                gaps.append(key)
    implementation = node.get("implementation", {})
    if rank >= 2:
        if not nonempty(implementation.get("how")):
            gaps.append("implementation.how")
        if not nonempty(implementation.get("why_this_way")):
            gaps.append("implementation.why_this_way")
        if not implementation.get("target_paths"):
            gaps.append("implementation.target_paths")
        research = implementation.get("research", {})
        if not isinstance(research, dict) or not nonempty(research.get("reuse_decision")):
            gaps.append("implementation.research.reuse_decision")
        elif not research.get("local_findings"):
            gaps.append("implementation.research.local_findings")
        elif not research.get("external_findings"):
            gaps.append("implementation.research.external_findings")
        if not implementation.get("weekly_plan"):
            gaps.append("implementation.weekly_plan")
        if not node.get("verification"):
            gaps.append("verification")
        if not nonempty(node.get("future_use")):
            gaps.append("future_use")
        for key in ("inputs", "outputs"):
            if not node.get(key):
                gaps.append(key)
    if rank >= 4:
        unfinished = [dep for dep in node.get("depends_on", []) if nodes.get(dep, {}).get("status") != "done"]
        if unfinished:
            gaps.append(f"unfinished prerequisites: {', '.join(unfinished)}")
    if rank >= 5:
        if not node.get("code_refs"):
            gaps.append("code_refs")
        verification = node.get("verification", [])
        if not verification or any(item.get("status") != "passed" for item in verification):
            gaps.append("all verification items must have status=passed")
        elif any(not item.get("evidence") for item in verification):
            gaps.append("all passed verification items must include evidence")
    return gaps


def graph_errors(nodes: dict[str, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for node_id, node in nodes.items():
        dependencies = node.get("depends_on", [])
        if not isinstance(dependencies, list):
            continue
        for dependency in dependencies:
            if dependency == node_id:
                errors.append(f"{node_id}: a node cannot depend on itself.")
            elif dependency not in nodes:
                errors.append(f"{node_id}: unknown prerequisite {dependency!r}.")
        if len(dependencies) != len(set(dependencies)):
            errors.append(f"{node_id}: depends_on contains duplicates.")
    if not errors:
        _, cycle_nodes = topological_order(nodes)
        if cycle_nodes:
            errors.append(f"Dependency cycle includes: {', '.join(cycle_nodes)}")
    return errors


def topological_order(
    nodes: dict[str, dict[str, Any]],
) -> tuple[list[str], list[str]]:
    indegree = {node_id: 0 for node_id in nodes}
    dependents: dict[str, list[str]] = defaultdict(list)
    for node_id, node in nodes.items():
        for dependency in node.get("depends_on", []):
            if dependency in nodes:
                indegree[node_id] += 1
                dependents[dependency].append(node_id)
    ready = deque(sorted(node_id for node_id, degree in indegree.items() if degree == 0))
    ordered: list[str] = []
    while ready:
        node_id = ready.popleft()
        ordered.append(node_id)
        for dependent in sorted(dependents[node_id]):
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                ready.append(dependent)
    cycle_nodes = sorted(node_id for node_id, degree in indegree.items() if degree)
    return ordered, cycle_nodes


def reverse_dependencies(nodes: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {node_id: [] for node_id in nodes}
    for node_id, node in nodes.items():
        for dependency in node.get("depends_on", []):
            if dependency in result:
                result[dependency].append(node_id)
    return {key: sorted(value) for key, value in result.items()}


def digest_json(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def node_plan_snapshot(node: dict[str, Any]) -> dict[str, Any]:
    checks = []
    for check in node.get("verification", []):
        if isinstance(check, dict):
            checks.append(
                {
                    key: check.get(key)
                    for key in ("id", "kind", "plan", "command", "test_paths")
                }
            )
    return {
        key: node.get(key)
        for key in (
            "id",
            "name",
            "what",
            "why",
            "expected_result",
            "implementation",
            "future_use",
            "depends_on",
            "inputs",
            "outputs",
        )
    } | {"verification": checks}


def graph_structure_snapshot(nodes: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": node_id,
            "name": nodes[node_id].get("name"),
            "depends_on": nodes[node_id].get("depends_on", []),
        }
        for node_id in sorted(nodes)
    ]


def graph_digest(nodes: dict[str, dict[str, Any]]) -> str:
    return digest_json([nodes[node_id] for node_id in sorted(nodes)])


def approval_snapshot(
    gate: str,
    nodes: dict[str, dict[str, Any]],
    node_ids: list[str],
    check_id: str | None = None,
) -> str:
    if gate == "decomposition":
        value: Any = graph_structure_snapshot(nodes)
    elif gate == "intent":
        value = [
            {
                key: nodes[node_id].get(key)
                for key in ("id", "name", "what", "why", "expected_result")
            }
            for node_id in sorted(node_ids)
        ]
    elif gate == "manual-check":
        if len(node_ids) != 1 or not check_id:
            raise CompanionError("manual-check approval requires one node and --check.")
        check = get_check(nodes[node_ids[0]], check_id)
        value = {
            "node": node_plan_snapshot(nodes[node_ids[0]]),
            "check": check,
        }
    else:
        value = [node_plan_snapshot(nodes[node_id]) for node_id in sorted(node_ids)]
        if check_id:
            value = {"nodes": value, "check_id": check_id}
    return digest_json({"gate": gate, "value": value})


def get_check(node: dict[str, Any], check_id: str) -> dict[str, Any]:
    for check in node.get("verification", []):
        if isinstance(check, dict) and check.get("id") == check_id:
            return check
    raise CompanionError(f"Unknown verification check {check_id!r} in {node.get('id')!r}.")


def approval_directories(root: Path) -> tuple[Path, Path]:
    state = state_path(root)
    return state / "pending", state / "approvals"


def valid_approval(
    root: Path,
    gate: str,
    node_ids: list[str],
    check_id: str | None = None,
) -> dict[str, Any] | None:
    nodes, errors = load_nodes(root)
    if errors or any(node_id not in nodes for node_id in node_ids):
        return None
    try:
        expected = approval_snapshot(gate, nodes, node_ids, check_id)
    except CompanionError:
        return None
    _, approvals = approval_directories(root)
    for path in sorted(approvals.glob("*.json"), reverse=True):
        try:
            receipt = load_json(path)
        except CompanionError:
            continue
        if (
            receipt.get("decision") == "approved"
            and receipt.get("gate") == gate
            and sorted(receipt.get("node_ids", [])) == sorted(node_ids)
            and receipt.get("check_id") == check_id
            and receipt.get("snapshot") == expected
        ):
            return receipt
    return None


def has_pending_approval(root: Path) -> bool:
    pending, _ = approval_directories(root)
    return any(pending.glob("*.json"))


def runtime_path(root: Path, node_id: str) -> Path:
    return state_path(root) / "runtime" / f"{node_id}.json"


def load_runtime(root: Path, node_id: str) -> dict[str, Any]:
    path = runtime_path(root, node_id)
    if path.exists():
        runtime = load_json(path)
    else:
        runtime = {
            "node_id": node_id,
            "change_seq": 0,
            "recorded_seq": 0,
            "checks": {},
        }
    runtime.setdefault("change_seq", 0)
    runtime.setdefault("recorded_seq", 0)
    runtime.setdefault("checks", {})
    return runtime


def save_runtime(root: Path, runtime: dict[str, Any]) -> None:
    atomic_write(runtime_path(root, str(runtime["node_id"])), json_text(runtime))


def normalized_relative(root: Path, value: str) -> str | None:
    path = Path(value)
    resolved = path.resolve() if path.is_absolute() else (root / path).resolve()
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError:
        return None


def path_matches(path: str, patterns: Iterable[str]) -> bool:
    normalized = path.replace("\\", "/")
    return any(
        normalized == pattern.replace("\\", "/")
        or fnmatch.fnmatchcase(normalized, pattern.replace("\\", "/"))
        for pattern in patterns
    )


def expand_paths(root: Path, patterns: Iterable[str]) -> list[Path]:
    result: set[Path] = set()
    for pattern in patterns:
        if Path(pattern).is_absolute() or ".." in Path(pattern).parts:
            raise CompanionError(f"Managed path must be project-relative: {pattern}")
        matches = list(root.glob(pattern)) if any(char in pattern for char in "*?[") else [root / pattern]
        for path in matches:
            resolved = path.resolve()
            try:
                resolved.relative_to(root)
            except ValueError as error:
                raise CompanionError(f"Managed path escapes the project root: {pattern}") from error
            if resolved.is_file():
                result.add(resolved)
    return sorted(result)


def path_hashes(root: Path, patterns: Iterable[str]) -> dict[str, str]:
    paths = expand_paths(root, patterns)
    return {
        path.relative_to(root).as_posix(): file_digest(path.read_bytes())
        for path in paths
    }


def red_gate_ready(root: Path, node: dict[str, Any]) -> tuple[bool, str]:
    automated = [check for check in node.get("verification", []) if check.get("kind") == "automated"]
    if not automated:
        receipt = valid_approval(root, "red-waiver", [node["id"]])
        return (receipt is not None, "manual-only node needs a red-waiver approval")
    runtime = load_runtime(root, node["id"])
    for check in automated:
        evidence = runtime["checks"].get(check["id"], {}).get("red")
        if not evidence:
            return False, f"run red phase for {check['id']}"
        current_hashes = path_hashes(root, check.get("test_paths", []))
        if not current_hashes or evidence.get("test_hashes") != current_hashes:
            return False, f"red evidence for {check['id']} is stale"
        if evidence.get("outcome") == "unexpected_pass" and not valid_approval(
            root, "red-waiver", [node["id"]], check["id"]
        ):
            return False, f"{check['id']} unexpectedly passed; request a red-waiver approval"
        if evidence.get("outcome") not in ("failed_as_expected", "unexpected_pass"):
            return False, f"red evidence for {check['id']} is invalid"
    return True, ""


def execution_gaps(root: Path, node: dict[str, Any]) -> list[str]:
    gaps: list[str] = []
    runtime = load_runtime(root, node["id"])
    for check in node.get("verification", []):
        if check.get("kind") == "automated":
            evidence = runtime["checks"].get(check["id"], {}).get("green")
            current_hashes = path_hashes(root, check.get("test_paths", []))
            if not evidence or evidence.get("outcome") != "passed":
                gaps.append(f"green verification missing for {check['id']}")
            elif evidence.get("change_seq") != runtime["change_seq"]:
                gaps.append(f"green verification stale for {check['id']}")
            elif evidence.get("test_hashes") != current_hashes or not current_hashes:
                gaps.append(f"test files changed after green verification for {check['id']}")
        elif check.get("status") != "passed" or not check.get("evidence"):
            gaps.append(f"manual verification not approved for {check.get('id')}")
    if runtime["recorded_seq"] != runtime["change_seq"]:
        gaps.append("semantic record is stale")
    return gaps


def active_node_id(root: Path) -> str | None:
    path = state_path(root) / "active.json"
    return load_json(path).get("node_id") if path.exists() else None


def update_node_status(
    root: Path,
    node: dict[str, Any],
    target: str,
    approval: dict[str, Any] | None = None,
) -> None:
    previous = node["status"]
    node["status"] = target
    node["updated_at"] = now()
    atomic_write(state_path(root) / "nodes" / f"{node['id']}.json", json_text(node))
    append_log(
        root,
        {
            "kind": "idea.status_changed",
            "node_id": node["id"],
            "summary": f"Status changed from {previous} to {target}.",
            "before": previous,
            "after": target,
            "approval_id": approval.get("challenge") if approval else None,
        },
    )


def append_log(root: Path, event: dict[str, Any]) -> None:
    event = {"timestamp": now(), **event}
    log_path = state_path(root) / "log.ndjson"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")


def command_init(args: argparse.Namespace) -> None:
    root = Path(args.root).resolve()
    state = state_path(root)
    project_file = state / "project.json"
    if project_file.exists():
        raise CompanionError(f"{project_file} already exists.")
    if state.exists():
        try:
            occupied = not state.is_dir() or any(state.iterdir())
        except OSError:
            occupied = True
        if occupied:
            raise CompanionError(f"{state} is also occupied; refusing to overwrite it.")
    for directory in (
        state / "nodes",
        state / "reports",
        state / "runtime",
        state / "pending",
        state / "approvals",
    ):
        directory.mkdir(parents=True, exist_ok=True)
    project = {
        "schema_version": PROJECT_SCHEMA,
        "agent": AGENT,
        "project": {"name": args.name or root.name, "root": "."},
        "nodes_dir": "nodes",
        "report": "reports/idea-graph.html",
        "log": "log.ndjson",
        "coverage": "coverage.json",
        "enforcement": {
            "mode": "strict",
            "test_first": True,
            "scope_paths": True,
            "stop_checks": True,
        },
        "created_at": now(),
    }
    atomic_write(project_file, json_text(project))
    append_log(root, {"kind": "project.initialized", "summary": "Initialized Codex Companion."})
    print(f"Initialized {state}")


def command_new(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    if not ID_PATTERN.fullmatch(args.id):
        raise CompanionError(f"id must match {ID_PATTERN.pattern}.")
    path = state_path(root) / "nodes" / f"{args.id}.json"
    if path.exists():
        raise CompanionError(f"Node {args.id!r} already exists.")
    atomic_write(path, json_text(blank_node(args.id, args.name)))
    append_log(
        root,
        {"kind": "idea.created", "node_id": args.id, "summary": f"Created idea: {args.name}"},
    )
    print(path)


def collect_validation(root: Path) -> tuple[dict[str, dict[str, Any]], list[str]]:
    load_project(root)
    nodes, errors = load_nodes(root)
    for node in nodes.values():
        errors.extend(validate_node_shape(node, root))
    errors.extend(graph_errors(nodes))
    for node_id, node in nodes.items():
        gaps = readiness_gaps(node, nodes)
        if gaps and node.get("status") not in ("draft", "superseded"):
            errors.append(
                f"{node_id}: status={node.get('status')} readiness gaps: {', '.join(gaps)}"
            )
    return nodes, errors


def command_validate(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    nodes, errors = collect_validation(root)
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        raise CompanionError(f"Validation failed with {len(errors)} error(s).")
    print(f"Valid {PROJECT_SCHEMA}: {len(nodes)} node(s), acyclic graph.")


def command_set_status(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    nodes, errors = collect_validation(root)
    fatal = [error for error in errors if "readiness gaps" not in error]
    if fatal:
        raise CompanionError("Fix graph validation errors before changing status.")
    if args.id not in nodes:
        raise CompanionError(f"Unknown node {args.id!r}.")
    node = nodes[args.id]
    previous = node["status"]
    if args.status == previous:
        raise CompanionError(f"Node is already {args.status}.")
    if args.status not in TRANSITIONS[previous]:
        raise CompanionError(f"Invalid lifecycle transition: {previous} -> {args.status}.")
    if args.status in ("aligned", "approved"):
        raise CompanionError(
            f"Direct {args.status} transitions are forbidden; use request-approval."
        )
    if strict_mode(root) and args.status == "planned" and not valid_approval(
        root, "decomposition", sorted(nodes)
    ):
        raise CompanionError("Planning requires a current decomposition approval receipt.")
    if strict_mode(root) and args.status == "implementing":
        if active_node_id(root) != args.id:
            raise CompanionError("Activate this approved node before setting implementing.")
        if not valid_approval(root, "plan", [args.id]):
            raise CompanionError("Implementation requires a current plan approval receipt.")
    gaps = readiness_gaps(node, nodes, args.status)
    if gaps and args.status not in ("draft", "blocked", "superseded"):
        raise CompanionError(f"Cannot set {args.status}: {', '.join(gaps)}")
    target_shape_errors = validate_node_shape({**node, "status": args.status}, root)
    if target_shape_errors:
        raise CompanionError(
            "Cannot apply target status: " + "; ".join(target_shape_errors)
        )
    if strict_mode(root) and args.status == "done":
        if active_node_id(root) != args.id:
            raise CompanionError("Done requires this node to remain active.")
        if not valid_approval(root, "plan", [args.id]):
            raise CompanionError("Done requires a current plan approval receipt.")
        execution = execution_gaps(root, node)
        if execution:
            raise CompanionError("Cannot set done: " + ", ".join(execution))
    update_node_status(root, node, args.status)
    print(f"{args.id}: {previous} -> {args.status}")


def command_activate(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    nodes, errors = load_nodes(root)
    if errors:
        raise CompanionError("Cannot activate while node files are invalid.")
    if args.id not in nodes:
        raise CompanionError(f"Unknown node {args.id!r}.")
    if strict_mode(root):
        node = nodes[args.id]
        if node.get("status") != "approved":
            raise CompanionError("Strict mode activates only approved nodes.")
        if not valid_approval(root, "plan", [args.id]):
            raise CompanionError("The node's plan approval is missing or stale.")
        gaps = readiness_gaps(node, nodes, "implementing")
        if gaps:
            raise CompanionError("Cannot activate: " + ", ".join(gaps))
        existing = active_node_id(root)
        if existing and existing != args.id:
            raise CompanionError(f"Node {existing!r} is already active.")
    active_path = state_path(root) / "active.json"
    atomic_write(active_path, json_text({"node_id": args.id, "activated_at": now()}))
    append_log(
        root,
        {"kind": "idea.activated", "node_id": args.id, "summary": "Activated idea."},
    )
    print(f"Active idea: {args.id}")


def command_deactivate(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    active_path = state_path(root) / "active.json"
    active = load_json(active_path) if active_path.exists() else {}
    if strict_mode(root) and active.get("node_id"):
        nodes, _ = load_nodes(root)
        node = nodes.get(active["node_id"], {})
        if node.get("status") not in ("done", "blocked", "superseded"):
            raise CompanionError("An active node may be deactivated only when done or blocked.")
        if node.get("status") == "done":
            report_state = state_path(root) / "runtime" / "project.json"
            rendered = load_json(report_state).get("graph_digest") if report_state.exists() else None
            if rendered != graph_digest(nodes):
                raise CompanionError("Render the current graph before deactivating a done node.")
    if active_path.exists():
        active_path.unlink()
    append_log(
        root,
        {
            "kind": "idea.deactivated",
            "node_id": active.get("node_id"),
            "summary": "Deactivated idea.",
        },
    )
    print("No active idea.")


def command_record(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    event: dict[str, Any] = {"kind": args.kind, "summary": args.summary}
    if args.node:
        event["node_id"] = args.node
    if args.file:
        event["files"] = args.file
    if args.details:
        event["details"] = args.details
    if args.node and strict_mode(root):
        nodes, _ = load_nodes(root)
        if args.node not in nodes:
            raise CompanionError(f"Unknown node {args.node!r}.")
        runtime = load_runtime(root, args.node)
        runtime["recorded_seq"] = runtime["change_seq"]
        runtime["recorded_at"] = now()
        save_runtime(root, runtime)
    append_log(root, event)
    print("Recorded.")


def command_request_approval(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    nodes, errors = load_nodes(root)
    if errors:
        raise CompanionError("Fix node errors before requesting approval.")
    node_ids = sorted(set(args.node or []))
    if not node_ids:
        raise CompanionError("At least one --node is required.")
    unknown = [node_id for node_id in node_ids if node_id not in nodes]
    if unknown:
        raise CompanionError("Unknown nodes: " + ", ".join(unknown))
    if args.gate == "intent" and any(nodes[node_id]["status"] != "draft" for node_id in node_ids):
        raise CompanionError("Intent approval applies only to draft nodes.")
    if args.gate == "intent":
        gaps = [
            f"{node_id}: {', '.join(readiness_gaps(nodes[node_id], nodes, 'aligned'))}"
            for node_id in node_ids
            if readiness_gaps(nodes[node_id], nodes, "aligned")
        ]
        if gaps:
            raise CompanionError("Intent is incomplete: " + "; ".join(gaps))
    if args.gate == "plan" and any(nodes[node_id]["status"] != "planned" for node_id in node_ids):
        raise CompanionError("Plan approval applies only to planned nodes.")
    if args.gate == "plan":
        gaps = [
            f"{node_id}: {', '.join(readiness_gaps(nodes[node_id], nodes, 'approved'))}"
            for node_id in node_ids
            if readiness_gaps(nodes[node_id], nodes, "approved")
        ]
        if gaps:
            raise CompanionError("Plan is incomplete: " + "; ".join(gaps))
    if args.gate == "decomposition" and node_ids != sorted(nodes):
        raise CompanionError("Decomposition approval must include every graph node.")
    if args.gate == "manual-check":
        if len(node_ids) != 1:
            raise CompanionError("manual-check approval requires exactly one node.")
        check = get_check(nodes[node_ids[0]], args.check or "")
        if check.get("kind") != "manual":
            raise CompanionError("manual-check gate requires a manual verification item.")
    if args.gate == "red-waiver" and args.check:
        if len(node_ids) != 1:
            raise CompanionError("A check-specific red waiver requires exactly one node.")
        get_check(nodes[node_ids[0]], args.check)
    snapshot = approval_snapshot(args.gate, nodes, node_ids, args.check)
    pending_dir, _ = approval_directories(root)
    challenge = f"CC-{secrets.token_hex(4).upper()}"
    request = {
        "schema_version": "approval-request/v1",
        "challenge": challenge,
        "gate": args.gate,
        "node_ids": node_ids,
        "check_id": args.check,
        "snapshot": snapshot,
        "requested_at": now(),
    }
    atomic_write(pending_dir / f"{challenge}.json", json_text(request))
    append_log(
        root,
        {
            "kind": "approval.requested",
            "summary": f"Requested {args.gate} approval for {', '.join(node_ids)}.",
            "node_ids": node_ids,
            "challenge": challenge,
        },
    )
    print(f"User review required. Reply exactly: APPROVE {challenge}")
    print(f"To reject, reply exactly: REJECT {challenge}")


def apply_approval(root: Path, event: dict[str, Any]) -> bool:
    prompt = event.get("prompt")
    match = APPROVAL_PATTERN.fullmatch(prompt) if isinstance(prompt, str) else None
    if not match:
        return False
    decision, challenge = match.group(1).upper(), match.group(2).upper()
    pending_dir, approvals_dir = approval_directories(root)
    request_path = pending_dir / f"{challenge}.json"
    if not request_path.exists():
        raise CompanionError(f"Approval challenge {challenge} is unknown or already used.")
    request = load_json(request_path)
    nodes, errors = load_nodes(root)
    if errors:
        raise CompanionError("Cannot approve while node files are invalid.")
    current = approval_snapshot(
        request["gate"], nodes, request["node_ids"], request.get("check_id")
    )
    if current != request.get("snapshot"):
        request_path.unlink()
        raise CompanionError("Approval request is stale because its reviewed content changed.")
    receipt = {
        **request,
        "schema_version": "approval-receipt/v1",
        "decision": "approved" if decision == "APPROVE" else "rejected",
        "responded_at": now(),
        "session_id": event.get("session_id"),
        "turn_id": event.get("turn_id"),
        "prompt_sha256": file_digest(prompt.encode("utf-8")),
    }
    atomic_write(approvals_dir / f"{challenge}.json", json_text(receipt))
    request_path.unlink()
    if decision == "APPROVE":
        if request["gate"] == "intent":
            for node_id in request["node_ids"]:
                update_node_status(root, nodes[node_id], "aligned", receipt)
        elif request["gate"] == "plan":
            for node_id in request["node_ids"]:
                update_node_status(root, nodes[node_id], "approved", receipt)
        elif request["gate"] == "manual-check":
            node = nodes[request["node_ids"][0]]
            check = get_check(node, request["check_id"])
            check["status"] = "passed"
            check["evidence"] = [f"User approved {challenge} in Codex prompt."]
            node["updated_at"] = now()
            atomic_write(
                state_path(root) / "nodes" / f"{node['id']}.json", json_text(node)
            )
    append_log(
        root,
        {
            "kind": f"approval.{receipt['decision']}",
            "summary": f"{request['gate']} review {receipt['decision']}.",
            "node_ids": request["node_ids"],
            "challenge": challenge,
        },
    )
    return True


def command_run_check(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    nodes, errors = load_nodes(root)
    if errors or args.id not in nodes:
        raise CompanionError(f"Unknown or invalid node {args.id!r}.")
    node = nodes[args.id]
    if node.get("status") != "implementing" or active_node_id(root) != args.id:
        raise CompanionError("Checks run only for the active implementing node.")
    if not valid_approval(root, "plan", [args.id]):
        raise CompanionError("The node's plan approval is missing or stale.")
    check = get_check(node, args.check)
    if check.get("kind") != "automated":
        raise CompanionError("run-check executes automated checks only.")
    test_hashes = path_hashes(root, check.get("test_paths", []))
    if not test_hashes:
        raise CompanionError("No test files matched this check's test_paths.")
    command = check.get("command")
    argv = shlex.split(command, posix=os.name != "nt") if isinstance(command, str) else list(command)
    executable = shutil.which(argv[0])
    if not executable:
        raise CompanionError(f"Verification executable not found: {argv[0]}")
    result = subprocess.run(
        [executable, *argv[1:]],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=args.timeout,
        check=False,
    )
    runtime = load_runtime(root, args.id)
    evidence = {
        "outcome": "passed" if result.returncode == 0 else "failed",
        "exit_code": result.returncode,
        "test_hashes": test_hashes,
        "at": now(),
        "stdout_tail": result.stdout[-2000:],
        "stderr_tail": result.stderr[-2000:],
    }
    check_runtime = runtime["checks"].setdefault(args.check, {})
    if args.phase == "red":
        evidence["outcome"] = "failed_as_expected" if result.returncode != 0 else "unexpected_pass"
        check_runtime["red"] = evidence
        check_runtime.pop("green", None)
    else:
        ready, reason = red_gate_ready(root, node)
        if not ready:
            raise CompanionError(f"Green phase blocked: {reason}.")
        evidence["change_seq"] = runtime["change_seq"]
        check_runtime["green"] = evidence
        check["status"] = "passed" if result.returncode == 0 else "failed"
        check["evidence"] = [
            f"{now()} exit={result.returncode}; tests={', '.join(sorted(test_hashes))}"
        ]
        node["updated_at"] = now()
        atomic_write(state_path(root) / "nodes" / f"{args.id}.json", json_text(node))
    save_runtime(root, runtime)
    append_log(
        root,
        {
            "kind": f"verification.{args.phase}",
            "node_id": args.id,
            "summary": f"{args.phase} check {args.check}: {evidence['outcome']}.",
            "exit_code": result.returncode,
        },
    )
    print(f"{args.phase} {args.id}/{args.check}: {evidence['outcome']} (exit {result.returncode})")
    if args.phase == "green" and result.returncode != 0:
        raise CompanionError("Green verification failed; enter debugging.")


def git_files(root: Path) -> list[Path] | None:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return [root / os.fsdecode(item) for item in result.stdout.split(b"\0") if item]


def fallback_files(root: Path) -> list[Path]:
    excluded = {
        ".git",
        STATE_DIR,
        AGENT_STATE_DIR,
        "node_modules",
        "vendor",
        "dist",
        "build",
    }
    files: list[Path] = []
    for directory, names, filenames in os.walk(root):
        names[:] = [name for name in names if name not in excluded]
        files.extend(Path(directory) / filename for filename in filenames)
    return files


def file_digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def command_scan(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    coverage_path = state_path(root) / "coverage.json"
    previous: dict[str, Any] = load_json(coverage_path) if coverage_path.exists() else {}
    reviewed_by_digest = {
        (item.get("path"), item.get("sha256")): item.get("reviewed_at")
        for item in previous.get("included", [])
        if item.get("reviewed_at")
    }
    candidates = git_files(root)
    source = "git tracked + unignored files"
    if candidates is None:
        candidates = fallback_files(root)
        source = "filesystem fallback with dependency/build directories excluded"
    included: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for path in sorted(set(candidates)):
        try:
            relative = path.resolve().relative_to(root).as_posix()
        except (OSError, ValueError):
            continue
        if is_managed_state_path(relative):
            continue
        try:
            data = path.read_bytes()
        except OSError as error:
            skipped.append({"path": relative, "reason": f"unreadable: {error}"})
            continue
        if b"\0" in data[:8192]:
            skipped.append({"path": relative, "reason": "binary (NUL byte detected)"})
            continue
        digest = file_digest(data)
        entry: dict[str, Any] = {
            "path": relative,
            "bytes": len(data),
            "lines": 0 if not data else data.count(b"\n") + (0 if data.endswith(b"\n") else 1),
            "sha256": digest,
            "reviewed_at": reviewed_by_digest.get((relative, digest)),
        }
        included.append(entry)
    coverage = {
        "schema_version": "onboarding-coverage/v1",
        "generated_at": now(),
        "scope": source,
        "included": included,
        "skipped": skipped,
    }
    atomic_write(coverage_path, json_text(coverage))
    append_log(
        root,
        {
            "kind": "onboarding.scanned",
            "summary": f"Scanned {len(included)} text files; skipped {len(skipped)} files.",
        },
    )
    unread = sum(not item["reviewed_at"] for item in included)
    print(f"Coverage: {len(included)} text, {len(skipped)} skipped, {unread} unreviewed.")


def command_reviewed(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    coverage_path = state_path(root) / "coverage.json"
    coverage = load_json(coverage_path)
    requested = {Path(path).as_posix() for path in args.paths}
    found: set[str] = set()
    timestamp = now()
    for item in coverage.get("included", []):
        if item.get("path") in requested:
            item["reviewed_at"] = timestamp
            found.add(item["path"])
    missing = sorted(requested - found)
    if missing:
        raise CompanionError(f"Paths are not in coverage: {', '.join(missing)}")
    coverage["updated_at"] = timestamp
    atomic_write(coverage_path, json_text(coverage))
    append_log(
        root,
        {
            "kind": "onboarding.files_reviewed",
            "summary": f"Reviewed {len(found)} file(s).",
            "files": sorted(found),
        },
    )
    print(f"Marked {len(found)} file(s) reviewed.")


def command_status(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    nodes, errors = collect_validation(root)
    if errors:
        for error in errors:
            print(f"ERROR {error}")
    ordered, cycle = topological_order(nodes)
    reverse = reverse_dependencies(nodes)
    print(f"Idea Graph: {len(nodes)} node(s)")
    for node_id in ordered + cycle:
        node = nodes[node_id]
        dependencies = node.get("depends_on", [])
        ready = all(nodes.get(dep, {}).get("status") == "done" for dep in dependencies)
        marker = "READY" if ready and node.get("status") in ("approved", "implementing") else "-"
        print(f"{marker:5} {node.get('status', '?'):12} {node_id}: {node.get('name', '')}")
        if args.verbose:
            print(f"      prerequisites={dependencies} dependents={reverse.get(node_id, [])}")
    coverage_path = state_path(root) / "coverage.json"
    if coverage_path.exists():
        coverage = load_json(coverage_path)
        unread = [item["path"] for item in coverage.get("included", []) if not item.get("reviewed_at")]
        print(f"Onboarding coverage: {len(unread)} unreviewed file(s).")
    if errors:
        raise CompanionError(f"Graph has {len(errors)} validation error(s).")


def graph_layout(nodes: dict[str, dict[str, Any]]) -> tuple[dict[str, tuple[int, int]], int, int]:
    ordered, cycle = topological_order(nodes)
    sequence = ordered + cycle
    levels: dict[str, int] = {}
    for node_id in sequence:
        dependencies = [dep for dep in nodes[node_id].get("depends_on", []) if dep in levels]
        levels[node_id] = 0 if not dependencies else max(levels[dep] for dep in dependencies) + 1
    by_level: dict[int, list[str]] = defaultdict(list)
    for node_id in sequence:
        by_level[levels[node_id]].append(node_id)
    card_width, card_height = 220, 68
    gap_x, gap_y, margin = 90, 60, 40
    max_rows = max((len(items) for items in by_level.values()), default=1)
    positions: dict[str, tuple[int, int]] = {}
    for level, items in by_level.items():
        column_height = len(items) * card_height + max(0, len(items) - 1) * gap_y
        total_height = max_rows * card_height + max(0, max_rows - 1) * gap_y
        offset = (total_height - column_height) // 2
        for row, node_id in enumerate(items):
            positions[node_id] = (
                margin + level * (card_width + gap_x),
                margin + offset + row * (card_height + gap_y),
            )
    width = margin * 2 + max(1, len(by_level)) * card_width + max(0, len(by_level) - 1) * gap_x
    height = margin * 2 + max_rows * card_height + max(0, max_rows - 1) * gap_y
    return positions, width, height


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def text_block(value: Any) -> str:
    if isinstance(value, list):
        if not value:
            return '<span class="empty">Not recorded</span>'
        return "<ul>" + "".join(f"<li>{esc(item)}</li>" for item in value) + "</ul>"
    if not nonempty(value):
        return '<span class="empty">Not recorded</span>'
    return "<p>" + esc(value).replace("\n", "<br>") + "</p>"


def relation_links(ids: Iterable[str], nodes: dict[str, dict[str, Any]]) -> str:
    values = list(ids)
    if not values:
        return '<span class="empty">None</span>'
    return " ".join(
        f'<button class="relation" data-open="{esc(node_id)}">{esc(nodes.get(node_id, {}).get("name", node_id))}</button>'
        for node_id in values
    )


def detail_html(
    node_id: str, node: dict[str, Any], nodes: dict[str, dict[str, Any]], reverse: dict[str, list[str]]
) -> str:
    implementation = node.get("implementation", {})
    research = implementation.get("research", {})
    refs = node.get("code_refs", [])
    refs_html = '<span class="empty">Not recorded</span>'
    if refs:
        refs_html = "<ul>" + "".join(
            f"<li><code>{esc(ref.get('path', ''))}:{esc(ref.get('start_line', '?'))}-{esc(ref.get('end_line', '?'))}</code> {esc(ref.get('symbol', ''))} {esc(ref.get('role', ''))}</li>"
            for ref in refs
        ) + "</ul>"
    checks = node.get("verification", [])
    checks_html = '<span class="empty">Not recorded</span>'
    if checks:
        checks_html = "<ul>" + "".join(
            f"<li><strong>{esc(check.get('id', check.get('kind', 'check')))}</strong> "
            f"<span class=\"pill\">{esc(check.get('status', 'pending'))}</span> "
            f"{esc(check.get('plan', ''))}"
            + (f"<br><code>{esc(check.get('command'))}</code>" if check.get("command") else "")
            + f"<br><small>Test paths: {esc(', '.join(check.get('test_paths', [])) or 'none')}</small>"
            + (f"<br><small>Evidence: {esc('; '.join(check.get('evidence', [])))}</small>" if check.get("evidence") else "")
            + "</li>"
            for check in checks
        ) + "</ul>"
    weekly = implementation.get("weekly_plan", [])
    weekly_html = '<span class="empty">Not recorded</span>'
    if weekly:
        weekly_html = "<ol>" + "".join(
            f"<li><strong>{esc(item.get('week', index + 1) if isinstance(item, dict) else index + 1)}</strong>: "
            f"{esc(item.get('outcome', item) if isinstance(item, dict) else item)}</li>"
            for index, item in enumerate(weekly)
        ) + "</ol>"
    external = research.get("external_findings", []) if isinstance(research, dict) else []
    local = research.get("local_findings", []) if isinstance(research, dict) else []
    reuse = research.get("reuse_decision", "") if isinstance(research, dict) else ""
    return f"""
    <article class="detail" id="detail-{esc(node_id)}" data-detail="{esc(node_id)}">
      <header><div><span class="eyebrow">{esc(node_id)}</span><h2>{esc(node.get('name', node_id))}</h2></div><span class="status {esc(node.get('status', 'draft'))}">{esc(node.get('status', 'draft'))}</span></header>
      <div class="relations"><div><b>Prerequisites</b>{relation_links(node.get('depends_on', []), nodes)}</div><div><b>Prerequisite for</b>{relation_links(reverse.get(node_id, []), nodes)}</div></div>
      <section><h3>1. What is this idea?</h3>{text_block(node.get('what'))}</section>
      <section><h3>2. Why does it exist?</h3>{text_block(node.get('why'))}</section>
      <section><h3>3. Expected result</h3>{text_block(node.get('expected_result'))}</section>
      <section><h3>4. How to implement</h3>{text_block(implementation.get('how'))}<h4>Approved target paths</h4>{text_block(implementation.get('target_paths', []))}<h4>Weekly plan</h4>{weekly_html}</section>
      <section><h3>5. Why implement it this way?</h3>{text_block(implementation.get('why_this_way'))}<h4>Local research</h4>{text_block(local)}<h4>External research</h4>{text_block(external)}<h4>Reuse decision</h4>{text_block(reuse)}</section>
      <section><h3>6. Exact code locations</h3>{refs_html}</section>
      <section><h3>7. Verification</h3>{checks_html}</section>
      <section><h3>8. Future use</h3>{text_block(node.get('future_use'))}</section>
      <section><h3>Inputs</h3>{text_block(node.get('inputs', []))}<h3>Outputs</h3>{text_block(node.get('outputs', []))}</section>
    </article>"""


def render_document(project: dict[str, Any], nodes: dict[str, dict[str, Any]]) -> str:
    positions, width, height = graph_layout(nodes)
    reverse = reverse_dependencies(nodes)
    card_width, card_height = 220, 68
    edges: list[str] = []
    for node_id, node in nodes.items():
        x2, y2 = positions[node_id]
        for dependency in node.get("depends_on", []):
            if dependency not in positions:
                continue
            x1, y1 = positions[dependency]
            start_x, start_y = x1 + card_width, y1 + card_height // 2
            end_x, end_y = x2, y2 + card_height // 2
            middle = (start_x + end_x) // 2
            edges.append(
                f'<path d="M {start_x} {start_y} C {middle} {start_y}, {middle} {end_y}, {end_x} {end_y}" />'
            )
    cards = "".join(
        f'<button class="node {esc(node.get("status", "draft"))}" data-open="{esc(node_id)}" style="left:{positions[node_id][0]}px;top:{positions[node_id][1]}px;width:{card_width}px;height:{card_height}px">{esc(node.get("name", node_id))}</button>'
        for node_id, node in nodes.items()
    )
    details = "".join(detail_html(node_id, node, nodes, reverse) for node_id, node in nodes.items())
    project_name = project.get("project", {}).get("name", "Idea Graph")
    empty_graph = '<div class="graph-empty">No idea nodes yet.</div>' if not nodes else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="ai-companion-agent" content="{AGENT}"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(project_name)} — Idea Graph</title>
<style>
:root{{--bg:#0b1020;--panel:#111a2e;--ink:#eef3ff;--muted:#91a0be;--line:#314365;--accent:#73e2c2;--border:#253655}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}}
nav{{position:sticky;top:0;z-index:5;display:flex;gap:16px;align-items:center;padding:18px 28px;background:#0b1020e8;border-bottom:1px solid var(--border);backdrop-filter:blur(12px)}}
nav h1{{font-size:18px;margin:0}} nav span{{color:var(--muted)}} main{{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(360px,1fr);min-height:calc(100vh - 66px)}}
.graph-pane{{overflow:auto;padding:26px;border-right:1px solid var(--border)}} .graph-pane h2{{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em}}
.canvas{{position:relative;min-width:{width}px;min-height:{height}px}} .canvas svg{{position:absolute;inset:0;width:{width}px;height:{height}px;overflow:visible}} .canvas path{{fill:none;stroke:var(--line);stroke-width:2;marker-end:url(#arrow)}}
.node{{position:absolute;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--ink);padding:12px;cursor:pointer;font-weight:700;box-shadow:0 9px 28px #0004;transition:.15s}}
.node:hover,.node.selected{{border-color:var(--accent);transform:translateY(-2px)}} .node.done{{border-color:#48bb78}} .node.blocked{{border-color:#f56565}} .node.implementing{{border-color:#ecc94b}}
.detail-pane{{padding:30px;overflow:auto;max-height:calc(100vh - 66px)}} .detail{{display:none;max-width:760px;margin:auto}} .detail.active{{display:block}} .detail header{{display:flex;justify-content:space-between;gap:18px;align-items:start;border-bottom:1px solid var(--border);padding-bottom:18px}} h2{{margin:2px 0;font-size:28px}} h3{{font-size:15px;margin:0 0 8px}} h4{{color:var(--muted);margin:16px 0 4px}} section{{padding:20px 0;border-bottom:1px solid var(--border)}} p{{margin:0;white-space:normal}} ul,ol{{margin:6px 0;padding-left:22px}} code{{background:#080d19;padding:2px 6px;border-radius:5px;color:#b7cdfa}} .eyebrow,.empty{{color:var(--muted)}}
.status,.pill{{border:1px solid var(--line);border-radius:999px;padding:4px 9px;font-size:12px}} .relations{{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}} .relations>div{{display:flex;flex-direction:column;gap:6px;padding:12px;background:var(--panel);border-radius:10px}} .relation{{text-align:left;border:0;background:none;color:var(--accent);padding:0;cursor:pointer}} .graph-empty{{padding:40px;color:var(--muted)}}
.welcome{{max-width:620px;margin:80px auto;color:var(--muted)}} @media(max-width:900px){{main{{display:block}}.graph-pane{{border-right:0;border-bottom:1px solid var(--border)}}.detail-pane{{max-height:none}}}}
</style></head><body>
<nav><h1>{esc(project_name)}</h1><span>Idea Graph · {len(nodes)} nodes · generated {esc(now())}</span></nav>
<main><div class="graph-pane"><h2>Complete project graph</h2><div class="canvas"><svg viewBox="0 0 {width} {height}" aria-hidden="true"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" style="fill:var(--line);stroke:none"/></marker></defs>{''.join(edges)}</svg>{cards}{empty_graph}</div></div>
<aside class="detail-pane"><div class="welcome">Select an idea node to inspect its contract, implementation, code references, verification, prerequisites, and dependents.</div>{details}</aside></main>
<script>
const openNode=id=>{{document.querySelectorAll('[data-detail]').forEach(x=>x.classList.toggle('active',x.dataset.detail===id));document.querySelectorAll('.node').forEach(x=>x.classList.toggle('selected',x.dataset.open===id));document.querySelector('.welcome').style.display='none';history.replaceState(null,'','#'+encodeURIComponent(id));}};
document.querySelectorAll('[data-open]').forEach(x=>x.addEventListener('click',()=>openNode(x.dataset.open)));
const initial=decodeURIComponent(location.hash.slice(1));if(initial&&document.querySelector(`[data-detail="${{CSS.escape(initial)}}"]`))openNode(initial);
</script></body></html>"""


def command_render(args: argparse.Namespace) -> None:
    root = find_root(args.root)
    project = load_project(root)
    nodes, errors = collect_validation(root)
    fatal = [error for error in errors if "readiness gaps" not in error]
    if fatal:
        raise CompanionError("Cannot render an invalid graph; run validate for details.")
    configured = state_path(root) / project.get("report", "reports/idea-graph.html")
    requested = Path(args.output).resolve() if args.output else configured
    output = requested
    if args.output and requested.exists() and not file_owned_by_agent(requested):
        output = agent_suffixed_path(requested)
        if output.exists() and not file_owned_by_agent(output):
            raise CompanionError(f"{output} is also occupied; refusing to overwrite it.")
    if strict_mode(root):
        try:
            output.relative_to((state_path(root) / "reports").resolve())
        except ValueError as error:
            directory = state_path(root).name
            raise CompanionError(f"Strict mode renders only inside {directory}/reports/.") from error
    atomic_write(output, render_document(project, nodes))
    atomic_write(
        state_path(root) / "runtime" / "project.json",
        json_text({"graph_digest": graph_digest(nodes), "rendered_at": now(), "output": str(output)}),
    )
    append_log(
        root,
        {"kind": "graph.rendered", "summary": f"Rendered {len(nodes)} idea nodes.", "files": [str(output)]},
    )
    print(output)


def event_paths(event: dict[str, Any]) -> list[str]:
    tool_input = event.get("tool_input") or {}
    values: list[str] = []
    direct = tool_input.get("file_path")
    if isinstance(direct, str):
        values.append(direct)
    patch = tool_input.get("command") or tool_input.get("patch")
    if isinstance(patch, str):
        values.extend(PATCH_PATH_PATTERN.findall(patch))
    return sorted(set(values))


def deny_tool(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": f"Codex Companion: {reason}",
                }
            }
        )
    )


def normalized_event_paths(root: Path, event: dict[str, Any]) -> list[str]:
    result: list[str] = []
    for value in event_paths(event):
        relative = normalized_relative(root, value)
        if relative is None:
            raise CompanionError(f"Path escapes the project root: {value}")
        result.append(relative)
    return sorted(set(result))


def pre_tool_hook(root: Path, event: dict[str, Any]) -> None:
    tool = str(event.get("tool_name", ""))
    tool_input = event.get("tool_input") or {}
    if tool.lower() == "bash":
        command = str(tool_input.get("command", ""))
        if MUTATING_SHELL_PATTERN.search(command):
            raise CompanionError(
                "strict mode blocks shell mutations; use apply_patch or the Companion CLI"
            )
        if COMPANION_CLI_PATTERN.fullmatch(command):
            return
        if "companion.py" in command:
            raise CompanionError("the Companion CLI command contains unsupported shell syntax")
        if SCRIPTING_SHELL_PATTERN.search(command):
            raise CompanionError("run executable checks through `companion.py run-check`")
        return
    files = normalized_event_paths(root, event)
    if not files:
        raise CompanionError("strict mode could not determine the write target")
    patch = str(tool_input.get("command") or tool_input.get("patch") or "")
    operations = PATCH_OPERATION_PATTERN.findall(patch)
    if tool.lower() == "apply_patch" and len(operations) != len(files):
        raise CompanionError("strict mode could not parse every patch operation")
    nodes, errors = load_nodes(root)
    if errors:
        raise CompanionError("node files are invalid")
    active_id = active_node_id(root)
    active = nodes.get(active_id or "")
    for relative in files:
        if relative.startswith(f"{state_path(root).name}/nodes/"):
            if tool.lower() != "apply_patch":
                raise CompanionError("edit node JSON with apply_patch so protected fields can be checked")
            operation = next(
                (op for op, path in operations if normalized_relative(root, path) == relative), None
            )
            if operation != "Update":
                raise CompanionError("create nodes with `companion.py new`; node deletion is guarded")
            if PROTECTED_NODE_PATCH_PATTERN.search(patch):
                raise CompanionError("node identity and lifecycle fields are CLI-managed")
            continue
        if is_managed_state_path(relative):
            raise CompanionError("managed state must be changed through the Companion CLI")
        if not active or active.get("status") != "implementing":
            raise CompanionError("product edits require an active implementing node")
        if not valid_approval(root, "plan", [active["id"]]):
            raise CompanionError("the active plan approval is missing or stale")
        test_patterns = [
            path
            for check in active.get("verification", [])
            for path in check.get("test_paths", [])
        ]
        if path_matches(relative, test_patterns):
            continue
        if not path_matches(relative, active.get("implementation", {}).get("target_paths", [])):
            raise CompanionError(f"{relative} is outside the approved target_paths and test_paths")
        ready, reason = red_gate_ready(root, active)
        if not ready:
            raise CompanionError(f"product edit blocked: {reason}")


def post_tool_hook(root: Path, event: dict[str, Any]) -> None:
    files = normalized_event_paths(root, event)
    if not files:
        return
    active_id = active_node_id(root)
    product_files = [path for path in files if not is_managed_state_path(path)]
    if active_id and product_files:
        runtime = load_runtime(root, active_id)
        runtime["change_seq"] += 1
        runtime["last_changed_at"] = now()
        save_runtime(root, runtime)
    kind = (
        "idea.file_changed"
        if any(path.startswith(f"{state_path(root).name}/nodes/") for path in files)
        else "code.file_changed"
    )
    append_log(
        root,
        {
            "kind": kind,
            "node_id": active_id,
            "summary": f"{event.get('tool_name', 'tool')} changed {len(files)} file(s).",
            "files": files,
            "tool": event.get("tool_name"),
        },
    )


def stop_hook(root: Path, event: dict[str, Any]) -> None:
    if event.get("stop_hook_active") or has_pending_approval(root):
        return
    nodes, errors = load_nodes(root)
    if errors:
        print(json.dumps({"decision": "block", "reason": "Codex Companion node state is invalid."}))
        return
    active_id = active_node_id(root)
    if not active_id:
        return
    node = nodes.get(active_id)
    if not node:
        print(json.dumps({"decision": "block", "reason": "Active Companion node is missing."}))
        return
    reason: str | None = None
    if node.get("status") == "implementing":
        gaps = execution_gaps(root, node)
        reason = "Finish or block the active node"
        if gaps:
            reason += ": " + ", ".join(gaps)
    elif node.get("status") == "done":
        report_state = state_path(root) / "runtime" / "project.json"
        rendered = load_json(report_state).get("graph_digest") if report_state.exists() else None
        reason = (
            "Render the completed graph before deactivation."
            if rendered != graph_digest(nodes)
            else "Deactivate the completed node before stopping."
        )
    elif node.get("status") not in ("blocked", "superseded"):
        reason = "Resolve the active node lifecycle before stopping."
    if reason:
        print(json.dumps({"decision": "block", "reason": f"Codex Companion: {reason}"}))


def command_hook(args: argparse.Namespace) -> None:
    try:
        event = json.loads(sys.stdin.read() or "{}")
        root = find_root(event.get("cwd") or ".", require=False)
        if not (state_path(root) / "project.json").is_file():
            return
        if not strict_mode(root) and args.phase != "post":
            return
        if args.phase == "pre":
            pre_tool_hook(root, event)
        elif args.phase == "post":
            post_tool_hook(root, event)
        elif args.phase == "prompt":
            apply_approval(root, event)
        elif args.phase == "stop":
            stop_hook(root, event)
    except Exception as error:
        if args.phase == "pre":
            deny_tool(str(error))
        elif args.phase == "prompt":
            print(json.dumps({"decision": "block", "reason": f"Codex Companion: {error}"}))
        elif args.phase == "stop":
            print(json.dumps({"decision": "block", "reason": f"Codex Companion: {error}"}))
        else:
            print(f"[Codex Companion] recording failed: {error}", file=sys.stderr)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subcommands = result.add_subparsers(dest="command", required=True)

    init = subcommands.add_parser("init", help="Initialize .codex-companion state.")
    init.add_argument("--root", default=".")
    init.add_argument("--name")
    init.set_defaults(handler=command_init)

    new = subcommands.add_parser("new", help="Create a blank idea node.")
    new.add_argument("id")
    new.add_argument("--name", required=True)
    new.add_argument("--root", default=".")
    new.set_defaults(handler=command_new)

    validate = subcommands.add_parser("validate", help="Validate schema, gates, refs, and DAG.")
    validate.add_argument("--root", default=".")
    validate.set_defaults(handler=command_validate)

    status = subcommands.add_parser("status", help="Show topological state and ready nodes.")
    status.add_argument("--root", default=".")
    status.add_argument("--verbose", action="store_true")
    status.set_defaults(handler=command_status)

    set_status = subcommands.add_parser("set-status", help="Apply a lifecycle transition.")
    set_status.add_argument("id")
    set_status.add_argument("status", choices=STATUSES)
    set_status.add_argument("--root", default=".")
    set_status.set_defaults(handler=command_set_status)

    activate = subcommands.add_parser("activate", help="Associate edits with an idea node.")
    activate.add_argument("id")
    activate.add_argument("--root", default=".")
    activate.set_defaults(handler=command_activate)

    deactivate = subcommands.add_parser("deactivate", help="Clear the active idea node.")
    deactivate.add_argument("--root", default=".")
    deactivate.set_defaults(handler=command_deactivate)

    record = subcommands.add_parser("record", help="Append a semantic audit event.")
    record.add_argument("--kind", required=True)
    record.add_argument("--summary", required=True)
    record.add_argument("--node")
    record.add_argument("--file", action="append")
    record.add_argument("--details")
    record.add_argument("--root", default=".")
    record.set_defaults(handler=command_record)

    request_approval = subcommands.add_parser(
        "request-approval", help="Create a one-time, snapshot-bound user review challenge."
    )
    request_approval.add_argument("--gate", required=True, choices=APPROVAL_GATES)
    request_approval.add_argument("--node", action="append", required=True)
    request_approval.add_argument("--check")
    request_approval.add_argument("--root", default=".")
    request_approval.set_defaults(handler=command_request_approval)

    run_check = subcommands.add_parser(
        "run-check", help="Run an approved automated check and record red/green evidence."
    )
    run_check.add_argument("id")
    run_check.add_argument("check")
    run_check.add_argument("--phase", required=True, choices=("red", "green"))
    run_check.add_argument("--timeout", type=int, default=300)
    run_check.add_argument("--root", default=".")
    run_check.set_defaults(handler=command_run_check)

    scan = subcommands.add_parser("scan", help="Create an onboarding coverage manifest.")
    scan.add_argument("--root", default=".")
    scan.set_defaults(handler=command_scan)

    reviewed = subcommands.add_parser("reviewed", help="Mark covered files as fully reviewed.")
    reviewed.add_argument("paths", nargs="+")
    reviewed.add_argument("--root", default=".")
    reviewed.set_defaults(handler=command_reviewed)

    render = subcommands.add_parser("render", help="Render a self-contained clickable HTML graph.")
    render.add_argument("--root", default=".")
    render.add_argument("--output")
    render.set_defaults(handler=command_render)

    hook = subcommands.add_parser("hook", help="Internal Codex hook entry point.")
    hook.add_argument("phase", choices=("pre", "post", "prompt", "stop"))
    hook.set_defaults(handler=command_hook)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        args.handler(args)
        return 0
    except CompanionError as error:
        print(f"codex-companion: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
