#!/usr/bin/env python3
"""Claude Code Stop hook for repo-documenter.

Blocks Claude Code from stopping if non-doc tracked/untracked files in the Git
repository are modified in the working tree without CHANGELOG.md (or
docs/FEATURES.md) being modified. Respects `stop_hook_active` to avoid loops.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

CHANGELOG_NAMES = {
    "changelog.md",
    "changelog",
    "changes.md",
    "history.md",
    "docs/changelog.md",
}
FEATURE_NAMES = {
    "features.md",
    "docs/features.md",
    "feature_catalog.md",
    "docs/feature_catalog.md",
}
DOC_EXTS = {".md", ".mdx", ".rst", ".txt", ".adoc"}


def is_doc_only(rel_path: str) -> bool:
    norm = rel_path.replace("\\", "/").lstrip("./").lower()
    if norm in CHANGELOG_NAMES or norm in FEATURE_NAMES:
        return True
    _, ext = os.path.splitext(norm)
    return ext in DOC_EXTS


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        return 0
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return 0

    if payload.get("stop_hook_active"):
        return 0

    cwd = payload.get("cwd") or os.getcwd()
    try:
        root = subprocess.check_output(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=3,
        ).strip()
        status_out = subprocess.check_output(
            ["git", "-C", root, "status", "--porcelain=v1", "-uall"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=3,
        )
    except Exception:
        return 0

    changed_non_doc = []
    changelog_touched = False
    for line in status_out.splitlines():
        if len(line) < 4:
            continue
        path = line[3:].strip().strip('"')
        norm = path.replace("\\", "/").lstrip("./").lower()
        if norm in CHANGELOG_NAMES:
            changelog_touched = True
        elif not is_doc_only(path):
            changed_non_doc.append(path)

    if changed_non_doc and not changelog_touched:
        sample = ", ".join(changed_non_doc[:10])
        if len(changed_non_doc) > 10:
            sample += f", and {len(changed_non_doc) - 10} more"
        print(
            json.dumps(
                {
                    "decision": "block",
                    "reason": (
                        f"Repository files ({sample}) were modified without updating CHANGELOG.md "
                        "and docs/FEATURES.md (if features changed). Document these changes before stopping."
                    ),
                }
            )
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
