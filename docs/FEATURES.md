# Feature Catalog

Living inventory of implemented features and capabilities in **Tesserak** (`/Users/ankit/TW/tesserak`).

## Feature Index

| Feature | Status | Key Entrypoints / Files | Last Updated |
| :--- | :--- | :--- | :--- |
| Platform Overview Dashboard | Active | `frontend/src/pages/Dashboard.tsx`, `backend/tesserak_router.py` (`GET /api/overview`) | 2026-11-26 |
| Authentication, SSO & Profile Management | Active | `backend/auth.py`, `backend/db.py` (`UserRecord`, `EmailVerificationRecord`), `backend/tesserak_router.py`, `frontend/src/auth/AuthContext.tsx`, `frontend/src/components/Auth/AuthPage.tsx`, `frontend/src/pages/Profile.tsx`, `frontend/src/pages/Settings.tsx` | 2026-11-28 |
| Multi-Account AWS Connectors & Catalog Fallback | Active | `backend/connections.py`, `backend/main.py` | 2026-11-27 |
| Amazon EKS Launch Wizard & Hybrid Catalog Cache | Active | `frontend/src/pages/CreateCluster.tsx`, `frontend/src/components/CreateCluster/*`, `backend/main.py`, `backend/db.py` (`AwsCatalogCacheRecord`) | 2026-11-27 |
| EKS Cluster Inventory, Reconciliation & Deep Inspector | Active | `frontend/src/pages/Clusters.tsx`, `frontend/src/pages/ClusterDetails.tsx`, `frontend/src/components/Clusters/{NodeDetailsDialog,NodeGroupDetailsDialog,PodDetailsDialog,AddOnDetailsDialog}.tsx`, `backend/main.py` | 2026-11-28 |
| Live AWS Cloud Resources & Drift Remediation | Active | `frontend/src/pages/CloudResources.tsx`, `backend/resources_service.py`, `backend/tesserak_router.py` | 2026-11-26 |
| GitOps CI/CD Pipelines Runner | Active | `frontend/src/pages/Pipelines.tsx`, `backend/pipelines_service.py`, `backend/tesserak_router.py` | 2026-11-26 |
| Policy Guardrails & Approval Workflows | Active | `frontend/src/pages/Guardrails.tsx`, `backend/resources_service.py`, `backend/tesserak_router.py` | 2026-11-26 |
| Third-Party Integrations Hub | Active | `frontend/src/pages/Integrations.tsx`, `backend/integrations_service.py`, `backend/tesserak_router.py` | 2026-11-26 |
| PostgreSQL Persistence & Encrypted Secrets | Active | `backend/db.py`, `backend/migrate_json_to_pg.py` | 2026-11-26 |
| Clean URL Routing & Global Safety Confirmations | Active | `frontend/src/App.tsx`, `frontend/src/components/ConfirmDeleteDialog.tsx` | 2026-11-26 |

---

## Platform Overview Dashboard

- **Status**: Active
- **Purpose**: Aggregates real-time AWS connector health, discovered cloud resources, policy compliance score, guardrail approval alerts, and recent CI/CD deployments in a single control-plane overview.
- **Entrypoints & Implementation**:
  - `backend/tesserak_router.py`: `get_platform_overview` (`GET /api/overview`) builds integration, resource drift, compliance score, alert, and deployment summaries.
  - `frontend/src/pages/Dashboard.tsx`: Renders KPI cards, compliance telemetry, alert banners, and recent deployment cards at route `/`.
- **Configuration & Usage**:
  - Supports `?refresh=true` on `GET /api/overview` and `x-user-email` header scoping.
- **Recent Updates**:
  - **2026-11-26**: Validated route `/` rendering and metrics in `frontend/src/pages/OverviewAndClusters.test.tsx`.

---

## Authentication, SSO & Profile Management

