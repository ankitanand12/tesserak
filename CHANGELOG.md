# Changelog

All notable changes and architectural updates for **Tesserak** are documented in this file.

---

## Unreleased / Recent Improvements

### EKS Launch Wizard & Networking Ergonomics
- **Instance Type Clear & Complete Search (`frontend/src/components/CreateCluster/InstanceTypeSelect.tsx`)**:
  - Decoupled controlled `inputText` state from normalized parent selection to allow clearing the field completely with Backspace or clear button (`×`) without snapping back mid-typing.
  - Added prefix-first ranking (exact prefix matches before substring matches), higher filtered result cap (`300`, unfiltered top `150`), and richer vCPU / Memory GiB / architecture / GPU option chips.
- **Expanded Cluster Environment Setup (`frontend/src/components/CreateCluster/ClusterEnvironment.tsx`)**:
  - Enlarged the Environment Setup dialog (`maxWidth="lg"`, responsive `92vw` up to `1080px`) so subnet, nodegroup, and instance selectors have room without cramped scrolling.
  - Added `NumericCountField` (`frontend/src/components/CreateCluster/NumericCountField.tsx`) so min/desired/max node counts can be cleared and typed directly before blur validation.
  - Enabled `filterSelectedOptions` on public/private subnet pickers so already-selected subnets are hidden from the dropdown list.
- **Advanced Cluster Access, Deletion Protection & IP Networking (`ClusterBasicDetails.tsx`, `ClusterEnvironment.tsx`, `backend/main.py`)**:
  - Added configurable `bootstrapClusterCreatorAdminPermissions` and `authenticationMode` (`API_AND_CONFIG_MAP` / `API` / `CONFIG_MAP`).
  - Added `deletionProtection` option scoped to Production environment selections.
  - Added IPv4/IPv6 family selection and custom `serviceIpv4Cidr` configuration.
- **Clean URL Routing (`frontend/src/App.tsx`)**:
  - Switched from `HashRouter` to `BrowserRouter` to eliminate `#` URL fragments across routes and tests.

### Multi-Account AWS Scoping & Hybrid Catalog Caching
- **Strict Account-Scoped Connector Lookup (`backend/connections.py`, `backend/main.py`)**:
  - Added `ConnectionManager.get_connection_for_account` and `_resolve_account_connection` so account-scoped AWS & EKS endpoints strictly select the connector matching `account_id` when provided.
- **Hybrid Memory + PostgreSQL Catalog Caching (`backend/db.py`, `backend/main.py`)**:
  - Added `AwsCatalogCacheRecord` (`aws_catalog_cache` table) storing per-region EC2 instance type metadata in PostgreSQL alongside fast in-memory caching.
  - Added `_get_cached_ec2_catalog_only` so cached instance catalogs load immediately (`refresh=false`) without requiring AWS credentials.
  - Added `get_platform_catalog_connection` / `get_catalog_connection` supporting optional platform read-only IAM env vars (`TESSERAK_CATALOG_AWS_ACCESS_KEY_ID`, `TESSERAK_CATALOG_AWS_SECRET_ACCESS_KEY`, `TESSERAK_CATALOG_AWS_REGION`) documented in `backend/.env.example`.

### Cluster Operations, Pods Inspection & Safe Deletions
- **Deleted Cluster 7-Day Retention (`backend/main.py`)**:
  - Added `DELETED_CLUSTER_RETENTION_DAYS = 7` using UTC-safe age filtering so deleted clusters remain visible for audit for 7 days before automatic removal.
- **Live Kubernetes Node & Pod Inspection (`backend/main.py`, `frontend/src/pages/ClusterDetails.tsx`, `frontend/src/components/Clusters/NodeDetailsDialog.tsx`)**:
  - Added live `kubectl get nodes,pods -A -o json` integration returning cluster nodes and pods.
  - Added `NodeDetailsDialog` with clickable node inspection and paginated pod lists (`10` pods per page).
- **CI/CD Pipeline Reliability & Cleanup (`backend/pipelines_service.py`, `backend/tesserak_router.py`, `frontend/src/pages/Pipelines.tsx`)**:
  - Added `kubectl rollout status` wait during Stage 5 Pod Verification so completed pipelines reflect running pod readiness.
  - Fixed log visibility toggle behavior across live pipeline polling refreshes.
  - Added `cleanup_pipeline_deployments_sync` triggered automatically on `DELETE /api/pipelines/{id}` (`cleanup_cluster=true` default).
- **Cloud Resources Discovery (`backend/resources_service.py`)**:
  - Switched S3/SQS listing to paginated newest-first discovery so newly created resources sync and update counts immediately.
- **Global Destructive Confirmations (`frontend/src/components/ConfirmDeleteDialog.tsx`)**:
  - Standardized double-check delete confirmation dialogs across clusters, nodegroups, pipelines, cloud resources, connectors, and integrations.
