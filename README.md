# Tesserak | EKS & Cloud Internal Developer Platform

Tesserak is a full-stack Kubernetes and AWS cloud internal developer platform (IDP) for provisioning Amazon EKS clusters, discovering and remediating cloud resources, enforcing policy guardrails, and running GitOps CI/CD pipelines from a unified interface.

---

## Key Capabilities

### 1. Amazon EKS Cluster Lifecycle & State Reconciliation
- **Multi-Step Launch Wizard (`/create-cluster`)**:
  - **Basic Details (`ClusterBasicDetails`)**: Cluster name, AWS account selector, region discovery, Kubernetes version selector, and EKS Cluster Access controls (`bootstrapClusterCreatorAdminPermissions`, `authenticationMode`).
  - **Environment & Networking (`ClusterEnvironment`)**: VPC discovery and inline VPC creation (`POST /api/vpc`), public/private subnet selection (`filterSelectedOptions` prevents duplicate picks), IPv4/IPv6 and custom Service IPv4 CIDR configuration, Production-conditional Deletion Protection (`deletionProtection`), and Initial Managed Node Group setup.
  - **EC2 Instance Type Selector (`InstanceTypeSelect`) & Node Sizing (`NumericCountField`)**: Searchable AMI-compatible EC2 instance selector displaying vCPU count, memory (GiB), architecture, and GPU badges; full input clearing and prefix-prioritized filtering; free-typing numeric count fields for min/desired/max node counts.
  - **Add-ons & Preview (`ClusterAddons`, `ClusterPreview`)**: Add-on version discovery per Kubernetes version and stacked configuration summary before launch.
- **Background Reconciliation & Audit Retention (`/clusters`)**:
  - Polls live AWS EKS cluster state every 60 seconds, detects state drift (`Synced`, `Needs Sync`, `Missing / Deleted`), and triggers one-click state synchronization (`POST /clusters/{cluster_name}/sync`).
  - Retains deleted clusters for **7 days** (`DELETED_CLUSTER_RETENTION_DAYS = 7`) for audit history before pruning.
- **Cluster Deep Inspection (`/clusters/:clusterName`, `NodeDetailsDialog`)**:
  - Inspects VPC/networking, access mode, nodegroups (create, scale, delete), merged EC2 + Kubernetes nodes, and running pods via `kubectl get nodes,pods -A -o json`, with a paginated node-level pod inspector (`NodeDetailsDialog`).

### 2. Multi-Account Connector Scoping & Hybrid AWS Catalog Caching
- **Strict Account Scoping (`backend/connections.py`)**: Account-scoped AWS endpoints (`/api/aws/regions/{account_id}`, `/vpcs`, `/zones`, `/subnets`, `POST /api/vpc`, and `/clusters*`) resolve the authenticated user's specific AWS connector matching `account_id`.
- **Hybrid Memory + PostgreSQL Catalog Cache (`backend/db.py` `aws_catalog_cache`)**:
  - EC2 instance types per region are cached in memory and persisted in PostgreSQL (`AwsCatalogCacheRecord`) so subsequent opens load immediately without re-querying AWS.
  - Optional platform read-only catalog credentials (`TESSERAK_CATALOG_AWS_ACCESS_KEY_ID`, `TESSERAK_CATALOG_AWS_SECRET_ACCESS_KEY`, `TESSERAK_CATALOG_AWS_REGION`) can power catalog APIs (`/api/aws/eks-versions`, `/addon-versions`, `/eks-ami`, `/eks-instance-types`) alongside user connectors.

### 3. Cloud Resources Discovery & Drift Remediation (`/resources`)
- Discovers live AWS S3 buckets (paginated), SQS queues, ElastiCache Redis, and RDS instances.
- Supports blueprint provisioning, encryption/public-access drift checks, and remediation actions.