- **Status**: Active
- **Purpose**: Supports Auth0 Universal Login SSO, 6-digit OTP-verified Individual and Organization email/password registration and login, local workspace fallback in dev mode, and operator profile customization.
- **Entrypoints & Implementation**:
  - `backend/auth.py`: `require_auth_if_configured`, `register_email_user`, `verify_email_registration_otp`, `resend_email_registration_otp`, `authenticate_email_user`, `issue_email_session_token`, `verify_email_session_token`, `get_user_profile`, `upsert_user_profile`.
  - `backend/db.py`: `UserRecord` (`users`), `EmailVerificationRecord` (`email_verifications`).
  - `backend/tesserak_router.py`: `GET /api/auth/status`, `POST /api/auth/email/register`, `POST /api/auth/email/verify-otp`, `POST /api/auth/email/resend-otp`, `POST /api/auth/email/login`, `GET /api/profile`, `PUT /api/profile`.
  - `frontend/src/auth/AuthContext.tsx` (`TesserakAuthProvider`, `useTesserakAuth`), `frontend/src/components/Auth/AuthPage.tsx`, `frontend/src/App.tsx` (post-auth welcome `Snackbar`), `frontend/src/pages/Profile.tsx` (`/profile`), `frontend/src/pages/Settings.tsx` (`/settings`).
  - `frontend/src/utils/imageUtils.ts`: Client-side avatar compression (`compressImage`).
