# Tesserak Project Context

This document captures the current architecture, design decisions, database schema, API contracts, and UI patterns for **Tesserak** (`/Users/ankit/TW/tesserak`).

---

## 1. Tech Stack Summary

| Layer | Technologies | Notes |
| :--- | :--- | :--- |
| **Backend API** | FastAPI `0.104.1`, Uvicorn `0.24.0`, Pydantic `2.4.2` | Serves on `http://localhost:8000` (`backend/main.py` + `backend/tesserak_router.py`) |
| **AWS & Infra SDKs** | Boto3 `1.29.0`, CLI (`git`, `docker`, `aws`, `kubectl`) | Used for EKS, EC2, SSM, S3, SQS, STS, kubeconfig updates, and pod rollout verification |
| **Database** | PostgreSQL + SQLAlchemy `>=2.0,<2.1` + `psycopg2-binary>=2.9.9` | Configured via `DATABASE_URL` (default: `postgresql://tesserak:tesserak123@localhost:5432/tesserak`) |
| **Secret Encryption** | `cryptography>=41.0.0` (Fernet) | Encrypts AWS IAM secrets and integration tokens at rest in PostgreSQL |
| **Auth** | `@auth0/auth0-react` (`^2.30.0`), `auth0-fastapi-api` + local workspace fallback | Handled in `backend/auth.py` and `frontend/src/auth/AuthContext.tsx` |
| **Frontend UI** | React `^19.2.0`, TypeScript `^4.9.5`, React Router `^7.14.1` (`BrowserRouter`) | SPA on `http://localhost:3000`; `#` hash URLs removed in favor of clean paths |
| **UI Library** | Material UI `^5.16.14`, `@mui/lab` `^5.0.0-alpha.173`, Emotion `^11.14.0`, Recharts `^3.8.1` | Pinned to MUI v5; install frontend packages with `--legacy-peer-deps` |

---

## 2. Database Models (`backend/db.py`)

`DatabaseManager` manages SQLAlchemy ORM models in PostgreSQL:

| Model / Table | Purpose |
| :--- | :--- |
| `SettingRecord` | Platform key/value settings & encryption salt/key metadata |
| `AwsCatalogCacheRecord` (`aws_catalog_cache`) | Persists JSON payloads keyed by `cache_key` (e.g., `ec2_instance_types:<region>`) with `updated_at` |
| `UserRecord` | User accounts & roles |
| `AwsConnectionRecord` | Multi-account AWS IAM connectors per user with encrypted credentials & STS account validation |
| `ClusterStateRecord` | Tracked EKS cluster state snapshots, creator/account metadata, and soft-delete timestamps |
| `IntegrationRecord` | Connected third-party developer tools / SCM / registry integrations |
| `GuardrailRuleRecord` | Policy rules enforced across clusters, resources, and manifests |
| `ApprovalRecord` | Pending/resolved guardrail approval requests |
| `PendingResourceRecord` | Provisioned or tracked AWS cloud resources & drift metadata |
| `PipelineRecord` | GitOps pipeline definitions, target cluster references, and run logs |

---

## 3. Core Backend Behaviors & Decisions

### Strict Multi-Account Connector Scoping (`backend/connections.py`, `backend/main.py`)
- `ConnectionManager.get_connection_for_account(user_email, account_id)` validates a user's STS-verified connector matching `account_id`.
- Account-scoped endpoints (`get_aws_regions`, `get_aws_vpcs`, `get_aws_availability_zones`, `get_aws_vpc_subnets`, `create_vpc`, `create_cluster`, `_list_clusters_sync`, `_get_cluster_details_sync`, `create_cluster_nodegroup`, `scale_cluster_nodegroup`, `delete_cluster_nodegroup`, `delete_cluster`, `sync_cluster_state`) use `_resolve_account_connection(user_email, account_id)` so multi-account requests do not silently fall back to the first connector when a specific `account_id` is supplied.

### Hybrid Catalog Caching & Optional Platform Read-Only Fallback
- EC2 instance type metadata per region is stored in an in-memory map backed by `AwsCatalogCacheRecord` (`aws_catalog_cache`).
- `_get_cached_ec2_catalog_only(region)` reads from memory or PostgreSQL **without requiring AWS credentials** when `refresh=False` and data is already cached (`$0` AWS cost, instant UI load).
- When a cache miss occurs or `refresh=True`, `get_catalog_connection(user_email, account_id)` resolves:
  1. Platform read-only fallback (`TESSERAK_CATALOG_AWS_ACCESS_KEY_ID`, `TESSERAK_CATALOG_AWS_SECRET_ACCESS_KEY`, `TESSERAK_CATALOG_AWS_REGION`) when configured, or
  2. The user's `account_id` connector (or first active user connector if `account_id` is omitted or `'catalog'`).
- Read-only AWS catalog APIs (`eks:DescribeAddonVersions`, `ec2:DescribeInstanceTypes`, standard `ssm:GetParameter`) reject unsigned HTTP calls, so credentials (either platform catalog IAM or user connector) are used when refreshing live data.