### 4. GitOps CI/CD Pipelines (`/pipelines`)
- Executes real `git ls-remote` verification, `git clone`, optional Docker build, Guardrail manifest scan, `kubectl apply`, and `kubectl rollout status` pod readiness checks.
- Provides collapsible stdout/stderr trace logs and cleans up deployed Kubernetes resources when deleting a pipeline (`?cleanup_cluster=true` default).

### 5. Guardrails, Integrations & Safety Confirmations
- **Guardrails (`/guardrails`)**: Policy rule management and resource approval workflows (`tesserak_router.py`).
- **Integrations (`/integrations`)**: AWS IAM connectors and third-party tool connections stored in PostgreSQL (`AwsConnectionRecord`, `IntegrationRecord`) with Fernet-based secret encryption.
- **Safe Destructive Actions (`ConfirmDeleteDialog`)**: Consistent confirmation dialog across cluster, nodegroup, pipeline, resource, connector, and integration deletions.
- **Authentication & Clean URLs**: Auth0 SSO integration (`@auth0/auth0-react` / `auth0-fastapi-api`) plus individual/organization email workspace sign-in, routed cleanly with React Router `BrowserRouter`.

---

## Architecture & Repository Layout

```text
tesserak/
├── README.md
├── PROJECT_CONTEXT.md
├── GEMINI.md
├── CHANGELOG.md
├── backend/
│   ├── main.py                  # FastAPI entry point, EKS/VPC/Catalog APIs
│   ├── tesserak_router.py       # Overview, Resources, Guardrails, Approvals, Pipelines APIs
│   ├── db.py                    # SQLAlchemy models & PostgreSQL DatabaseManager
│   ├── connections.py           # AWS IAM connector storage, STS validation, catalog lookup
│   ├── auth.py                  # Auth0 / user session identity resolution
│   ├── state_manager.py         # Local DB cluster state persistence
│   ├── state_management.py      # Live AWS EKS state inspection
│   ├── resources_service.py     # AWS S3/SQS/RDS/Redis discovery & drift checks
│   ├── pipelines_service.py     # Subprocess Git/Docker/kubectl CI/CD runner & cleanup
│   ├── integrations_service.py  # Platform integrations service
│   ├── migrate_json_to_pg.py    # Legacy JSON-to-PostgreSQL migration utility
│   ├── test_fixes.py            # Backend unit & regression tests
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── public/
    └── src/
        ├── App.tsx              # obsidianBlueTheme, Layout shell, BrowserRouter routes
        ├── auth/AuthContext.tsx # Auth0 + local session provider
        ├── pages/               # Dashboard, Clusters, ClusterDetails, CreateCluster,
        │                        # CloudResources, Pipelines, Guardrails, Integrations,
        │                        # Settings, Profile (+ legacy route alias pages)
        ├── components/          # Reusable UI primitives & feature modules
        │   ├── Auth/            # AuthPage
        │   ├── Clusters/        # NodeDetailsDialog
        │   ├── Connectors/      # ConnectorForm, ConnectorList
        │   └── CreateCluster/   # ClusterBasicDetails, ClusterEnvironment, ClusterAddons,
        │                        # ClusterPreview, InstanceTypeSelect, NumericCountField
        ├── types/               # cluster.ts, platform.ts, user.ts
        └── utils/               # dateUtils.ts, imageUtils.ts, regionMapping.ts, swrCache.ts
```

---

## Prerequisites

- **Python**: 3.9+
- **Node.js & npm**: Node 18+ recommended
- **PostgreSQL**: Local or remote instance (default: `postgresql://tesserak:tesserak123@localhost:5432/tesserak`)
- **CLI Tools (for CI/CD pipelines & pod inspection)**: `git`, `docker`, `aws`, `kubectl`

---

## Getting Started

### 1. Environment Configuration