- **Configuration & Usage**:
  - Backend env vars (`backend/.env`): `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `TESSERAK_SESSION_SECRET`, optional `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_USE_TLS` (when `SMTP_HOST` is unset, registration exposes a `dev-preview` 6-digit OTP code in UI).
  - Frontend env vars (`frontend/.env`): `REACT_APP_AUTH0_DOMAIN`, `REACT_APP_AUTH0_CLIENT_ID`, `REACT_APP_AUTH0_AUDIENCE`.
- **Recent Updates**:
  - **2026-11-28**: Added 6-digit OTP email verification (`POST /api/auth/email/verify-otp`, `/api/auth/email/resend-otp`), SMTP/dev-preview delivery, post-signup/sign-in success notifications in `App.tsx`, form reset on `Sign In` / `Create Account` tab switches, and fixed duplicate `loginWithLocal` clearing `localToken` in `Auth0SdkBridge`.
  - **2026-11-27**: Fixed Google/Auth0 SSO `avatarUrl` preservation and reactivity in `AuthContext.tsx`, `App.tsx`, and `Profile.tsx` when PostgreSQL profiles have an empty `avatarUrl`, with `referrerPolicy="no-referrer"` support.
  - **2026-11-26**: Switched shell routing in `frontend/src/App.tsx` to `BrowserRouter` and added `/profile` + `/settings` auth status panels showing live PostgreSQL and Auth0 state.

---

## Multi-Account AWS Connectors & Catalog Fallback

- **Status**: Active
- **Purpose**: Stores STS-validated AWS IAM credentials per operator in PostgreSQL, strictly resolves account-scoped API calls to the matching `account_id`, and supports optional platform read-only IAM credentials for global catalog lookups.
- **Entrypoints & Implementation**:
  - `backend/connections.py`: `ConnectionManager` (`get_connection_for_account`, `get_platform_catalog_connection`, `get_catalog_connection`, `get_aws_client`, 60-second STS verification cache).
  - `backend/main.py`: `_resolve_account_connection` enforces strict `account_id` matching across AWS networking/EKS endpoints (`POST /api/connections/test`, `POST/GET /api/connections`, `DELETE /api/connections/{connection_id}`, `GET /api/connections/status`, `GET /api/aws/regions/{account_id}`, `GET /api/aws/vpcs/{account_id}/{region}`, `GET /api/aws/zones/{account_id}/{region}`, `GET /api/aws/subnets/{account_id}/{region}/{vpc_id}`, `POST /api/vpc`, `/clusters*`).
  - `frontend/src/components/Connectors/ConnectorForm.tsx` & `ConnectorList.tsx`: Duplicate-submit-locked IAM connection test/save workflow and connected account cards.
- **Configuration & Usage**:
  - Optional catalog fallback env vars (`backend/.env` / `backend/.env.example`): `TESSERAK_CATALOG_AWS_ACCESS_KEY_ID`, `TESSERAK_CATALOG_AWS_SECRET_ACCESS_KEY`, `TESSERAK_CATALOG_AWS_REGION`.
- **Recent Updates**:
  - **2026-11-27**: Added `get_connection_for_account`, `_resolve_account_connection`, and `TESSERAK_CATALOG_AWS_*` fallback tested in `backend/test_fixes.py` (`test_account_scoped_connector_lookup_and_platform_catalog_fallback`).

---

## Amazon EKS Launch Wizard & Hybrid Catalog Cache

- **Status**: Active
- **Purpose**: Guided 4-step EKS cluster creation wizard covering access control, VPC/subnet networking, production deletion protection, IPv4/IPv6 CIDR configuration, managed node groups, and add-on compatibility using hybrid memory + PostgreSQL caching.
- **Entrypoints & Implementation**:
  - `frontend/src/pages/CreateCluster.tsx` (`/create-cluster`) orchestrates `ClusterBasicDetails.tsx`, `ClusterEnvironment.tsx`, `ClusterAddons.tsx`, and `ClusterPreview.tsx`.
  - `frontend/src/components/CreateCluster/InstanceTypeSelect.tsx`: Searchable AMI-compatible EC2 selector displaying vCPU, memory (GiB), architecture, and GPU badges; separates `inputText` state (`isEditingRef`) from `selectedOption` for complete clearing (`""`) and prefix-first ranking.
  - `frontend/src/components/CreateCluster/NumericCountField.tsx`: Free-typing integer input for min/desired/max node sizing with blur clamping.
  - `backend/main.py` & `backend/db.py`: `AwsCatalogCacheRecord` (`aws_catalog_cache`), `_get_cached_ec2_catalog_only`, `_warm_ec2_instance_catalog`, `GET /api/aws/eks-versions`, `GET /api/aws/addon-versions/{eks_version}`, `GET /api/aws/eks-ami/{account_id}/{region}`, `GET /api/aws/eks-instance-types/{account_id}/{region}`, `POST /clusters`.
- **Configuration & Usage**:
  - Optional backend env defaults: `EKS_CLUSTER_ROLE_ARN`, `EKS_NODE_ROLE_ARN`, `SUBNET_IDS`.
  - Supports `bootstrapClusterCreatorAdminPermissions`, `authenticationMode` (`API_AND_CONFIG_MAP` / `API` / `CONFIG_MAP`), `deletionProtection` (prod environment), `ipFamily` (`ipv4`/`ipv6`), and `serviceIpv4Cidr`.
- **Recent Updates**:
  - **2026-11-27**: Fixed `InstanceTypeSelect` clearing and complete prefix/substring search, added cache-only catalog serving (`refresh=false`) without AWS auth, and verified in `CreateClusterWizard.test.tsx`.
  - **2026-11-26**: Enlarged `ClusterEnvironment` modal (`maxWidth="lg"`), added `NumericCountField`, hid already-selected subnets (`filterSelectedOptions`), and persisted EC2 catalogs in `aws_catalog_cache`.

---

## EKS Cluster Inventory, Reconciliation & Deep Inspector

- **Status**: Active
- **Purpose**: Tracks managed EKS clusters across AWS accounts with 60-second background reconciliation, sync-drift detection, 7-day soft-delete audit retention, managed node group CRUD/scaling, and live Kubernetes node + paginated pod inspection.
- **Entrypoints & Implementation**:
  - `frontend/src/pages/Clusters.tsx` (`/clusters`), `ClusterListManager.tsx`, `ClusterTable.tsx`, `ClusterHealth.tsx` (Recharts status donut).
  - `frontend/src/pages/ClusterDetails.tsx` (`/clusters/:clusterName`): Tabs `Overview & Config`, `Compute & Add-ons`, `Networking`, `Observability & Access`, `Update & State History`, and `Tags`.
  - `frontend/src/components/Clusters/NodeDetailsDialog.tsx`: Clickable node inspection modal showing EC2/K8s metadata and paginated pods (`10` pods/page), with clickable pod rows linking into `PodDetailsDialog`.
  - `frontend/src/components/Clusters/NodeGroupDetailsDialog.tsx`: Clickable AWS EKS node group inspector modal with configuration summary banner and tabs for `Details` (ARN, ASG, Role IAM ARN, Public/Private subnets, SSH, auto-repair), `Nodes`, `Health issues`, `Kubernetes labels`, `Update config`, `Kubernetes taints`, `Update history`, and `Tags`.
  - `frontend/src/components/Clusters/PodDetailsDialog.tsx`: Clickable Kubernetes pod inspector with Structured view / Raw JSON toggle, expandable Container & Init Container accordions, Conditions, auto-refreshing (`5s`) live Kubernetes Events (`GET /clusters/{cluster_name}/pods/{namespace}/{pod_name}/events`), Volumes, Labels, and confirmation-guarded Restart Pod & Delete Pod actions.
  - `frontend/src/components/Clusters/AddOnDetailsDialog.tsx`: Clickable AWS EKS & Community/Helm add-on details modal showing AWS add-on config/ARN/health/pods and live Helm status, `NOTES.txt`, install stdout/stderr logs, namespace pods & Kubernetes events, Services/Ingresses, Domain & Access guides, custom `values.yaml` editor with presets, and confirmation-guarded Helm uninstall.
  - `backend/main.py`: `_list_clusters_sync` (`DELETED_CLUSTER_RETENTION_DAYS = 7`, live `nodeGroups` comparison, `stateDifferences`), `sync_cluster_state` (`POST /clusters/{cluster_name}/sync`), `install_community_addon` / `_install_community_addon_sync` (per-release locked Helm installer with `_clear_stuck_helm_release` recovery & custom `--values`), `POST/GET/DELETE /clusters/{cluster_name}/community-addons*`, `_fetch_pod_events_sync` (`GET /clusters/{cluster_name}/pods/{namespace}/{pod_name}/events`), `_get_cluster_details_sync` (AWS + Helm add-ons, EC2/K8s nodes, pods), `_fetch_k8s_runtime_sync`, `_extract_pod_summary`, `_merge_nodes_and_compute_allocations`, `_kubectl_pod_action_sync`, `GET/POST/DELETE /clusters*`, nodegroups & pod actions.
  - `backend/state_manager.py` & `backend/state_management.py`: Local cluster snapshot persistence (`nodeGroups` + `communityAddons` synced on `record_state_change`) and live AWS EKS state checks.
- **Configuration & Usage**:
  - Requires AWS credentials scoped to the target cluster account, plus `kubectl` and `helm` installed for live node/pod telemetry, pod actions, and community add-on installation.
- **Recent Updates**:
  - **2026-11-28**: Parallelized and cached `GET /clusters/{cluster_name}/community-addons/{addon_id}/details` (`_get_cluster_endpoint_info`, `ThreadPoolExecutor`), added SWR + progress feedback in `AddOnDetailsDialog.tsx`, stripped `USER-SUPPLIED VALUES:` header from editable `values.yaml`, and scoped Pods/Services/Ingresses/Events strictly to the selected Helm add-on (`_k8s_item_matches_release`, `matchesCommunityAddonPod`).
  - **2026-11-28**: Separated `uninstallingAddonIds` from `installingAddonIds` (`ClusterDetails.tsx`, `AddOnDetailsDialog.tsx`), closed uninstall confirmation immediately to keep the details modal open on `Install Logs & Events`, and persisted Helm uninstall traces in `history` via `_latest_addon_history_entry` / `_uninstall_community_addon_sync` (`backend/main.py`).
  - **2026-11-27**: Fixed `cluster-proportional-autoscaler` default `options.target=deployment/coredns`, added per-release Helm locking & `pending-install`/`pending-upgrade` recovery, per-add-on loading map (`installingAddonIds`), clickable `AddOnDetailsDialog.tsx` (`values.yaml`, logs, events, domain hints, uninstall), and live `5s`-polled Pod Events in `PodDetailsDialog.tsx`.
  - **2026-11-27**: Fixed false `Needs Sync` (`node_group_count_mismatch`) drift comparison & `EKS State Health` donut classification (`Clusters.tsx`, `ClusterTable.tsx`), and replaced community add-on stub with real Helm installation + `ClusterDetails` Community/Helm Add-ons UI (`backend/main.py`, `ClusterDetails.tsx`).
  - **2026-11-27**: Added `Public`/`Private` Worker Subnet badges in Add Node Group, clickable `NodeGroupDetailsDialog`, clickable `PodDetailsDialog`, and confirmation-guarded Pod Restart/Delete endpoints (`ClusterDetails.test.tsx`, `backend/test_fixes.py`).
  - **2026-11-26**: Enforced 7-day UTC-safe deleted-cluster retention (`test_deleted_cluster_retained_under_7_days_and_removed_after_7_days`) and added paginated `NodeDetailsDialog` (`ClusterDetails.test.tsx`).

---

## Live AWS Cloud Resources & Drift Remediation

- **Status**: Active
- **Purpose**: Discovers live AWS S3 buckets, SQS queues, ElastiCache Redis clusters, and RDS instances, provisions resources via blueprints, checks encryption/public-access drift, and triggers one-click remediation.
- **Entrypoints & Implementation**:
  - `frontend/src/pages/CloudResources.tsx` (`/resources`, alias `/infrastructure` -> `Infrastructure.tsx`).
  - `backend/resources_service.py`: `discover_live_aws_resources` (paginated S3/SQS newest-first discovery), `execute_aws_provision`, `execute_aws_reconcile`, `execute_aws_delete`.
  - `backend/tesserak_router.py`: `GET /api/resources`, `POST /api/resources`, `POST /api/resources/{resource_id}/drift-check`, `DELETE /api/resources/{resource_id}`.
- **Configuration & Usage**:
  - `POST /api/resources` evaluates active guardrail rules (encryption, public access, sovereignty regions, FinOps monthly cost ceiling) before calling AWS APIs.
- **Recent Updates**:
  - **2026-11-26**: Switched S3 listing to paginated full discovery sorted newest-first (`test_scan_s3_handles_more_than_15_paginated_buckets_and_sorts_newest` and `PipelinesAndCloudResources.test.tsx`).

---

## GitOps CI/CD Pipelines Runner

- **Status**: Active
- **Purpose**: Verifies Git remotes (`git ls-remote`), clones repositories, runs optional Docker builds, scans Kubernetes manifests against active guardrails, deploys via `kubectl apply`, verifies pod rollout readiness, and cleans up cluster workloads when deleted.
- **Entrypoints & Implementation**:
  - `frontend/src/pages/Pipelines.tsx` (`/pipelines`): Live execution progress, sticky Hide/Show Logs toggle across polling cycles, run history pills, and deletion dialog with optional cluster cleanup toggle.
  - `backend/pipelines_service.py`: `verify_git_remote`, `list_deployable_clusters`, `_scan_k8s_manifests`, `build_eks_kubeconfig_yaml`, `_verify_cluster_rollout` (`kubectl rollout status` Stage 5 wait), `cleanup_pipeline_deployments_sync`, `run_pipeline_async`.
  - `backend/tesserak_router.py`: `GET /api/cluster-targets`, `GET /api/pipelines`, `POST /api/pipelines`, `POST /api/pipelines/{pipeline_id}/trigger`, `DELETE /api/pipelines/{pipeline_id}` (`cleanup_cluster: bool = True`).
- **Configuration & Usage**:
  - Requires `git`, `docker`, `aws`, and `kubectl` on `PATH` for live execution.
- **Recent Updates**:
  - **2026-11-26**: Added Stage 5 `kubectl rollout status` wait + warning event capture, sticky log toggle fix, and automatic Kubernetes workload cleanup on pipeline delete (`backend/test_fixes.py`, `PipelinesAndCloudResources.test.tsx`).

---

## Policy Guardrails & Approval Workflows

- **Status**: Active
- **Purpose**: Enforces organizational security, region sovereignty, deletion locks, and FinOps cost ceilings on resource requests and EKS clusters, routing over-threshold provisions to an approval queue.
- **Entrypoints & Implementation**:
  - `frontend/src/pages/Guardrails.tsx` (`/guardrails`, alias `/security` -> `Security.tsx`): Tabs `Policy Rules`, `Live AWS Audit Findings`, and `Approval Queue`.
  - `backend/resources_service.py`: `run_live_guardrail_audit`, `_scan_eks_guardrails_sync`.
  - `backend/tesserak_router.py`: `GET /api/guardrails`, `POST /api/guardrails/rules`, `PATCH /api/guardrails/rules/{rule_id}`, `POST /api/approvals/{approval_id}/decision`.
- **Configuration & Usage**:
  - Built-in rule enforcement in `POST /api/resources` and `DELETE /api/resources/{resource_id}` (`gr-encryption`, `gr-public-access`, `gr-region-allowlist`, `gr-cost-ceiling`, `gr-prod-delete-lock`).
- **Recent Updates**:
  - **2026-11-25**: Migrated guardrail rules, audit state, and approval records to PostgreSQL (`GuardrailRuleRecord`, `ApprovalRecord`, `PendingResourceRecord`).

---

## Third-Party Integrations Hub

- **Status**: Active
- **Purpose**: Connects and health-checks external cloud, SCM (GitHub/GitLab/Bitbucket), container registries, secrets managers, DNS providers, and raw AWS IAM accounts.
- **Entrypoints & Implementation**:
  - `frontend/src/pages/Integrations.tsx` (`/integrations`, alias `/connectors` -> `Connectors.tsx`): Category tabs (`All`, `Cloud Providers`, `Source Control (SCM)`, `Registries`, `Secrets & KMS`, `DNS & Edge`, `AWS IAM Raw`).
  - `backend/integrations_service.py`: `verify_integration_credentials`, `http_json_request`, `mask_secret`.
  - `backend/tesserak_router.py`: `GET/POST /api/integrations`, `POST /api/integrations/{integration_id}/test`, `DELETE /api/integrations/{integration_id}`.
- **Configuration & Usage**:
  - Credentials are encrypted at rest via `DatabaseManager.encrypt_json` before storage in `IntegrationRecord`.
- **Recent Updates**:
  - **2026-11-26**: Added confirmation dialogs (`ConfirmDeleteDialog`) before deleting integrations or AWS IAM connectors.

---

## PostgreSQL Persistence & Encrypted Secrets

- **Status**: Active
- **Purpose**: Stores users, encrypted AWS/tool credentials, cluster states, guardrails, approvals, pipelines, and AWS catalog caches in PostgreSQL with Fernet encryption.
- **Entrypoints & Implementation**:
  - `backend/db.py`: `DatabaseManager` and ORM models (`SettingRecord`, `AwsCatalogCacheRecord`, `UserRecord`, `AwsConnectionRecord`, `ClusterStateRecord`, `IntegrationRecord`, `GuardrailRuleRecord`, `ApprovalRecord`, `PendingResourceRecord`, `PipelineRecord`).
  - `backend/migrate_json_to_pg.py`: One-time migration script for legacy local JSON files.
- **Configuration & Usage**:
  - Configured via `DATABASE_URL` (default `postgresql://tesserak:tesserak123@localhost:5432/tesserak`) and optional `TESSERAK_ENCRYPTION_KEY` / `TESSERAK_SESSION_SECRET`.
