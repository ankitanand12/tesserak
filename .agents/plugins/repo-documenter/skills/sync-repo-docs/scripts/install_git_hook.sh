#!/usr/bin/env bash
# Install or uninstall non-destructive Git post-commit and post-merge tracking
# hooks for repo-documenter. Logs undocumented commits to .git/repo-doc-pending.jsonl.

set -euo pipefail

UNINSTALL=false
TARGET_DIR="."

for arg in "$@"; do
  case "$arg" in
    --uninstall)
      UNINSTALL=true
      ;;
    -h|--help)
      echo "Usage: install_git_hook.sh [--uninstall] [repo-path]"
      exit 0
      ;;
    *)
      TARGET_DIR="$arg"
      ;;
  esac
done

REPO_ROOT="$(git -C "$TARGET_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "Error: '$TARGET_DIR' is not inside a Git repository." >&2
  exit 1
fi

HOOKS_DIR="$(git -C "$REPO_ROOT" rev-parse --git-path hooks)"
if [[ "$HOOKS_DIR" != /* ]]; then
  HOOKS_DIR="$REPO_ROOT/$HOOKS_DIR"
fi
mkdir -p "$HOOKS_DIR"

MARKER_START="# >>> repo-documenter >>>"
MARKER_END="# <<< repo-documenter <<<"

remove_block() {
  local hook_file="$1"
  [[ -f "$hook_file" ]] || return 0
  python3 - "$hook_file" "$MARKER_START" "$MARKER_END" <<'PY'
import os, sys
path, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as fh:
    lines = fh.readlines()
out = []
skip = False
for line in lines:
    if start in line:
        skip = True
        continue
    if end in line:
        skip = False
        continue
    if not skip:
        out.append(line)
remaining = "".join(out).strip()
if not remaining or remaining == "#!/usr/bin/env bash" or remaining == "#!/bin/sh":
    os.remove(path)
else:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("".join(out))
PY
}

install_block() {
  local hook_file="$1"
  local event_name="$2"
  remove_block "$hook_file"
  if [[ ! -f "$hook_file" ]]; then
    printf '#!/usr/bin/env bash\n' > "$hook_file"
  fi
  cat >> "$hook_file" <<EOF

$MARKER_START
python3 - "$event_name" <<'PY'
import json, os, subprocess, sys
event_name = sys.argv[1]
try:
    sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    date_s = subprocess.check_output(["git", "show", "-s", "--format=%cs", "HEAD"], text=True).strip()
    subj = subprocess.check_output(["git", "show", "-s", "--format=%s", "HEAD"], text=True).strip()
    files = subprocess.check_output(["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "HEAD"], text=True).splitlines()
    git_dir = subprocess.check_output(["git", "rev-parse", "--git-dir"], text=True).strip()
except Exception:
    sys.exit(0)

doc_names = {"changelog.md", "docs/changelog.md", "changes.md", "history.md", "features.md", "docs/features.md"}
non_doc = [f for f in files if not (f.lower() in doc_names or f.lower().endswith((".md", ".mdx", ".rst")))]
has_doc_update = any(f.lower() in doc_names for f in files)
if non_doc and not has_doc_update:
    os.makedirs(git_dir, exist_ok=True)
    queue_path = os.path.join(git_dir, "repo-doc-pending.jsonl")
    with open(queue_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"event": event_name, "sha": sha, "date": date_s, "subject": subj, "files": non_doc[:30]}) + "\n")
    print(f"[repo-documenter] Queued {sha} ({len(non_doc)} non-doc file(s)) for CHANGELOG.md / docs/FEATURES.md sync.")
PY
$MARKER_END
EOF
  chmod +x "$hook_file"
}

if [[ "$UNINSTALL" == "true" ]]; then
  remove_block "$HOOKS_DIR/post-commit"
  remove_block "$HOOKS_DIR/post-merge"
  echo "Removed repo-documenter hooks from $HOOKS_DIR"
else
  install_block "$HOOKS_DIR/post-commit" "post-commit"
  install_block "$HOOKS_DIR/post-merge" "post-merge"
  echo "Installed repo-documenter post-commit and post-merge hooks in $HOOKS_DIR"
fi
