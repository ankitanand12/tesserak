# Repository Change & Feature Documentation Policy

Whenever you create, modify, rename, or delete code, configuration, schemas, scripts, or build assets inside a Git repository, keep the repository's change history and feature documentation up to date before concluding your turn.

## Required Documentation Updates

1. **Record Every Change (`CHANGELOG.md`)**:
   - Inspect the repository first for an existing changelog (`CHANGELOG.md`, `docs/CHANGELOG.md`, `CHANGES.md`, or `HISTORY.md`) and update it in place. If none exists, create `CHANGELOG.md` at the repository root.
   - Add concise bullet entries under `## [Unreleased]` grouped by Keep a Changelog sections (`### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`), including the date (`YYYY-MM-DD`) and the affected repo-relative file paths or symbols in backticks.
   - Preserve existing versioned release sections and prior `[Unreleased]` entries unless the user explicitly asks to cut a release.

2. **Maintain the Feature Catalog (`docs/FEATURES.md`)**:
   - Inspect the repository for an existing feature doc (`docs/FEATURES.md`, `FEATURES.md`, or `docs/FEATURE_CATALOG.md`) and update it in place. If none exists, create `docs/FEATURES.md`.
   - Whenever a feature, endpoint, CLI command, UI screen, integration, workflow, or capability is added, modified, deprecated, or removed, update the summary index table and the corresponding feature section (purpose, key files/symbols, configuration/usage, and a dated update note).

3. **Keep Interface & Context Docs Aligned (`README.md` & `PROJECT_CONTEXT.md`)**:
   - Inspect the repository for `PROJECT_CONTEXT.md` at the repo root. If it does not exist, create `PROJECT_CONTEXT.md` using the `project-context` skill. If it exists and architecture, dependencies, directory layout, entrypoints, or dev/test commands changed, update `PROJECT_CONTEXT.md` to stay current.
   - Update `README.md` or nearby module documentation whenever setup steps, CLI flags, environment variables, public APIs, or user-facing workflows change.

## Guardrails & Skip Conditions

- **Verify Every Fact**: Document only files, symbols, behaviors, and outputs directly observed in the repository. Do not guess version tags or unverified behavior.
- **Skip Doc-Only & Read-Only Turns**: Do not add `CHANGELOG.md` churn for read-only Q&A turns or purely editorial documentation updates (such as fixing typos in `README.md` or running doc syncs).
- **Large Audits & Catch-Up Syncs**: When asked to initialize repository documentation from scratch, document past commits made outside Antigravity, cut a changelog release, or install local Git tracking hooks, activate the `sync-repo-docs` skill.