- **Recent Updates**:
  - **2026-11-26**: Added `AwsCatalogCacheRecord` (`aws_catalog_cache`) for cross-restart EC2 instance catalog persistence.

---

## Clean URL Routing & Global Safety Confirmations

- **Status**: Active
- **Purpose**: Provides hashtag-free `BrowserRouter` navigation with dynamic document titles, unified Obsidian Black / Crisp White / Electric Blue theming, and double-check delete modals across every destructive action.
- **Entrypoints & Implementation**:
  - `frontend/src/App.tsx`: `obsidianBlueTheme`, `ROUTE_TITLES`, `Layout`, `AppShell` using `BrowserRouter` (`Router`).
  - `frontend/src/components/ConfirmDeleteDialog.tsx`: Shared destructive confirmation dialog used on cluster, nodegroup, pipeline, cloud resource, integration, and AWS connector deletions.
  - `frontend/src/utils/swrCache.ts`, `dateUtils.ts`, `regionMapping.ts`: Shared client caching, UTC/local formatting, and AWS region display helpers.
- **Configuration & Usage**:
  - Keep MUI dependencies pinned to v5 (`@mui/material` `^5.16.14`, `@mui/lab` `^5.0.0-alpha.173`, installed with `--legacy-peer-deps`).
- **Recent Updates**:
  - **2026-11-26**: Migrated `App.tsx` and test suites from `HashRouter` to `BrowserRouter` and enforced `<ConfirmDeleteDialog />` across all delete flows.
