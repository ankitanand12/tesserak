# Project Context Template

Use this structure when creating `PROJECT_CONTEXT.md` at the repository root. When updating an existing `PROJECT_CONTEXT.md`, preserve useful custom sections and bring all facts into sync with the current codebase.

```markdown
# Project Context

> **Last Updated**: YYYY-MM-DD

## Overview
- **Name**: <project name>
- **Purpose**: 1–3 sentences describing what the project does and who it serves.
- **Tech Stack**: <languages, frameworks, databases, key libraries>

## Repository Structure
```text
.
├── src/          # Core application source
├── tests/        # Automated tests
└── docs/         # Documentation and feature catalog
```

## Architecture & Key Entrypoints
- **Entrypoint(s)**: `path/to/main` — brief description
- **Core Modules**:
  - `path/to/module` — responsibility
- **Data / External Integrations**: databases, APIs, queues, or services (if any)

## Development Commands
- **Install**: `<command>`
- **Run / Dev**: `<command>`
- **Test**: `<command>`
- **Lint / Build**: `<command>`

## Configuration & Environment
- Document required config files and environment variable names (e.g., from `.env.example`) without including secret values.

## Conventions & Notes
- Coding standards, branching/release notes, or important architectural constraints.
- Related docs: `README.md`, `CHANGELOG.md`, `docs/FEATURES.md` (list those present).
```