### EKS Cluster Soft-Delete, State Reconciliation & Kubernetes Inspection
- `delete_cluster` records `deleteInitiatedBy="tesserak"` and soft-deletion timestamps; `_list_clusters_sync` retains deleted clusters for `DELETED_CLUSTER_RETENTION_DAYS = 7` (UTC-safe calculation) before removing stale audit entries.
- `_list_clusters_sync` and `sync_cluster_state` (`POST /clusters/{cluster_name}/sync`) reconcile live AWS `nodeGroups`, `status`, `version`, and `endpoint` with local PostgreSQL state via `StateData.record_state_change` and return exact `stateDifferences`.
- `install_community_addon` / `_install_community_addon_sync` and `POST /clusters/{cluster_name}/community-addons` install selected community Kubernetes add-ons via isolated Helm CLI execution, and `_get_cluster_details_sync` merges live `helm list -A -o json` releases into `communityAddons`.
- `_get_cluster_details_sync` merges EC2 instance metadata with live cluster state via `kubectl get nodes,pods -A -o json`, exposing per-node and pod status/IP/creation timestamps to `ClusterDetails`.

### Cloud Resources & CI/CD Pipelines
- `resources_service.py`: Uses paginated S3/SQS listing ordered newest-first so newly created buckets/queues appear immediately in `/resources`.
- `pipelines_service.py`: Runs Stage 5 pod verification using `kubectl rollout status` so completed pipelines report running container state cleanly; `DELETE /api/pipelines/{id}` defaults `cleanup_cluster=true` to clean up cluster workloads created by the pipeline.

---

## 4. Frontend Architecture & Key Components

### Routing & Layout Shell (`frontend/src/App.tsx`)
- Uses `BrowserRouter` (`ROUTE_TITLES` sets per-route `document.title`) inside `TesserakAuthProvider`.
- Primary palette (`obsidianBlueTheme`): Obsidian Black (`#09090b`), Crisp White / Slate (`#ffffff` / `#f8fafc`), Electric Blue (`#2563eb`).
- Sidebar drawer (`drawerWidth = 248`) links to:
  - `/` (`Dashboard`)
  - `/clusters` (`Clusters`) & `/clusters/:clusterName` (`ClusterDetails`) & `/create-cluster` (`CreateCluster`)
  - `/resources` (`CloudResources`, alias `/infrastructure`)
  - `/pipelines` (`Pipelines`)
  - `/guardrails` (`Guardrails`, alias `/security`)
  - `/integrations` (`Integrations`, alias `/connectors`)
  - `/settings` (`Settings`) & `/profile` (`Profile`)

### Launch Wizard & Ergonomics (`frontend/src/components/CreateCluster/`)
- `ClusterBasicDetails.tsx`: AWS account, region, K8s version (`1.28`-`1.35` dynamic discovery), `bootstrapClusterCreatorAdminPermissions`, `authenticationMode`.
- `ClusterEnvironment.tsx`: Expanded setup modal (`Dialog` `maxWidth="lg"`, `92vw`, max `1080px`), VPC & subnet selectors (`filterSelectedOptions` hides already-picked subnets), IPv4/IPv6 + Service IPv4 CIDR, Prod-gated `deletionProtection`, and Initial Managed Node Group controls.
- `InstanceTypeSelect.tsx`: MUI `Autocomplete` with `freeSolo`; separates local `inputText` state (`isEditingRef`) from `selectedOption` so typing/clearing completely works without snap-back, ranks prefix matches ahead of substring matches, and shows vCPU / Memory GiB / architecture / GPU chips. Falls back to static common types if AWS/cache is offline.
- `NumericCountField.tsx`: Decoupled string buffer during focus so users can clear or type multi-digit node counts freely before clamping on blur/commit.
- `ClusterAddons.tsx` & `ClusterPreview.tsx`: Dynamic add-on version matrix and launch preview.

### Shared Safety & Utilities
- `ConfirmDeleteDialog.tsx`: Shared destructive confirmation dialog used across deletions (clusters, node groups, pods, pipelines, resources, integrations, connectors).
- `Clusters/NodeDetailsDialog.tsx`: Node detail inspector with paginated pod list (`10` pods per page) and clickable pod rows.
- `Clusters/NodeGroupDetailsDialog.tsx`: AWS EKS node group inspector modal (configuration summary banner + 8 tabs covering Details, Nodes, Health issues, Labels, Update config, Taints, Update history, and Tags) plus Public/Private subnet labeling.
- `Clusters/PodDetailsDialog.tsx`: Kubernetes pod inspector (Structured/Raw view, expandable Containers/Init Containers, Conditions, Volumes, Labels, and confirmation-guarded Restart/Delete Pod actions via `POST/DELETE /clusters/{cluster_name}/pods/{namespace}/{pod_name}`).
- `auth/AuthContext.tsx`: Preserves Auth0/Google SSO `picture` URLs across PostgreSQL profile hydration (`tesserak-profile-updated` event sync + DB backfill).
- `utils/`: `swrCache.ts` (stale-while-revalidate client caching), `dateUtils.ts`, `imageUtils.ts`, `regionMapping.ts`.
- `types/`: `cluster.ts`, `platform.ts`, `user.ts`.

---

## 5. File Inventory

### Backend (`backend/`)
`__init__.py`, `auth.py`, `connections.py`, `db.py`, `integrations_service.py`, `main.py`, `migrate_json_to_pg.py`, `pipelines_service.py`, `requirements.txt`, `resources_service.py`, `state_management.py`, `state_manager.py`, `tesserak_router.py`, `test_fixes.py`, `.env.example`.

### Frontend Tests (`frontend/src/`)
`App.test.tsx`, `components/Connectors/ConnectorForm.test.tsx`, `components/CreateCluster/CreateClusterWizard.test.tsx`, `pages/ClusterDetails.test.tsx`, `pages/OverviewAndClusters.test.tsx`, `pages/PipelinesAndCloudResources.test.tsx`.
