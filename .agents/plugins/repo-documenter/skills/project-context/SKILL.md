---
name: project-context
description: >-
  Create PROJECT_CONTEXT.md at the repository root if missing, or inspect and
  update an existing PROJECT_CONTEXT.md to match the current codebase,
  architecture, dependencies, entrypoints, commands, and configuration. Use when
  the user asks to generate, refresh, or update project context, onboarding
  context, or PROJECT_CONTEXT.md.
---

# Project Context (`project-context`)

Use this skill to create `PROJECT_CONTEXT.md` in a repository when it does not exist yet, or to audit and update an existing `PROJECT_CONTEXT.md` so it reflects the latest state of the codebase.

## Workflow

### 1. Inspect the Repository

Run the context-inspection script bundled with this skill (`./scripts/inspect_project_context.py`) against the target repository root:

```bash
python3 ./scripts/inspect_project_context.py --repo "<repo-root>"
```

This reports:
- Whether `PROJECT_CONTEXT.md` already exists (and when it was last committed/updated).
- Detected manifests and tech stack (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pubspec.yaml`, `pom.xml`, `build.gradle*`, `Makefile`, `Dockerfile`, etc.).
- Directory structure and key source/test/config paths.
- Recent commits since `PROJECT_CONTEXT.md` was last updated (if it already exists).
- Existing `README.md`, `CHANGELOG.md`, and `docs/FEATURES.md` if present.

### 2. Inspect Source & Configuration Directly

Before writing or editing `PROJECT_CONTEXT.md`, verify facts directly from the repository:
- Read detected manifest files for project name, runtime/language versions, dependencies, and build/test/lint/start scripts.
- Inspect primary entrypoints, routing/CLI definitions, and module layout.
- Check `.env.example` or config templates for required environment variables (never copy real secrets or `.env` values).
- If `PROJECT_CONTEXT.md` already exists, read it completely so you preserve accurate custom notes, architecture decisions, and conventions while updating stale sections.

### 3. Create or Update `PROJECT_CONTEXT.md`

Read [project-context-template.md](./references/project-context-template.md) for the canonical structure.

- **If `PROJECT_CONTEXT.md` is missing**:
  - Create `PROJECT_CONTEXT.md` at the repository root (`<repo-root>/PROJECT_CONTEXT.md`).
  - Populate every relevant section from verified repository files (omit sections that do not apply rather than inventing placeholders).
- **If `PROJECT_CONTEXT.md` already exists**:
  - Compare every section against the current repository state and recent commits since `PROJECT_CONTEXT.md` was last updated.
  - Update outdated tech stack versions, dependencies, directory trees, entrypoints, commands, environment variables, architecture notes, and current status/focus.
  - Remove references to deleted files/modules/commands and add newly introduced ones.
  - Update the `Last Updated` date (`YYYY-MM-DD`) and commit/baseline reference if shown.

### 4. Guardrails

- **Verify Every Fact**: Include only file paths, symbols, commands, dependencies, and behaviors directly observed in the repository.
- **No Secrets**: Never copy API keys, tokens, passwords, or private `.env` values into `PROJECT_CONTEXT.md`.
- **Keep It Concise & Actionable**: Write for fast AI and developer onboarding — clear architecture map, exact commands, and key conventions without redundant prose.

### 5. Verify

1. Confirm all file paths and commands listed in `PROJECT_CONTEXT.md` exist in the repository.
2. Check `git -C "<repo-root>" diff -- PROJECT_CONTEXT.md` (or `git status --short`) and summarize what was created or updated.
