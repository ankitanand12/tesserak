# Documentation Templates

Adapt these templates to match the repository's existing style if `CHANGELOG.md` or `docs/FEATURES.md` already exists.

## `CHANGELOG.md` Template

```markdown
# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **2026-11-26** — Description of the new feature or capability (`path/to/file.ext`).

### Changed
- **2026-11-26** — Description of updated behavior or configuration (`path/to/file.ext`).

### Fixed
- **2026-11-26** — Description of bug fix and root cause (`path/to/file.ext`).

### Removed
- **2026-11-26** — Description of removed code, flag, or endpoint (`path/to/file.ext`).
```

## `docs/FEATURES.md` Template

```markdown
# Feature Catalog

Living inventory of implemented features and capabilities in this repository.

## Feature Index

| Feature | Status | Key Entrypoints / Files | Last Updated |
| :--- | :--- | :--- | :--- |
| Example Feature | Active | `src/example.py` | 2026-11-26 |

---

## Example Feature

- **Status**: Active
- **Purpose**: Concise summary of what this feature does and who uses it.
- **Entrypoints & Implementation**:
  - `src/example.py` — main logic and exported handlers
- **Configuration & Usage**:
  - Env vars, flags, routes, or CLI commands (omit if none).
- **Recent Updates**:
  - **2026-11-26**: Initial feature documentation added.
```