Copy the environment templates and fill in any optional Auth0 or catalog credentials:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Key backend variables (`backend/.env`):
- `DATABASE_URL`: PostgreSQL connection string (defaults to `postgresql://tesserak:tesserak123@localhost:5432/tesserak`).
- `TESSERAK_ENCRYPTION_KEY`: Optional custom Fernet key for encrypting stored AWS/integration secrets.
- `TESSERAK_CATALOG_AWS_ACCESS_KEY_ID`, `TESSERAK_CATALOG_AWS_SECRET_ACCESS_KEY`, `TESSERAK_CATALOG_AWS_REGION`: Optional read-only IAM credentials used for global AWS catalog endpoints (`eks-versions`, `addon-versions`, `eks-ami`, `eks-instance-types`).
- `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`: Optional Auth0 API verification settings.

### 2. Start the Backend (`http://localhost:8000`)

```bash
cd backend
pip install -r requirements.txt
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Interactive OpenAPI documentation is available at `http://localhost:8000/docs`.

### 3. Start the Frontend (`http://localhost:3000`)

Use `--legacy-peer-deps` because `@mui/lab` peer ranges predate React 19:

```bash
cd frontend
npm install --legacy-peer-deps
BROWSER=none npm start
```

Open `http://localhost:3000` in your browser.

---

## Verification & Testing

### Backend Unit & Regression Tests

```bash
python3 -m unittest backend.test_fixes -v
```

### Frontend TypeScript Check & Jest Suite

```bash
cd frontend
npx tsc --noEmit
CI=true npm test -- --watchAll=false
```

---

## API Overview

| Method & Path | Purpose |
| :--- | :--- |
| `GET /` / `GET /api/auth/status` | Service health & Auth0 status |
| `GET /api/overview` | Platform overview counters and recent activity |
| `GET /api/aws/eks-versions` | Supported EKS Kubernetes versions (hybrid cached) |
| `GET /api/aws/addon-versions/{eks_version}` | Default add-on versions for a Kubernetes release |
| `GET /api/aws/eks-ami/{account_id}/{region}` | Recommended EKS AMI ID via SSM Parameter Store |
| `GET /api/aws/eks-instance-types/{account_id}/{region}` | Cached/live EC2 instance catalog compatible with AMI type |
| `GET /api/aws/regions/{account_id}` | Regions for the selected AWS connector |
| `GET /api/aws/vpcs/{account_id}/{region}` | VPCs in account/region |
| `GET /api/aws/zones/{account_id}/{region}` | Availability Zones in account/region |
| `GET /api/aws/subnets/{account_id}/{region}/{vpc_id}` | Subnets for a VPC |
| `POST /api/vpc` | Create VPC + subnets + Internet Gateway |
| `POST /api/connections` / `GET /api/connections` / `POST /api/connections/test` / `DELETE /api/connections/{connection_id}` | Manage and test AWS IAM connectors |
| `GET /clusters` / `POST /clusters` / `GET /clusters/{cluster_name}` / `POST /clusters/{cluster_name}/sync` / `DELETE /clusters/{cluster_name}` | EKS cluster CRUD, reconciliation, and 7-day soft-delete audit list |
| `POST /clusters/{cluster_name}/nodegroups` / `PATCH /clusters/{cluster_name}/nodegroups` / `DELETE /clusters/{cluster_name}/nodegroups` | Managed node group creation, scaling, and deletion |
| `GET /api/resources` / `POST /api/resources` / `DELETE /api/resources/{id}` / `POST /api/resources/{id}/drift-check` | Live AWS resource discovery, provisioning, and drift remediation |
| `GET /api/guardrails*` / `POST /api/approvals/{id}/decision` | Policy guardrails & approval queue |
| `GET /api/pipelines` / `POST /api/pipelines` / `POST /api/pipelines/{id}/trigger` / `DELETE /api/pipelines/{id}` | GitOps pipeline CRUD, execution, and cluster cleanup |
| `GET /api/integrations` / `POST /api/integrations` / `POST /api/integrations/{id}/test` / `DELETE /api/integrations/{id}` | Third-party integrations |
