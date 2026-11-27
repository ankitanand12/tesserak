#!/usr/bin/env python3
"""Lifecycle hook script for the repo-documenter Antigravity plugin.

Tracks per-turn Git repository modifications during an agent session and ensures
every code, configuration, or feature change is documented in CHANGELOG.md and
docs/FEATURES.md (or the repo's existing changelog/feature documentation) before
the agent completes a turn.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional, Set, Tuple

CHANGELOG_CANDIDATES = {
    "changelog.md",
    "changelog",
    "changelog.txt",
    "changes.md",
    "history.md",
    "release_notes.md",
    "docs/changelog.md",
    "docs/changes.md",
    "docs/history.md",
}

FEATURE_DOC_CANDIDATES = {
    "features.md",
    "docs/features.md",
    "feature_catalog.md",
    "docs/feature_catalog.md",
}

ROOT_DOC_FILES = {
    "readme.md",
    "readme",
    "readme.txt",
    "contributing.md",
    "code_of_conduct.md",
    "security.md",
    "license",
    "license.md",
    "license.txt",
    "notice",
    "authors",
    "maintainers",
    "project_context.md",
    "docs/project_context.md",
}

DOC_EXTENSIONS = {".md", ".mdx", ".rst", ".txt", ".adoc"}
MAX_HASH_BYTES = 5 * 1024 * 1024
FILE_ARG_KEYS = (
    "Path",
    "TargetFile",
    "path",
    "target_file",
    "AbsolutePath",
    "absolute_path",
    "DestinationPath",
    "destination_path",
    "FilePath",
    "file_path",
)


def run_git(repo_or_dir: str, args: List[str], binary: bool = False) -> Tuple[int, Any]:
    """Run a git command in repo_or_dir without failing the hook on errors."""
    try:
        proc = subprocess.run(
            ["git", "-C", repo_or_dir] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=3,
            check=False,
        )
        out = proc.stdout if binary else proc.stdout.decode("utf-8", errors="replace")
        return proc.returncode, out
    except (OSError, subprocess.TimeoutExpired):
        return 1, b"" if binary else ""


def find_existing_ancestor(path_str: str) -> Optional[str]:
    """Return the nearest existing directory for a file or directory path."""
    if not path_str:
        return None
    cur = os.path.abspath(os.path.expanduser(path_str))
    while cur:
        if os.path.isdir(cur):
            return cur
        if os.path.isfile(cur):
            return os.path.dirname(cur)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


def find_git_root(path_str: str) -> Optional[str]:
    """Resolve the Git repository top-level directory for path_str, if any."""
    existing_dir = find_existing_ancestor(path_str)
    if not existing_dir:
        return None
    rc, out = run_git(existing_dir, ["rev-parse", "--show-toplevel"])
    if rc != 0:
        return None
    root = out.strip()
    return os.path.realpath(root) if root and os.path.isdir(root) else None


def collect_candidate_paths(payload: Dict[str, Any]) -> List[str]:
    """Extract candidate filesystem paths from common hook payload fields."""
    paths: List[str] = []
    cwd = payload.get("cwd")
    if isinstance(cwd, str) and cwd:
        paths.append(cwd)
    for wp in payload.get("workspacePaths") or []:
        if isinstance(wp, str) and wp:
            paths.append(wp)
    tool_call = payload.get("toolCall") or {}
    args = tool_call.get("args") or {}
    if isinstance(args, dict):
        for key in FILE_ARG_KEYS:
            val = args.get(key)
            if isinstance(val, str) and val:
                paths.append(val)
        cwd_arg = args.get("Cwd") or args.get("cwd")
        if isinstance(cwd_arg, str) and cwd_arg:
            paths.append(cwd_arg)
    return paths


def discover_repos(payload: Dict[str, Any]) -> List[str]:
    """Return deduplicated realpaths of Git repositories referenced by payload."""
    seen: Set[str] = set()
    repos: List[str] = []
    for candidate in collect_candidate_paths(payload):
        root = find_git_root(candidate)
        if root and root not in seen:
            seen.add(root)
            repos.append(root)
    return repos


def fingerprint_worktree_file(repo_root: str, rel_path: str) -> str:
    """Compute a deterministic fingerprint for a working-tree file path."""
    full_path = os.path.join(repo_root, rel_path)
    if os.path.islink(full_path):
        try:
            return f"LINK:{os.readlink(full_path)}"
        except OSError:
            return "LINK:UNKNOWN"
    if not os.path.exists(full_path):
        return "DELETED"
    if os.path.isdir(full_path):
        return "DIR"
    try:
        st = os.stat(full_path)
        if st.st_size > MAX_HASH_BYTES:
            return f"LARGE:{st.st_size}:{st.st_mtime_ns}"
        hasher = hashlib.sha256()
        with open(full_path, "rb") as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                hasher.update(chunk)
        return f"SHA256:{hasher.hexdigest()}"
    except OSError:
        return "UNREADABLE"


def parse_porcelain_z(raw: bytes) -> List[Tuple[str, str]]:
    """Parse `git status --porcelain=v1 -z -uall` output into (XY, path) pairs."""
    if not raw:
        return []
    tokens = raw.split(b"\x00")
    entries: List[Tuple[str, str]] = []
    idx = 0
    while idx < len(tokens):
        token = tokens[idx]
        idx += 1
        if not token:
            continue
        decoded = token.decode("utf-8", errors="replace")
        if len(decoded) < 4:
            continue
        xy = decoded[:2]
        path = decoded[3:]
        entries.append((xy, path))
        # Rename or copy records include the original path in the next NUL token.
        if xy[0] in ("R", "C") or xy[1] in ("R", "C"):
            if idx < len(tokens):
                idx += 1
    return entries


def snapshot_repo(repo_root: str) -> Dict[str, Any]:
    """Capture HEAD SHA and dirty/untracked file fingerprints for repo_root."""
    rc, head_out = run_git(repo_root, ["rev-parse", "--verify", "HEAD"])
    head = head_out.strip() if rc == 0 and head_out.strip() else "UNBORN"

    rc, status_raw = run_git(
        repo_root, ["status", "--porcelain=v1", "-z", "-uall"], binary=True
    )
    files: Dict[str, Dict[str, str]] = {}
    if rc == 0:
        for xy, rel_path in parse_porcelain_z(status_raw):
            norm_path = rel_path.replace("\\", "/")
            files[norm_path] = {
                "status": xy,
                "fp": fingerprint_worktree_file(repo_root, rel_path),
            }
    return {"head": head, "files": files}


def normalize_rel_path(rel_path: str) -> str:
    """Normalize a repo-relative path for uniform classification."""
    return rel_path.replace("\\", "/").lstrip("./")


def is_changelog_file(rel_path: str) -> bool:
    """Return True when rel_path points to a recognized changelog file."""
    return normalize_rel_path(rel_path).lower() in CHANGELOG_CANDIDATES


def is_feature_doc_file(rel_path: str) -> bool:
    """Return True when rel_path points to a recognized feature catalog doc."""
    return normalize_rel_path(rel_path).lower() in FEATURE_DOC_CANDIDATES


def is_doc_only_file(rel_path: str) -> bool:
    """Return True for documentation files that do not require changelog churn."""
    norm = normalize_rel_path(rel_path).lower()
    if norm in CHANGELOG_CANDIDATES or norm in FEATURE_DOC_CANDIDATES or norm in ROOT_DOC_FILES:
        return True
    _, ext = os.path.splitext(norm)
    if norm.startswith("docs/") and ext in DOC_EXTENSIONS:
        return True
    if ext in {".md", ".mdx", ".rst"}:
        return True
    return False


def has_existing_file(repo_root: str, candidates: Set[str]) -> bool:
    """Check whether any candidate documentation file exists in repo_root."""
    for root_dir, _, filenames in os.walk(repo_root):
        rel_dir = os.path.relpath(root_dir, repo_root)
        if rel_dir == ".git" or rel_dir.startswith(".git" + os.sep):
            continue
        # Only check root and docs/ to avoid scanning large build/vendor trees.
        if rel_dir not in (".", "docs", "Docs", "DOCS"):
            continue
        for fname in filenames:
            rel = fname if rel_dir == "." else f"{rel_dir}/{fname}"
            if normalize_rel_path(rel).lower() in candidates:
                return True
    return False


def get_committed_changes(
    repo_root: str, old_head: str, new_head: str
) -> Tuple[Set[str], Set[str]]:
    """Return (changed_paths, added_paths) committed between old_head and new_head."""
    changed: Set[str] = set()
    added: Set[str] = set()
    if old_head == new_head or new_head == "UNBORN":
        return changed, added

    if old_head == "UNBORN":
        rc, out = run_git(repo_root, ["ls-tree", "-r", "--name-only", new_head])
        if rc == 0:
            for line in out.splitlines():
                path = normalize_rel_path(line.strip())
                if path:
                    changed.add(path)
                    added.add(path)
        return changed, added

    rc, out = run_git(
        repo_root, ["diff", "--name-status", "--no-renames", old_head, new_head]
    )
    if rc != 0:
        rc, out = run_git(
            repo_root,
            ["diff-tree", "--no-commit-id", "--name-status", "--no-renames", "-r", new_head],
        )
    if rc == 0:
        for line in out.splitlines():
            parts = line.split("\t", 1)
            if len(parts) != 2:
                continue
            status, path = parts[0].strip(), normalize_rel_path(parts[1].strip())
            if not path:
                continue
            changed.add(path)
            if status.startswith("A"):
                added.add(path)
    return changed, added


def diff_snapshots(
    repo_root: str,
    baseline: Optional[Dict[str, Any]],
    current: Dict[str, Any],
    tool_touched: List[str],
) -> Dict[str, Any]:
    """Determine all files added or modified in repo_root during the current turn."""
    changed_paths: Set[str] = set()
    added_paths: Set[str] = set()

    base_head = (baseline or {}).get("head")
    base_files = (baseline or {}).get("files") or {}
    curr_head = current.get("head")
    curr_files = current.get("files") or {}

    if base_head and curr_head and base_head != curr_head:
        commit_changed, commit_added = get_committed_changes(
            repo_root, base_head, curr_head
        )
        changed_paths.update(commit_changed)
        added_paths.update(commit_added)

    for rel_path, meta in curr_files.items():
        norm = normalize_rel_path(rel_path)
        prev = base_files.get(norm) or base_files.get(rel_path)
        if prev != meta:
            changed_paths.add(norm)
            status = meta.get("status", "")
            prev_status = (prev or {}).get("status", "")
            is_curr_new = status.startswith("A") or status == "??"
            was_prev_new = prev_status.startswith("A") or prev_status == "??"
            if is_curr_new and not was_prev_new:
                added_paths.add(norm)

    for rel_path in tool_touched:
        norm = normalize_rel_path(rel_path)
        if norm:
            changed_paths.add(norm)

    non_doc_changed = sorted(p for p in changed_paths if not is_doc_only_file(p))
    non_doc_added = sorted(p for p in added_paths if not is_doc_only_file(p))
    changelogs_updated = sorted(p for p in changed_paths if is_changelog_file(p))
    feature_docs_updated = sorted(p for p in changed_paths if is_feature_doc_file(p))

    return {
        "non_doc_changed": non_doc_changed,
        "non_doc_added": non_doc_added,
        "changelogs_updated": changelogs_updated,
        "feature_docs_updated": feature_docs_updated,
        "has_changelog": has_existing_file(repo_root, CHANGELOG_CANDIDATES),
        "has_feature_doc": has_existing_file(repo_root, FEATURE_DOC_CANDIDATES),
    }


def get_state_path(conversation_id: str) -> str:
    """Resolve the persistent session state JSON path under PLUGIN_DATA or tmp."""
    base = os.environ.get("PLUGIN_DATA", "").strip()
    if not base:
        base = os.path.join(tempfile.gettempdir(), "repo-documenter-state")
    state_dir = os.path.join(base, "sessions")
    os.makedirs(state_dir, exist_ok=True)
    safe_id = re.sub(r"[^a-zA-Z0-9._-]", "_", conversation_id or "default")
    return os.path.join(state_dir, f"{safe_id}.json")


def load_state(state_path: str) -> Dict[str, Any]:
    """Load session state or return a fresh default structure."""
    try:
        with open(state_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, dict):
                return data
    except (OSError, json.JSONDecodeError):
        pass
    return {
        "turnActive": False,
        "turnKey": None,
        "baselines": {},
        "touchedRepos": [],
        "toolTouchedByRepo": {},
    }


def save_state(state_path: str, state: Dict[str, Any]) -> None:
    """Atomically write session state JSON."""
    state_dir = os.path.dirname(state_path)
    os.makedirs(state_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".state-", suffix=".json", dir=state_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp_path, state_path)
    except OSError:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def make_turn_key(payload: Dict[str, Any]) -> str:
    """Build a per-user-turn identifier from PreInvocation / Stop metadata."""
    initial_steps = payload.get("initialNumSteps")
    last_input = payload.get("lastUserInput") or ""
    digest = hashlib.sha256(last_input.encode("utf-8", errors="replace")).hexdigest()[:12]
    return f"{initial_steps}:{digest}"


def refresh_baselines(state: Dict[str, Any], repos: List[str]) -> None:
    """Capture fresh snapshots for all active repositories and clear turn tracking."""
    baselines: Dict[str, Any] = {}
    for repo in repos:
        baselines[repo] = snapshot_repo(repo)
    state["baselines"] = baselines
    state["touchedRepos"] = []
    state["toolTouchedByRepo"] = {}


def handle_session_start(payload: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    """Initialize baseline snapshots when a new conversation session begins."""
    repos = discover_repos(payload)
    state["turnActive"] = False
    state["turnKey"] = None
    refresh_baselines(state, repos)
    return {}


def handle_pre_invocation(payload: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    """Reset the turn baseline when a new user turn begins."""
    turn_key = make_turn_key(payload)
    if not state.get("turnActive") or state.get("turnKey") != turn_key:
        repos = discover_repos(payload)
        state["turnActive"] = True
        state["turnKey"] = turn_key
        refresh_baselines(state, repos)
    return {}


def extract_tool_file_paths(payload: Dict[str, Any]) -> List[str]:
    """Extract explicit file paths targeted by file-editing tools."""
    tool_call = payload.get("toolCall") or {}
    args = tool_call.get("args") or {}
    if not isinstance(args, dict):
        return []
    found: List[str] = []
    for key in FILE_ARG_KEYS:
        val = args.get(key)
        if isinstance(val, str) and val:
            found.append(val)
    return found


def handle_post_tool_use(payload: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    """Record repositories and files modified during the current turn."""
    if payload.get("error"):
        return {}

    if not state.get("turnActive"):
        state["turnActive"] = True
        state["turnKey"] = make_turn_key(payload)

    touched_repos = set(state.get("touchedRepos") or [])
    tool_touched_by_repo: Dict[str, List[str]] = state.get("toolTouchedByRepo") or {}
    baselines: Dict[str, Any] = state.get("baselines") or {}

    # Repos matching cwd/workspacePaths not seen at PreInvocation were initialized mid-turn.
    for repo in discover_repos(payload):
        touched_repos.add(repo)
        if repo not in baselines:
            baselines[repo] = {"head": "UNBORN", "files": {}}

    # Explicit file arguments may target a pre-existing repo outside cwd/workspacePaths.
    for file_path in extract_tool_file_paths(payload):
        repo = find_git_root(file_path)
        if not repo:
            continue
        touched_repos.add(repo)
        abs_file = os.path.realpath(os.path.expanduser(file_path))
        try:
            rel = os.path.relpath(abs_file, repo)
        except ValueError:
            continue
        if rel.startswith(".."):
            continue
        norm = normalize_rel_path(rel)
        if repo not in baselines:
            snap = snapshot_repo(repo)
            snap["files"].pop(norm, None)
            baselines[repo] = snap
        existing = tool_touched_by_repo.setdefault(repo, [])
        if norm not in existing:
            existing.append(norm)

    state["baselines"] = baselines
    state["touchedRepos"] = sorted(touched_repos)
    state["toolTouchedByRepo"] = tool_touched_by_repo
    return {}


def format_file_list(paths: List[str], limit: int = 12) -> str:
    """Format a compact comma-separated list of changed paths."""
    if len(paths) <= limit:
        return ", ".join(paths)
    shown = ", ".join(paths[:limit])
    return f"{shown}, and {len(paths) - limit} more"


def handle_stop(payload: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    """Verify repository updates are documented before the agent stops."""
    termination_reason = payload.get("terminationReason") or ""
    if termination_reason and termination_reason != "NO_TOOL_CALL":
        repos = sorted(set(discover_repos(payload)) | set(state.get("touchedRepos") or []))
        state["turnActive"] = False
        refresh_baselines(state, repos)
        return {"decision": "allow"}

    if payload.get("continuationActive"):
        repos = sorted(set(discover_repos(payload)) | set(state.get("touchedRepos") or []))
        state["turnActive"] = False
        refresh_baselines(state, repos)
        return {"decision": "allow"}

    candidate_repos = sorted(
        set(state.get("touchedRepos") or [])
        | set((state.get("baselines") or {}).keys())
        | set(discover_repos(payload))
    )

    missing_items: List[str] = []
    baselines = state.get("baselines") or {}
    tool_touched_by_repo = state.get("toolTouchedByRepo") or {}

    for repo_root in candidate_repos:
        if not os.path.isdir(repo_root):
            continue
        baseline = baselines.get(repo_root)
        # Only enforce if we tracked this turn or a tool touched it.
        if baseline is None and repo_root not in tool_touched_by_repo:
            continue
        current = snapshot_repo(repo_root)
        diff = diff_snapshots(
            repo_root,
            baseline,
            current,
            tool_touched_by_repo.get(repo_root, []),
        )
        non_doc = diff["non_doc_changed"]
        if not non_doc:
            continue

        needs_changelog = not diff["changelogs_updated"]
        needs_feature_init = not diff["has_feature_doc"] and not diff["feature_docs_updated"]
        needs_feature_new_files = bool(diff["non_doc_added"]) and not diff["feature_docs_updated"]

        if needs_changelog or needs_feature_init or needs_feature_new_files:
            missing_docs: List[str] = []
            if needs_changelog:
                missing_docs.append(
                    "the existing changelog (or create CHANGELOG.md)"
                    if diff["has_changelog"]
                    else "CHANGELOG.md"
                )
            if needs_feature_init:
                missing_docs.append("docs/FEATURES.md (initial feature catalog)")
            elif needs_feature_new_files:
                missing_docs.append(
                    "docs/FEATURES.md or FEATURES.md (document new/updated features if applicable)"
                )
            repo_name = os.path.basename(repo_root) or repo_root
            missing_items.append(
                f"Repo '{repo_name}' modified [{format_file_list(non_doc)}] without updating "
                + " and ".join(missing_docs)
                + "."
            )

    if missing_items:
        reason = (
            "Repository updates must be documented before finishing this turn. "
            + " ".join(missing_items)
            + " Record what changed (and affected paths) under `## [Unreleased]` in `CHANGELOG.md`, "
            + "and add or update affected capabilities in `docs/FEATURES.md` (or existing `FEATURES.md`)."
        )
        return {"decision": "continue", "reason": reason}

    state["turnActive"] = False
    refresh_baselines(state, candidate_repos)
    return {"decision": "allow"}


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print("{}")
        return 0
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        print("{}")
        return 0

    if not isinstance(payload, dict):
        print("{}")
        return 0

    event = payload.get("hookEventName", "")
    state_path = get_state_path(str(payload.get("conversationId") or "default"))
    state = load_state(state_path)

    if event == "SessionStart":
        out = handle_session_start(payload, state)
    elif event == "PreInvocation":
        out = handle_pre_invocation(payload, state)
    elif event == "PostToolUse":
        out = handle_post_tool_use(payload, state)
    elif event == "Stop":
        out = handle_stop(payload, state)
    else:
        out = {}

    save_state(state_path, state)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Never crash the agent lifecycle loop.
        print("{}")
        sys.exit(0)
