#!/usr/bin/env python3
"""Inspect Git repository changes and documentation status for sync-repo-docs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple

DOC_FILES = {
    "changelog": [
        "CHANGELOG.md",
        "docs/CHANGELOG.md",
        "CHANGES.md",
        "HISTORY.md",
        "RELEASE_NOTES.md",
    ],
    "features": [
        "docs/FEATURES.md",
        "FEATURES.md",
        "docs/FEATURE_CATALOG.md",
    ],
    "readme": [
        "README.md",
        "readme.md",
    ],
}


def run_git(repo: str, args: List[str]) -> Tuple[int, str]:
    """Execute a git subcommand inside repo."""
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
    """Find top-level git directory from start path."""
    rc, out = run_git(os.path.abspath(start), ["rev-parse", "--show-toplevel"])
    if rc != 0:
        return None
    return os.path.realpath(out.strip())


def find_existing_docs(repo_root: str) -> Dict[str, List[str]]:
    """Locate existing changelog, feature catalog, and README files."""
    found: Dict[str, List[str]] = {"changelog": [], "features": [], "readme": []}
    for kind, candidates in DOC_FILES.items():
        for rel in candidates:
            full = os.path.join(repo_root, rel)
            if os.path.isfile(full):
                found[kind].append(rel)
    return found


def find_last_doc_commit(repo_root: str, doc_paths: List[str]) -> Optional[str]:
    """Find the most recent commit SHA that touched any known doc file."""
    if not doc_paths:
        return None
    rc, out = run_git(
        repo_root, ["log", "-n", "1", "--format=%H", "--"] + doc_paths
    )
    if rc == 0 and out.strip():
        return out.strip().splitlines()[0].strip()
    return None


def list_commits(
    repo_root: str, since_ref: Optional[str], limit: int
) -> List[Dict[str, Any]]:
    """Collect commit metadata and changed files."""
    rc, _ = run_git(repo_root, ["rev-parse", "--verify", "HEAD"])
    if rc != 0:
        return []

    rev_range = f"{since_ref}..HEAD" if since_ref else "HEAD"
    fmt = "%H%x1f%h%x1f%ad%x1f%an%x1f%s"
    rc, out = run_git(
        repo_root,
        ["log", f"-n{limit}", "--date=short", f"--format={fmt}", rev_range],
    )
    if rc != 0 or not out.strip():
        return []

    commits: List[Dict[str, Any]] = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) != 5:
            continue
        sha, short_sha, date_str, author, subject = parts
        rc_files, files_out = run_git(
            repo_root,
            ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", sha],
        )
        files: List[Dict[str, str]] = []
        if rc_files == 0:
            for fline in files_out.splitlines():
                fparts = fline.split("\t")
                if len(fparts) >= 2:
                    files.append({"status": fparts[0], "path": fparts[-1]})
        commits.append(
            {
                "sha": sha,
                "shortSha": short_sha,
                "date": date_str,
                "author": author,
                "subject": subject,
                "files": files,
            }
        )
    return commits


def get_working_tree_changes(repo_root: str) -> List[Dict[str, str]]:
    """List uncommitted changes in the working tree."""
    rc, out = run_git(repo_root, ["status", "--porcelain=v1", "-uall"])
    if rc != 0:
        return []
    changes: List[Dict[str, str]] = []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        changes.append({"status": line[:2].strip() or line[:2], "path": line[3:]})
    return changes


def read_pending_queue(repo_root: str, clear: bool = False) -> List[Dict[str, Any]]:
    """Read (and optionally clear) .git/repo-doc-pending.jsonl created by git hooks."""
    rc, git_dir_out = run_git(repo_root, ["rev-parse", "--git-dir"])
    if rc != 0:
        return []
    git_dir = git_dir_out.strip()
    if not os.path.isabs(git_dir):
        git_dir = os.path.join(repo_root, git_dir)
    queue_path = os.path.join(git_dir, "repo-doc-pending.jsonl")
    if not os.path.isfile(queue_path):
        return []

    entries: List[Dict[str, Any]] = []
    try:
        with open(queue_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    entries.append({"raw": line})
        if clear:
            os.remove(queue_path)
    except OSError:
        pass
    return entries


def list_top_level_entries(repo_root: str) -> List[str]:
    """List top-level files and directories (excluding .git) for feature discovery."""
    try:
        items = sorted(
            name + ("/" if os.path.isdir(os.path.join(repo_root, name)) else "")
            for name in os.listdir(repo_root)
            if name != ".git"
        )
        return items[:60]
    except OSError:
        return []


def build_report(
    repo_root: str, since_ref: Optional[str], limit: int, clear_pending: bool
) -> Dict[str, Any]:
    """Build a structured documentation inspection report for repo_root."""
    docs = find_existing_docs(repo_root)
    tracked_doc_paths = docs["changelog"] + docs["features"]
    effective_since = since_ref or find_last_doc_commit(repo_root, tracked_doc_paths)
    commits = list_commits(repo_root, effective_since, limit)
    working_tree = get_working_tree_changes(repo_root)
    pending_queue = read_pending_queue(repo_root, clear=clear_pending)

    return {
        "repoRoot": repo_root,
        "existingDocs": docs,
        "sinceRef": effective_since,
        "sinceSource": "explicit" if since_ref else ("last_doc_commit" if effective_since else "initial_history"),
        "workingTreeChanges": working_tree,
        "undocumentedCommits": commits,
        "hookPendingQueue": pending_queue,
        "topLevelEntries": list_top_level_entries(repo_root),
    }


def print_human_report(report: Dict[str, Any]) -> None:
    """Print a concise readable summary for the agent or user."""
    print(f"Repository: {report['repoRoot']}")
    docs = report["existingDocs"]
    print(f"Existing Changelogs: {docs['changelog'] or ['(none — create CHANGELOG.md)']}")
    print(f"Existing Feature Docs: {docs['features'] or ['(none — create docs/FEATURES.md)']}")
    print(f"Existing READMEs: {docs['readme'] or ['(none)']}")
    print(f"Commit range base: {report['sinceRef'] or '(full history)'} [{report['sinceSource']}]")

    wt = report["workingTreeChanges"]
    print(f"\nWorking Tree Changes ({len(wt)}):")
    for item in wt[:40]:
        print(f"  [{item['status']}] {item['path']}")
    if len(wt) > 40:
        print(f"  ... and {len(wt) - 40} more")

    commits = report["undocumentedCommits"]
    print(f"\nCommits to Review ({len(commits)}):")
    for commit in commits:
        print(f"  - {commit['shortSha']} ({commit['date']}) {commit['subject']}")
        for fitem in commit["files"][:15]:
            print(f"      [{fitem['status']}] {fitem['path']}")
        if len(commit["files"]) > 15:
            print(f"      ... and {len(commit['files']) - 15} more files")

    queue = report["hookPendingQueue"]
    if queue:
        print(f"\nGit Hook Pending Queue ({len(queue)} entries):")
        for entry in queue:
            print(f"  - {entry}")

    print(f"\nTop-Level Structure: {', '.join(report['topLevelEntries'])}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect Git changes and documentation status in a repository."
    )
    parser.add_argument("--repo", default=".", help="Path inside target Git repository")
    parser.add_argument("--since", default=None, help="Compare commits since git ref")
    parser.add_argument("--limit", type=int, default=30, help="Max commits to show")
    parser.add_argument(
        "--clear-pending",
        action="store_true",
        help="Clear .git/repo-doc-pending.jsonl after reading",
    )
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    repo_root = find_repo_root(args.repo)
    if not repo_root:
        msg = {"error": f"Not inside a Git repository: {os.path.abspath(args.repo)}"}
        if args.json:
            print(json.dumps(msg, indent=2))
        else:
            print(msg["error"], file=sys.stderr)
        return 1

    report = build_report(repo_root, args.since, args.limit, args.clear_pending)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_human_report(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
