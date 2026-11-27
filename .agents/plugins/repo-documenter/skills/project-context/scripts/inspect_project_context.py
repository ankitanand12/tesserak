#!/usr/bin/env python3
"""Inspect repository structure, manifests, and PROJECT_CONTEXT.md status."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple

MANIFEST_FILES = [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "pubspec.yaml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Gemfile",
    "composer.json",
    "Makefile",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".env.example",
]

IGNORED_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
    "target",
    ".next",
    ".dart_tool",
    ".idea",
    ".vscode",
}


def run_git(repo: str, args: List[str]) -> Tuple[int, str]:
    """Execute a git command inside repo."""
    try:
        proc = subprocess.run(
            ["git", "-C", repo] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
        return proc.returncode, proc.stdout.decode("utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


def find_repo_root(start: str) -> Optional[str]:
    """Resolve the git repository root for start."""
    rc, out = run_git(os.path.abspath(start), ["rev-parse", "--show-toplevel"])
    if rc != 0:
        return None
    return os.path.realpath(out.strip())


def build_tree(repo_root: str, max_depth: int = 2, max_entries: int = 120) -> List[str]:
    """Build a compact directory tree up to max_depth."""
    lines: List[str] = []

    def walk(current_dir: str, prefix: str, depth: int) -> None:
        if depth > max_depth or len(lines) >= max_entries:
            return
        try:
            names = sorted(os.listdir(current_dir))
        except OSError:
            return
        filtered = [n for n in names if n not in IGNORED_DIRS]
        for name in filtered:
            if len(lines) >= max_entries:
                lines.append(f"{prefix}... (truncated)")
                return
            full = os.path.join(current_dir, name)
            is_dir = os.path.isdir(full)
            lines.append(f"{prefix}{name}{'/' if is_dir else ''}")
            if is_dir and depth < max_depth:
                walk(full, prefix + "  ", depth + 1)

    walk(repo_root, "", 1)
    return lines


def get_commits_since(repo_root: str, ref: Optional[str], limit: int = 20) -> List[Dict[str, str]]:
    """List recent commits since ref (or latest commits if ref is None)."""
    rc, _ = run_git(repo_root, ["rev-parse", "--verify", "HEAD"])
    if rc != 0:
        return []
    rev_range = f"{ref}..HEAD" if ref else "HEAD"
    rc, out = run_git(
        repo_root,
        ["log", f"-n{limit}", "--date=short", "--format=%h%x1f%ad%x1f%s", rev_range],
    )
    if rc != 0 or not out.strip():
        return []
    commits: List[Dict[str, str]] = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 3:
            commits.append({"sha": parts[0], "date": parts[1], "subject": parts[2]})
    return commits


def inspect_project(repo_root: str, max_depth: int) -> Dict[str, Any]:
    """Gather repository context metadata for PROJECT_CONTEXT.md creation or update."""
    context_file = os.path.join(repo_root, "PROJECT_CONTEXT.md")
    exists = os.path.isfile(context_file)

    last_context_commit: Optional[str] = None
    last_context_date: Optional[str] = None
    if exists:
        rc, out = run_git(
            repo_root,
            ["log", "-n1", "--date=short", "--format=%H%x1f%ad", "--", "PROJECT_CONTEXT.md"],
        )
        if rc == 0 and out.strip():
            parts = out.strip().split("\x1f")
            if len(parts) == 2:
                last_context_commit, last_context_date = parts[0], parts[1]

    manifests = [m for m in MANIFEST_FILES if os.path.isfile(os.path.join(repo_root, m))]
    related_docs = [
        d
        for d in ("README.md", "CHANGELOG.md", "docs/FEATURES.md", "FEATURES.md")
        if os.path.isfile(os.path.join(repo_root, d))
    ]
    commits_since = get_commits_since(repo_root, last_context_commit, limit=20)

    return {
        "repoRoot": repo_root,
        "projectContextExists": exists,
        "projectContextPath": context_file,
        "lastContextCommit": last_context_commit,
        "lastContextDate": last_context_date,
        "manifests": manifests,
        "relatedDocs": related_docs,
        "commitsSinceContextUpdate": commits_since,
        "tree": build_tree(repo_root, max_depth=max_depth),
    }


def print_human(report: Dict[str, Any]) -> None:
    """Print human-readable project context inspection summary."""
    print(f"Repository: {report['repoRoot']}")
    if report["projectContextExists"]:
        print(
            f"PROJECT_CONTEXT.md: EXISTS (last committed: {report['lastContextDate'] or 'uncommitted'})"
        )
    else:
        print("PROJECT_CONTEXT.md: NOT FOUND (create at repository root)")
    print(f"Manifests: {report['manifests'] or ['(none)']}")
    print(f"Related Docs: {report['relatedDocs'] or ['(none)']}")

    commits = report["commitsSinceContextUpdate"]
    label = "Commits since last PROJECT_CONTEXT.md update" if report["lastContextCommit"] else "Recent commits"
    print(f"\n{label} ({len(commits)}):")
    for c in commits:
        print(f"  - {c['sha']} ({c['date']}) {c['subject']}")

    print("\nDirectory Structure:")
    for line in report["tree"]:
        print(f"  {line}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect repository context for creating or updating PROJECT_CONTEXT.md."
    )
    parser.add_argument("--repo", default=".", help="Path inside target Git repository")
    parser.add_argument("--max-depth", type=int, default=2, help="Directory tree depth")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    repo_root = find_repo_root(args.repo)
    if not repo_root:
        err = {"error": f"Not inside a Git repository: {os.path.abspath(args.repo)}"}
        if args.json:
            print(json.dumps(err, indent=2))
        else:
            print(err["error"], file=sys.stderr)
        return 1

    report = inspect_project(repo_root, max_depth=args.max_depth)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_human(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
