from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "companion.py"
SPEC = importlib.util.spec_from_file_location("codex_companion_cli", SCRIPT)
assert SPEC and SPEC.loader
companion = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(companion)


class CompanionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        companion.command_init(argparse.Namespace(root=str(self.root), name="Fixture"))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def node_path(self, node_id: str) -> Path:
        return self.root / ".codex-companion" / "nodes" / f"{node_id}.json"

    def write_node(self, node: dict) -> None:
        companion.atomic_write(self.node_path(node["id"]), companion.json_text(node))

    def planned_node(self, node_id: str, name: str, depends_on: list[str] | None = None) -> dict:
        node = companion.blank_node(node_id, name)
        node.update(
            {
                "what": f"What {name} provides",
                "why": f"Why {name} is needed",
                "expected_result": f"Observable result for {name}",
                "future_use": f"Future use for {name}",
                "depends_on": depends_on or [],
                "inputs": ["input"],
                "outputs": ["output"],
            }
        )
        node["implementation"] = {
            "how": f"Implement {name}",
            "why_this_way": "Smallest compatible implementation",
            "target_paths": ["src/**"],
            "research": {
                "local_findings": ["No compatible local implementation"],
                "external_findings": ["https://example.test/primary"],
                "reuse_decision": "Reuse the Python standard library",
            },
            "weekly_plan": [{"week": 1, "outcome": f"Verified {name}"}],
        }
        node["verification"] = [
            {
                "id": "behavior",
                "kind": "automated",
                "plan": "Given an input, the expected output is observable",
                "command": "python -m unittest",
                "test_paths": ["tests/test_behavior.py"],
                "status": "pending",
                "evidence": [],
            }
        ]
        return node

    def approve(
        self, gate: str, node_ids: list[str], check: str | None = None
    ) -> str:
        companion.command_request_approval(
            argparse.Namespace(root=str(self.root), gate=gate, node=node_ids, check=check)
        )
        pending = list((self.root / ".codex-companion" / "pending").glob("*.json"))
        self.assertEqual(1, len(pending))
        challenge = pending[0].stem
        event = {
            "cwd": str(self.root),
            "prompt": f"APPROVE {challenge}",
            "session_id": "test-session",
            "turn_id": "test-turn",
        }
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            companion.command_hook(argparse.Namespace(phase="prompt"))
        return challenge

    def make_implementing(self, node_id: str = "strict") -> dict:
        node = self.planned_node(node_id, "Strict")
        node["status"] = "planned"
        node["verification"][0]["command"] = [
            "python",
            "tests/test_behavior.py",
        ]
        self.write_node(node)
        self.approve("plan", [node_id])
        companion.command_activate(argparse.Namespace(root=str(self.root), id=node_id))
        companion.command_set_status(
            argparse.Namespace(root=str(self.root), id=node_id, status="implementing", approval=None)
        )
        return companion.load_json(self.node_path(node_id))

    def test_init_new_validate_and_empty_render(self) -> None:
        self.assertEqual("codex", companion.load_project(self.root)["agent"])
        companion.command_new(
            argparse.Namespace(root=str(self.root), id="first-idea", name="First idea")
        )
        nodes, errors = companion.collect_validation(self.root)
        self.assertEqual(["first-idea"], list(nodes))
        self.assertEqual([], errors)

        companion.command_render(argparse.Namespace(root=str(self.root), output=None))
        report = self.root / ".codex-companion" / "reports" / "idea-graph.html"
        page = report.read_text(encoding="utf-8")
        self.assertIn("First idea", page)
        self.assertIn("Complete project graph", page)
        self.assertIn("1. What is this idea?", page)
        self.assertIn('name="ai-companion-agent" content="codex"', page)

    def test_agent_suffix_preserves_foreign_state_and_render_output(self) -> None:
        self.assertEqual(
            "graph.codex.yaml",
            companion.agent_suffixed_path(Path("graph.yaml")).name,
        )
        self.assertEqual(
            "graph.claude.yaml",
            companion.agent_suffixed_path(Path("graph.yaml"), "claude").name,
        )
        self.assertEqual(
            "graph.cursor.yaml",
            companion.agent_suffixed_path(Path("graph.yaml"), "cursor").name,
        )
        self.assertEqual(
            ".approved.codex",
            companion.agent_suffixed_path(Path(".approved")).name,
        )

        with tempfile.TemporaryDirectory() as outside:
            root = Path(outside)
            foreign_state = root / ".codex-companion"
            foreign_state.mkdir()
            foreign_project = foreign_state / "project.json"
            foreign_text = '{"schema_version":"foreign/v1","agent":"claude"}\n'
            foreign_project.write_text(foreign_text, encoding="utf-8")

            companion.command_init(argparse.Namespace(root=str(root), name="Collision"))
            codex_state = root / ".codex-companion.codex"
            self.assertTrue((codex_state / "project.json").is_file())
            self.assertEqual(foreign_text, foreign_project.read_text(encoding="utf-8"))
            self.assertEqual(codex_state, companion.state_path(root))
            self.assertEqual(root, companion.find_root(root))
            (root / "source.py").write_text("print('ok')\n", encoding="utf-8")
            companion.command_scan(argparse.Namespace(root=str(root)))
            coverage = companion.load_json(codex_state / "coverage.json")
            self.assertEqual(["source.py"], [item["path"] for item in coverage["included"]])

        report_dir = self.root / ".codex-companion" / "reports"
        occupied = report_dir / "shared.html"
        occupied.write_text("foreign report\n", encoding="utf-8")
        companion.command_render(argparse.Namespace(root=str(self.root), output=str(occupied)))
        claimed = report_dir / "shared.codex.html"
        self.assertEqual("foreign report\n", occupied.read_text(encoding="utf-8"))
        self.assertIn('content="codex"', claimed.read_text(encoding="utf-8"))

        companion.command_render(argparse.Namespace(root=str(self.root), output=str(occupied)))
        self.assertTrue(claimed.is_file())

        blocked = report_dir / "blocked.html"
        blocked.write_text("foreign plain\n", encoding="utf-8")
        (report_dir / "blocked.codex.html").write_text("foreign suffix\n", encoding="utf-8")
        with self.assertRaisesRegex(companion.CompanionError, "also occupied"):
            companion.command_render(argparse.Namespace(root=str(self.root), output=str(blocked)))

    def test_graph_rejects_cycles_and_derives_reverse_relations(self) -> None:
        first = self.planned_node("first", "First", ["second"])
        second = self.planned_node("second", "Second", ["first"])
        self.write_node(first)
        self.write_node(second)
        nodes, errors = companion.collect_validation(self.root)
        self.assertTrue(any("cycle" in error.lower() for error in errors))

        first["depends_on"] = []
        self.write_node(first)
        nodes, errors = companion.collect_validation(self.root)
        self.assertEqual([], errors)
        reverse = companion.reverse_dependencies(nodes)
        self.assertEqual(["second"], reverse["first"])
        page = companion.render_document(companion.load_project(self.root), nodes)
        self.assertIn("Prerequisite for", page)
        self.assertIn('data-open="first"', page)

    def test_lifecycle_requires_approval_prerequisites_and_evidence(self) -> None:
        node = companion.blank_node("gated", "Gated")
        node.update(
            {
                "what": "Build a gated behavior",
                "why": "Prevent implicit approval",
                "expected_result": "Only real user prompts approve",
            }
        )
        self.write_node(node)

        with self.assertRaisesRegex(companion.CompanionError, "request-approval"):
            companion.command_set_status(
                argparse.Namespace(root=str(self.root), id="gated", status="aligned", approval="fake")
            )
        self.approve("intent", ["gated"])
        self.assertEqual("aligned", companion.load_json(self.node_path("gated"))["status"])

        node = self.planned_node("gated", "Gated")
        node["status"] = "aligned"
        node["verification"] = [
            {
                "id": "user-observation",
                "kind": "manual",
                "plan": "User observes the expected outcome",
                "command": "",
                "test_paths": [],
                "status": "pending",
                "evidence": [],
            }
        ]
        self.write_node(node)
        self.approve("decomposition", ["gated"])
        companion.command_set_status(
            argparse.Namespace(root=str(self.root), id="gated", status="planned", approval=None)
        )
        with self.assertRaisesRegex(companion.CompanionError, "request-approval"):
            companion.command_set_status(
                argparse.Namespace(root=str(self.root), id="gated", status="approved", approval="fake")
            )
        self.approve("plan", ["gated"])
        companion.command_activate(argparse.Namespace(root=str(self.root), id="gated"))
        companion.command_set_status(
            argparse.Namespace(root=str(self.root), id="gated", status="implementing", approval=None)
        )
        with self.assertRaises(companion.CompanionError):
            companion.command_set_status(
                argparse.Namespace(root=str(self.root), id="gated", status="done", approval=None)
            )

        source = self.root / "src" / "gated.py"
        source.parent.mkdir()
        source.write_text("def run():\n    return 'done'\n", encoding="utf-8")
        node = companion.load_json(self.node_path("gated"))
        node["code_refs"] = [
            {
                "path": "src/gated.py",
                "start_line": 1,
                "end_line": 2,
                "symbol": "run",
                "role": "Implements the observable result",
            }
        ]
        self.write_node(node)
        self.approve("manual-check", ["gated"], "user-observation")
        companion.command_record(
            argparse.Namespace(
                root=str(self.root),
                kind="implementation.completed",
                summary="Implemented gated behavior",
                node="gated",
                file=["src/gated.py"],
                details="Manual verification approved",
            )
        )
        companion.command_set_status(
            argparse.Namespace(root=str(self.root), id="gated", status="done", approval=None)
        )
        self.assertEqual("done", companion.load_json(self.node_path("gated"))["status"])

    def test_implementing_waits_for_done_prerequisites(self) -> None:
        prerequisite = self.planned_node("prerequisite", "Prerequisite")
        prerequisite["status"] = "planned"
        dependent = self.planned_node("dependent", "Dependent", ["prerequisite"])
        dependent["status"] = "planned"
        self.write_node(prerequisite)
        self.write_node(dependent)
        self.approve("plan", ["dependent"])
        with self.assertRaisesRegex(companion.CompanionError, "unfinished prerequisites"):
            companion.command_activate(argparse.Namespace(root=str(self.root), id="dependent"))

    def test_done_rejects_out_of_range_code_reference(self) -> None:
        node = self.planned_node("bad-ref", "Bad ref")
        node["status"] = "done"
        node["verification"][0]["status"] = "passed"
        node["verification"][0]["evidence"] = ["exit code 0"]
        (self.root / "one-line.py").write_text("value = 1\n", encoding="utf-8")
        node["code_refs"] = [
            {
                "path": "one-line.py",
                "start_line": 1,
                "end_line": 9,
                "symbol": "value",
                "role": "Implements the result",
            }
        ]
        self.write_node(node)
        errors = companion.validate_node_shape(node, self.root)
        self.assertTrue(any("line count" in error for error in errors))

    def test_scan_tracks_review_coverage_and_skipped_binary(self) -> None:
        (self.root / "source.py").write_text("# comment\nprint('ok')\n", encoding="utf-8")
        (self.root / "asset.bin").write_bytes(b"abc\0def")
        companion.command_scan(argparse.Namespace(root=str(self.root)))
        coverage_path = self.root / ".codex-companion" / "coverage.json"
        coverage = companion.load_json(coverage_path)
        self.assertIn("source.py", [item["path"] for item in coverage["included"]])
        self.assertIn("asset.bin", [item["path"] for item in coverage["skipped"]])
        companion.command_reviewed(
            argparse.Namespace(root=str(self.root), paths=["source.py"])
        )
        coverage = companion.load_json(coverage_path)
        source = next(item for item in coverage["included"] if item["path"] == "source.py")
        self.assertIsNotNone(source["reviewed_at"])

    def test_hook_associates_patch_paths_with_active_node(self) -> None:
        node = self.planned_node("active", "Active")
        node["status"] = "planned"
        self.write_node(node)
        self.approve("plan", ["active"])
        companion.command_activate(argparse.Namespace(root=str(self.root), id="active"))
        companion.command_set_status(
            argparse.Namespace(root=str(self.root), id="active", status="implementing", approval=None)
        )
        event = {
            "tool_name": "apply_patch",
            "cwd": str(self.root),
            "tool_input": {
                "command": "*** Begin Patch\n*** Update File: tests/test_behavior.py\n*** End Patch"
            },
        }
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            companion.command_hook(argparse.Namespace(phase="post"))
        events = [
            json.loads(line)
            for line in (self.root / ".codex-companion" / "log.ndjson")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        latest = events[-1]
        self.assertEqual("active", latest["node_id"])
        self.assertEqual(["tests/test_behavior.py"], latest["files"])
        self.assertEqual(1, companion.load_runtime(self.root, "active")["change_seq"])

    def test_approval_is_one_time_and_snapshot_bound(self) -> None:
        node = companion.blank_node("intent", "Intent")
        node.update({"what": "One", "why": "Two", "expected_result": "Three"})
        self.write_node(node)
        companion.command_request_approval(
            argparse.Namespace(root=str(self.root), gate="intent", node=["intent"], check=None)
        )
        pending = next((self.root / ".codex-companion" / "pending").glob("*.json"))
        node["what"] = "Changed after review"
        self.write_node(node)
        event = {"cwd": str(self.root), "prompt": f"APPROVE {pending.stem}"}
        output = io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps(event))), contextlib.redirect_stdout(output):
            companion.command_hook(argparse.Namespace(phase="prompt"))
        self.assertIn("stale", output.getvalue())
        self.assertEqual("draft", companion.load_json(self.node_path("intent"))["status"])
        self.assertFalse(pending.exists())

    def test_pre_hook_enforces_test_first_and_scope(self) -> None:
        node = self.make_implementing()
        tests = self.root / "tests"
        tests.mkdir()
        test_file = tests / "test_behavior.py"
        test_file.write_text("raise AssertionError('red')\n", encoding="utf-8")
        test_event = {
            "tool_name": "apply_patch",
            "tool_input": {
                "command": "*** Begin Patch\n*** Update File: tests/test_behavior.py\n*** End Patch"
            },
        }
        companion.pre_tool_hook(self.root, test_event)
        product_event = {
            "tool_name": "apply_patch",
            "tool_input": {
                "command": "*** Begin Patch\n*** Add File: src/app.py\n*** End Patch"
            },
        }
        with self.assertRaisesRegex(companion.CompanionError, "run red"):
            companion.pre_tool_hook(self.root, product_event)
        companion.command_run_check(
            argparse.Namespace(root=str(self.root), id=node["id"], check="behavior", phase="red", timeout=30)
        )
        companion.pre_tool_hook(self.root, product_event)
        outside_event = {
            "tool_name": "apply_patch",
            "tool_input": {
                "command": "*** Begin Patch\n*** Add File: docs/outside.md\n*** End Patch"
            },
        }
        with self.assertRaisesRegex(companion.CompanionError, "outside"):
            companion.pre_tool_hook(self.root, outside_event)
        test_file.write_text("raise AssertionError('different red')\n", encoding="utf-8")
        with self.assertRaisesRegex(companion.CompanionError, "stale"):
            companion.pre_tool_hook(self.root, product_event)

    def test_green_evidence_semantic_record_and_done_are_current(self) -> None:
        node = self.make_implementing("complete")
        tests = self.root / "tests"
        tests.mkdir()
        (tests / "test_behavior.py").write_text(
            "from pathlib import Path\nraise SystemExit(0 if Path('src/app.py').is_file() else 1)\n",
            encoding="utf-8",
        )
        companion.command_run_check(
            argparse.Namespace(root=str(self.root), id="complete", check="behavior", phase="red", timeout=30)
        )
        product_event = {
            "tool_name": "apply_patch",
            "tool_input": {
                "command": "*** Begin Patch\n*** Add File: src/app.py\n*** End Patch"
            },
        }
        companion.pre_tool_hook(self.root, product_event)
        source = self.root / "src" / "app.py"
        source.parent.mkdir()
        source.write_text("def run():\n    return 'done'\n", encoding="utf-8")
        companion.post_tool_hook(self.root, product_event)
        companion.command_run_check(
            argparse.Namespace(root=str(self.root), id="complete", check="behavior", phase="green", timeout=30)
        )
        node = companion.load_json(self.node_path("complete"))
        node["code_refs"] = [
            {
                "path": "src/app.py",
                "start_line": 1,
                "end_line": 2,
                "symbol": "run",
                "role": "Implements the expected result",
            }
        ]
        self.write_node(node)
        with self.assertRaisesRegex(companion.CompanionError, "semantic record"):
            companion.command_set_status(
                argparse.Namespace(root=str(self.root), id="complete", status="done", approval=None)
            )
        companion.command_record(
            argparse.Namespace(
                root=str(self.root),
                kind="implementation.completed",
                summary="Implemented and verified",
                node="complete",
                file=["src/app.py"],
                details=None,
            )
        )
        companion.command_set_status(
            argparse.Namespace(root=str(self.root), id="complete", status="done", approval=None)
        )
        self.assertEqual("done", companion.load_json(self.node_path("complete"))["status"])

    def test_stop_hook_blocks_unfinished_work_but_not_user_review(self) -> None:
        self.make_implementing("stop")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            companion.stop_hook(self.root, {})
        self.assertIn('"decision": "block"', output.getvalue())
        companion.command_request_approval(
            argparse.Namespace(root=str(self.root), gate="red-waiver", node=["stop"], check=None)
        )
        event = {"cwd": str(self.root), "stop_hook_active": False}
        output = io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps(event))), contextlib.redirect_stdout(output):
            companion.command_hook(argparse.Namespace(phase="stop"))
        self.assertEqual("", output.getvalue())

    def test_pre_hook_protects_managed_lifecycle_fields(self) -> None:
        self.write_node(companion.blank_node("managed", "Managed"))
        event = {
            "tool_name": "apply_patch",
            "tool_input": {
                "command": "*** Begin Patch\n*** Update File: .codex-companion/nodes/managed.json\n@@\n-  \"status\": \"draft\",\n+  \"status\": \"done\",\n*** End Patch"
            },
        }
        with self.assertRaisesRegex(companion.CompanionError, "lifecycle"):
            companion.pre_tool_hook(self.root, event)

    def test_hook_is_inert_outside_initialized_projects_and_rejects_cli_spoofing(self) -> None:
        with tempfile.TemporaryDirectory() as outside:
            event = {"cwd": outside, "prompt": "ordinary user prompt"}
            output = io.StringIO()
            with patch("sys.stdin", io.StringIO(json.dumps(event))), contextlib.redirect_stdout(output):
                companion.command_hook(argparse.Namespace(phase="prompt"))
            self.assertEqual("", output.getvalue())
        spoof = {
            "tool_name": "Bash",
            "tool_input": {"command": "python -c \"open('x','w')\" # companion.py"},
        }
        with self.assertRaisesRegex(companion.CompanionError, "shell mutations"):
            companion.pre_tool_hook(self.root, spoof)
        with self.assertRaisesRegex(companion.CompanionError, "reports"):
            companion.command_render(
                argparse.Namespace(root=str(self.root), output=str(self.root / "product.html"))
            )


if __name__ == "__main__":
    unittest.main()
