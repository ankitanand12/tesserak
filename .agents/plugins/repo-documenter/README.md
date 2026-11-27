# Repo Documenter (`repo-documenter`)

An Antigravity plugin that ensures every code, configuration, and feature update in a Git repository is documented consistently in `CHANGELOG.md` and `docs/FEATURES.md` (or the repository's existing changelog and feature docs).

## What It Includes

- **Always-On Rule (`rules/AGENTS.md`)**: Guides the agent to update `CHANGELOG.md` for every repository change, keep `docs/FEATURES.md` current whenever features are added, modified, or removed, and keep `README.md` / interface docs aligned.
- **Lifecycle Hooks (`hooks.json` + `scripts/track_repo_changes.py`)**:
  - `SessionStart` & `PreInvocation`: Captures a per-turn baseline snapshot of Git repositories in the active workspace/cwd so pre-existing dirty files outside the current turn don't cause false alarms.
  - `PostToolUse`: Tracks file edits and mutating shell commands inside Git repositories during the turn.
  - `Stop`: Verifies before ending a turn that any non-doc repository changes made during the turn have corresponding `CHANGELOG.md` (and `docs/FEATURES.md` when missing or when new files were added) updates, prompting once if forgotten (`continuationActive` prevents loops).
- **Skills**:
  - **`sync-repo-docs` (`skills/sync-repo-docs/SKILL.md`)**:
    - Audits uncommitted changes and git commit history (`scripts/inspect_repo_changes.py`).
    - Initializes or catches up `CHANGELOG.md` and `docs/FEATURES.md` from repo history.
    - Cuts versioned releases from `[Unreleased]`.
    - Optionally installs a non-destructive local `.git/hooks/post-commit` tracker (`scripts/install_git_hook.sh`) for commits made outside Antigravity.
  - **`project-context` (`skills/project-context/SKILL.md`)**:
    - Creates `PROJECT_CONTEXT.md` at the repository root if missing, or inspects and updates an existing `PROJECT_CONTEXT.md` to match the latest stack, architecture, entrypoints, commands, and configuration (`scripts/inspect_project_context.py`).

## Managing the Plugin

You can enable or disable **Repo Documenter** anytime from the **Customizations** panel in Antigravity. When disabled, its rules, hooks, and skills are deactivated cleanly as a single unit.

---

## Cross-IDE Setup (Works Everywhere)

The full plugin (hooks + skills) is Antigravity-specific. For other AI coding agents, the **documentation policy rules** are installed as instruction files each agent reads natively.

### Install Only for the IDE You Use

Pass `--target <ide>` so only that IDE's files are created in your repo (no extra folders or root files):

```bash
# Antigravity only (.agents/plugins/repo-documenter/)
bash /path/to/repo-documenter/setup.sh --target antigravity /path/to/your-repo

# VS Code GitHub Copilot only (.github/copilot-instructions.md)
bash /path/to/repo-documenter/setup.sh --target copilot /path/to/your-repo

# Claude Code only (CLAUDE.md + .claude/settings.json + .claude/hooks/)
bash /path/to/repo-documenter/setup.sh --target claude /path/to/your-repo

# Cursor only (.cursor/rules/repo-documenter.mdc)
bash /path/to/repo-documenter/setup.sh --target cursor /path/to/your-repo

# Windsurf only (.windsurfrules)
bash /path/to/repo-documenter/setup.sh --target windsurf /path/to/your-repo

# Gemini CLI only (GEMINI.md)
bash /path/to/repo-documenter/setup.sh --target gemini /path/to/your-repo

# All IDEs at once
bash /path/to/repo-documenter/setup.sh --target all /path/to/your-repo
```

Add `--with-git-hooks` to any command above if you also want local `.git/hooks/post-commit` & `post-merge` tracking for manual commits.

### What Gets Installed

| Agent / IDE | File Created | How It Works |
| :--- | :--- | :--- |
| **Antigravity** (2.0, CLI, IDE) | `.agents/plugins/repo-documenter/` | Full plugin: hooks auto-enforce + skills on demand |
| **Claude Code** | `CLAUDE.md` + `.claude/settings.json` | Rules + `Stop` hook auto-enforces docs |
| **Gemini CLI** | `GEMINI.md` | Rules appended, always read |
| **GitHub Copilot** (VS Code) | `.github/copilot-instructions.md` | Rules appended, always read |
| **Cursor** | `.cursor/rules/repo-documenter.mdc` | MDC rule file, `alwaysApply: true` |
| **Windsurf / Codeium** | `.windsurfrules` | Rules appended, always read |

### What Works Where

| Feature | Antigravity | Claude Code | Copilot / Cursor / Windsurf / Gemini CLI |
| :--- | :---: | :---: | :---: |
| Always-on documentation policy | ✅ | ✅ | ✅ |
| `PROJECT_CONTEXT.md` create & update | ✅ | ✅ | ✅ |
| Bulk git commit audit & release cutting | ✅ | ✅ | ✅ (via embedded git steps + scripts) |
| Hard-block `Stop` hook enforcement | ✅ | ✅ | ❌ (IDE runtime has no stop hooks; uses self-check rule) |
| Git post-commit tracking hooks | ✅ | ✅ | ✅ (with `--with-git-hooks`) |

---

## Cutting a Release

The plugin **never** invents version numbers or cuts releases automatically. Normal changes are always recorded under `## [Unreleased]` in `CHANGELOG.md`.

When you are ready to release, simply ask the agent in plain English, for example:

- *"Cut release v1.2.0"*

It will move everything under `## [Unreleased]` into `## [v1.2.0] - YYYY-MM-DD`, leave a fresh `## [Unreleased]` section at the top, keep `docs/FEATURES.md` aligned, and ask you:

- **Create a Git tag?** (e.g., `git tag -a v1.2.0 -m "Release v1.2.0"`)
- **Commit the release docs?** (e.g., `chore(release): v1.2.0`)
- **Push commit/tag to remote?** (only if you want it pushed)
