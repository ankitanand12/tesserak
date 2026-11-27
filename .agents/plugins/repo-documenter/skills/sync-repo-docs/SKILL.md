---
name: sync-repo-docs
description: >-
  Audit Git history and working-tree changes to initialize, catch up, or release
  CHANGELOG.md and docs/FEATURES.md, and optionally install local Git commit
  tracking hooks. Use when the user asks to document recent commits or manual
  changes, initialize repo documentation, build a feature catalog, cut a
  changelog release, or track commits made outside Antigravity.
---

# Sync Repository Documentation (`sync-repo-docs`)

Use this skill to bring a Git repository's `CHANGELOG.md` and `docs/FEATURES.md` (or existing equivalents) into complete sync with working-tree edits, recent commits, or full repository capabilities.

## Workflow

### 1. Inspect Repository State and History

Run the inspection script bundled with this skill (`./scripts/inspect_repo_changes.py`) against the target repository root:

```bash
python3 ./scripts/inspect_repo_changes.py --repo "<repo-root>"
```

Optional flags:
- `--since <git-ref>` — inspect commits since a specific tag, branch, or commit SHA.
- `--limit <n>` — maximum number of commits to inspect (default `30`).
- `--json` — machine-readable JSON output.
- `--clear-pending` — clear `.git/repo-doc-pending.jsonl` after documenting queued commits.

Review the script output to identify:
- Existing documentation files (`CHANGELOG.md`, `docs/FEATURES.md`, `FEATURES.md`, `README.md`, etc.) so you update existing files rather than creating duplicates.
- Uncommitted staged, unstaged, and untracked changes.
- Undocumented commits since the last commit that modified changelog/feature docs (plus any entries queued in `.git/repo-doc-pending.jsonl`).

### 2. Initialize Missing Docs (First-Time Setup)

If `CHANGELOG.md` or `docs/FEATURES.md` does not yet exist in the repository:

1. Read [templates.md](./references/templates.md) for the standard `CHANGELOG.md` and `docs/FEATURES.md` formats.
2. Explore the repository's manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pubspec.yaml`, etc.), entrypoints, routes, CLI commands, and modules directly so every documented feature reflects actual code.
3. Create `docs/FEATURES.md` (or update existing `FEATURES.md`) with an accurate overview table and per-feature sections.
4. Create `CHANGELOG.md` with `## [Unreleased]` summarizing recent commits or current baseline updates accurately.

### 3. Update `CHANGELOG.md` and `docs/FEATURES.md`

For each undocumented commit or working-tree change:
1. Read the relevant diffs or modified source files when commit messages alone are ambiguous (`git -C <repo> show --stat <sha>` or `git -C <repo> diff`).
2. Add concise, accurate entries under `## [Unreleased]` in `CHANGELOG.md` grouped by `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security`, citing affected files/symbols and date (`YYYY-MM-DD`).
3. Update `docs/FEATURES.md` whenever a feature is introduced, extended, altered, or removed, keeping the status table and feature details synchronized.
4. Update `README.md` if installation, configuration, CLI usage, or public APIs changed.
5. If `.git/repo-doc-pending.jsonl` had queued commits and you documented them all, clear the queue:

```bash
python3 ./scripts/inspect_repo_changes.py --repo "<repo-root>" --clear-pending
```

### 4. Cut a Versioned Release (When Requested)

When the user asks to prepare or cut a release (e.g., `v1.2.0`):
1. Move entries under `## [Unreleased]` into `## [v1.2.0] - YYYY-MM-DD` (matching the repo's existing version heading convention if one already exists).
2. Leave an empty `## [Unreleased]` heading above the new release.
3. Keep `docs/FEATURES.md` statuses (`Active`, `Deprecated`, etc.) aligned with the release.
4. Ask the user whether they also want to: (1) commit the release docs, (2) create a Git tag (`v1.2.0`), and (3) push the commit/tag to remote.

### 5. Optional: Install Local Git Hooks (Only When Requested)

When the user explicitly asks to track commits or merges made outside Antigravity (e.g., in a terminal or IDE):

```bash
bash ./scripts/install_git_hook.sh "<repo-root>"
```

This appends a non-destructive `repo-documenter` block to `.git/hooks/post-commit` and `.git/hooks/post-merge` (preserving existing hooks) that records undocumented non-doc commits to `.git/repo-doc-pending.jsonl` and prints a reminder in the terminal. Pass `--uninstall` to remove the block cleanly.

### 6. Verify Before Finishing

1. Confirm `CHANGELOG.md` and `docs/FEATURES.md` have valid Markdown formatting, no duplicate sections, and only verified file paths and behavior.
2. Run `git -C "<repo-root>" status --short` to review the modified documentation files and summarize what was documented.
