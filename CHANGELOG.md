# Changelog

All notable changes to **Tesserak** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **2026-11-27** — Strict `account_id`-scoped connector lookup (`ConnectionManager.get_connection_for_account`, `_resolve_account_connection`) and optional read-only platform catalog fallback (`get_platform_catalog_connection`, `get_catalog_connection`, `TESSERAK_CATALOG_AWS_*`) across AWS/EKS endpoints (`backend/connections.py`, `backend/main.py`, `backend/.env.example`, `backend/test_fixes.py`).
- **2026-11-27** — Persistent feature catalog documenting all backend endpoints, frontend routes, database models, and configuration (`docs/FEATURES.md`).
- **2026-11-26** — Hybrid memory + PostgreSQL EC2 catalog persistence table (`AwsCatalogCacheRecord` / `aws_catalog_cache`) and live AWS EC2 instance-type filtering by EKS AMI type with vCPU/memory/architecture/GPU metadata (`backend/db.py`, `backend/main.py`, `frontend/src/components/CreateCluster/InstanceTypeSelect.tsx`, `frontend/src/components/CreateCluster/NumericCountField.tsx`).
- **2026-11-26** — Live Kubernetes node and paginated pod inspector modal (`10` pods per page), reusable destructive action confirmation dialog, and automatic Kubernetes workload cleanup on pipeline deletion (`frontend/src/components/Clusters/NodeDetailsDialog.tsx`, `frontend/src/components/ConfirmDeleteDialog.tsx`, `backend/pipelines_service.py` `cleanup_pipeline_deployments_sync`, `backend/tesserak_router.py`).
- **2026-11-26** — Cluster Access (`bootstrapClusterCreatorAdminPermissions`, `authenticationMode`), Prod-gated `deletionProtection`, and IPv4/IPv6 + `serviceIpv4Cidr` controls in the launch wizard (`frontend/src/components/CreateCluster/ClusterBasicDetails.tsx`, `ClusterEnvironment.tsx`, `ClusterPreview.tsx`, `backend/main.py`).
- **2026-11-25** — PostgreSQL persistence layer and JSON migration script for users, encrypted AWS connectors, cluster state, integrations, guardrails, approvals, pending resources, and pipelines (`backend/db.py`, `backend/migrate_json_to_pg.py`, `backend/auth.py`).

### Changed
- **2026-11-27** — Served cached EC2 instance types directly via `_get_cached_ec2_catalog_only` when `refresh=false` without requiring AWS credentials (`backend/main.py`).
- **2026-11-27** — Prioritized prefix matches over substring matches and raised filtered autocomplete capacity (`300`, unfiltered `150`) in `InstanceTypeSelect` (`frontend/src/components/CreateCluster/InstanceTypeSelect.tsx`, `frontend/src/components/CreateCluster/CreateClusterWizard.test.tsx`).
- **2026-11-26** — Switched routing from `HashRouter` to `BrowserRouter` for clean URLs without `#` fragments (`frontend/src/App.tsx`, `frontend/src/App.test.tsx`, `frontend/src/pages/OverviewAndClusters.test.tsx`).
- **2026-11-26** — Expanded Environment Setup modal (`maxWidth="lg"`), hid already-selected subnets via `filterSelectedOptions`, and enforced 7-day UTC-safe soft-delete cluster retention (`DELETED_CLUSTER_RETENTION_DAYS = 7`) (`frontend/src/components/CreateCluster/ClusterEnvironment.tsx`, `backend/main.py`).
- **2026-11-26** — Waited for `kubectl rollout status` in Stage 5 pipeline pod verification and switched S3 resource discovery to paginated newest-first ordering (`backend/pipelines_service.py`, `backend/resources_service.py`).
- **2026-11-25** — Updated dynamic EKS Kubernetes version, AWS SSM recommended AMI ID, and AWS + community add-on version discovery (`backend/main.py`, `frontend/src/components/CreateCluster/ClusterAddons.tsx`, `frontend/src/pages/ClusterDetails.tsx`).

### Removed
- **2026-11-27** — Unused duplicate `NumericCountField` file outside `CreateCluster/` (`frontend/src/components/NumericCountField.tsx`).

### Fixed
- **2026-11-27** — Fixed `InstanceTypeSelect` fighting Backspace clearing and typing by decoupling controlled `inputText` state (`isEditingRef`) from parent selection (`frontend/src/components/CreateCluster/InstanceTypeSelect.tsx`).
- **2026-11-26** — Fixed pipeline stdout/stderr `Hide Logs` toggle resetting unexpectedly across polling refreshes (`frontend/src/pages/Pipelines.tsx`, `frontend/src/pages/PipelinesAndCloudResources.test.tsx`).
