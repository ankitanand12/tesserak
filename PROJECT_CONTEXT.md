# Tesserak — Full Project & Session Handoff Context

Use this document to bring any IDE or AI coding assistant completely up to speed on the **Tesserak** codebase (`/Users/ankit/TW/technoworld`), architecture decisions, completed features, environment setup, and next tasks.

---

## 1. Product Identity & Direction

- **Product Name**: **Tesserak** (`Tesserak | EKS & Cloud Control Plane` / `Tesserak | EKS Cluster Manager`)
- **Brand & Visual Identity**:
  - Geometric 3D hypercube mark (`TesserakLogo.tsx`, `Hypercube3D.tsx`, `favicon.svg`, `devops-illustration.svg`).
  - **Color Palette (Strict Black, White & Electric Blue — zero violet/purple)**:
    - **Obsidian Black**: `#09090b` (AppBar, permanent/mobile Sidebar, showcase hero cards, dark execution trace console, modal headers), `#0f172a` (headings/ink).
    - **Crisp White / Light Studio Canvas**: `#ffffff` (card surfaces, dialogs), `#f8fafc` (main workspace canvas).
    - **Electric Blue**: `#2563eb` (primary CTAs, active rings, badges), `#3b82f6` / `#60a5fa` (glows, cube wireframes), `#eff6ff` / `#1d4ed8` (active status pills).
- **Product Scope (Atmosly-Inspired Internal Developer Platform)**:
  Expanded from AWS EKS Cluster management to a full control plane covering:
  1. **EKS Clusters** (`/` / `/clusters` / `/create-cluster`)
  2. **Integrations Hub** (`/integrations`, `/connectors`)
  3. **Cloud Resources** (`/resources`, `/infrastructure`)
  4. **Policy Guardrails & Approvals** (`/guardrails`, `/security`)
  5. **CI/CD Pipelines** (`/pipelines`)
  6. **Auth0 SSO Authentication** (with local workspace fallback when `.env` is unconfigured)

---

## 2. Critical Engineering Principle (No Dummy / Mock Execution)

The user explicitly requires **real backend execution and real credential/remote validation**, matching how the original `+ AWS IAM Connector` works:
- Accounts initialize **empty (`[]`)** — NO pre-seeded fake GitHub/ECR/RDS/Pipeline rows.
- Dummy or invalid API tokens, AWS keys, GCP JSONs, or fake Git repo URLs **must fail cleanly (HTTP `400`/`422`)** with exact upstream errors shown inside the modal/UI.
- Backend endpoints execute **real external HTTP APIs, AWS Boto3 SDK calls, and real CLI subprocesses** (`git`, `docker`, `aws`, `kubectl`, `openssl`).

---

## 3. Repository Structure & Verified Files

```text
technoworld/
├── README.md
├── GEMINI.md                               # Earlier UI design rules (palette predates Obsidian Black/White/Blue refactor)
├── PROJECT_CONTEXT.md                      # This handoff document
├── backend/
│   ├── .env.example                        # Optional AUTH0_DOMAIN / AUTH0_AUDIENCE template
│   ├── requirements.txt                    # fastapi==0.104.1, uvicorn==0.24.0, boto3==1.29.0, python-dotenv==1.0.0, pydantic==2.4.2
│   ├── main.py                             # FastAPI entry point, AWS EKS & Connection routes, mounts atmosly_router
│   ├── connections.py                      # AWS IAM STS connection manager (connections/*.json)
│   ├── state_manager.py                    # Local/AWS EKS cluster state diff engine (cluster_states/)
│   ├── state_management.py                 # AWS EKS state reader
│   ├── auth0_security.py                   # Reusable Auth0FastAPI JWKS/DPoP validator + hybrid request identity dependency
│   ├── atmosly_router.py                   # APIRouter for Overview (alerts + recentDeployments), Auth status/me, Integrations, Resources, Guardrails, Pipelines
│   ├── integrations_service.py             # Live credential verifiers (GitHub, GitLab, AWS ECR, AWS Secrets, DockerHub, Cloudflare, GCP)
│   ├── resources_service.py                # Live AWS discovery, Boto3 provisioning, drift remediation, deletion & compliance audit
│   ├── pipelines_service.py                # Live `git ls-remote`, cluster context discovery & real `git/docker/kubectl` runner
│   └── atmosly_data/                       # Per-user JSON persistence (<sanitized_email>.json)
└── frontend/
    ├── .env.example                        # Optional REACT_APP_AUTH0_DOMAIN / CLIENT_ID / AUDIENCE template
    ├── package.json                        # tesserak-frontend, React 19.2, TS 4.9.5, MUI v5.16.14, @auth0/auth0-react 2.30.0
    ├── public/                             # index.html, manifest.json, favicon.svg, devops-illustration.svg
    └── src/
        ├── App.tsx                         # TesserakAuthProvider, obsidianBlueTheme, Obsidian Sidebar/AppBar Layout, HashRouter routes
        ├── App.test.tsx                    # Jest unit test (mocks react-router-dom v7; checks Tesserak + EKS Cluster Manager on AuthPage)
        ├── setupTests.ts                   # jest-dom + TextEncoder/TextDecoder Node polyfill for @auth0/auth0-spa-js
        ├── index.css                       # Inter font stack, #f8fafc body, keyframes
        ├── auth/
        │   └── AuthContext.tsx             # Bridges @auth0/auth0-react (when env vars set) + Dev SSO/local fallback
        ├── types/
        │   ├── atmosly.ts                  # TypeScript interfaces for Integrations, Guardrails, Resources, Pipelines, Overview
        │   ├── cluster.ts
        │   └── user.ts
        └── components/
            ├── Auth/AuthPage.tsx           # Obsidian 3D hero + Auth0 SSO buttons + Dev Fallback modal + local sign-in/up
            ├── Hypercube3D.tsx             # Interactive 6-face CSS 3D cube (Obsidian/White/Blue)
            ├── Perspective3DCard.tsx       # 3D extruded card (backingPlane depth + axis-aligned foreground so buttons never drift)
            ├── TesserakLogo.tsx            # Inline SVG brand hypercube ('light' | 'gradient')
            ├── ClusterListManager.tsx      # 60s EKS poller (handles HTTP 400 when user has no AWS IAM connector yet)
            ├── ClusterHealth.tsx           # Recharts PieChart status card
            ├── ClusterTable.tsx            # EKS clusters table
            ├── Connectors/                 # ConnectorForm.tsx, ConnectorList.tsx (AWS IAM credentials)
            └── CreateCluster/              # 3D stepper views (ClusterBasicDetails, Environment, Addons, Preview)
        └── pages/
            ├── Dashboard.tsx               # Executive Overview (/): KPIs, Live Alerts & Policy Signals, Recent Pipeline Deployments, EKS Fleet Summary
            ├── Clusters.tsx                # Dedicated AWS EKS Clusters page (/clusters): Fleet KPIs, Health Donut, State Sync & Cluster Table
            ├── CloudResources.tsx          # Live AWS RDS/ElastiCache/S3/SQS inventory, Boto3 provisioner, drift remediation
            ├── Guardrails.tsx              # Policy rule toggles, severity modes, Live AWS Audit tab, Approval Queue
            ├── Pipelines.tsx               # Real Git/K8s pipeline creation (`git ls-remote`), cluster picker, polling terminal logs
            ├── Integrations.tsx            # Provider-specific credential forms (live verified) + AWS IAM Connector integration
            ├── Connectors.tsx              # Delegates to <Integrations />
            ├── Infrastructure.tsx          # Delegates to <CloudResources />
            ├── Security.tsx                # Delegates to <Guardrails />
            ├── CreateCluster.tsx           # 3D EKS provisioning wizard
            ├── Profile.tsx                 # User profile + avatar compression
            └── Settings.tsx                # Auth0 status readout & platform toggles
```

---

## 4. Backend API Reference (`http://localhost:8000`)

### Auth & Overview
- `GET /api/auth/status` — Checks backend `AUTH0_DOMAIN` & `AUTH0_AUDIENCE` env vars (`mode: "auth0" | "local-fallback"`).
- `GET /api/auth/me` — Protected by `Auth0FastAPI.require_auth()` (verifies RS256 JWKS Bearer/DPoP tokens and returns `sub`, `email`, `scope`, `iss`, `aud`).
- `GET /api/atmosly/overview` — Returns real counts, `alerts` (from pending approvals, failed pipelines/integrations, drifted AWS resources, live guardrail audit failures, and connector warnings), and `recentDeployments` (from real pipeline runs).

### Integrations (`integrations_service.py`)
- `GET /api/atmosly/integrations` — Merges user's AWS IAM connectors (`connections/`) + verified platform integrations (secrets stripped).
- `POST /api/atmosly/integrations` — Verifies live credentials before saving:
  - `github` -> `GET https://api.github.com/user` (+ `/repos/<owner>/<repo>` if scoped)
  - `gitlab` -> `GET <endpoint>/api/v4/user`
  - `dockerhub` -> `POST https://hub.docker.com/v2/users/login` + repos check
  - `cloudflare` -> `GET https://api.cloudflare.com/client/v4/user/tokens/verify` + `/zones`
  - `gcp` -> Validates SA JSON, signs RS256 JWT with `/usr/bin/openssl`, exchanges real OAuth2 token at `oauth2.googleapis.com/token`
  - `aws-ecr` / `aws-secrets` -> `boto3` `sts.get_caller_identity()` + `ecr.describe_repositories()` / `secretsmanager.list_secrets()` (using explicit keys or active AWS IAM connector)
- `POST /api/atmosly/integrations/{id}/test` — Re-runs live upstream API/SDK check and updates latency.
- `DELETE /api/atmosly/integrations/{id}` — Disconnects integration.

### Cloud Resources (`resources_service.py`)
- `GET /api/atmosly/resources` — Runs real Boto3 discovery across RDS, ElastiCache, S3 (checks encryption & `PublicAccessBlock`), and SQS for the user's active AWS IAM connection.
- `POST /api/atmosly/resources` — Checks Guardrails (`gr-encryption`, `gr-public-access`, `gr-region-allowlist`, `gr-cost-ceiling`); requires active AWS IAM connector (`400` if missing). High-cost requests hold the spec in `pendingResources` + Approval Queue; within-ceiling requests execute real AWS creation (`s3`, `sqs`, `elasticache`, `rds`).
- `POST /api/atmosly/resources/{id}/drift-check` — Applies real S3 encryption + PublicAccessBlock / SQS SSE remediation in AWS.
- `DELETE /api/atmosly/resources/{id}?environment=...` — Blocks `prod` if `gr-prod-delete-lock` is enabled (`409`); otherwise deletes via Boto3.

### Guardrails (`resources_service.py`)
- `GET /api/atmosly/guardrails` — Returns configurable rules, pending/past approvals, and runs `run_live_guardrail_audit()` across live AWS EKS, RDS, and S3.
- `POST /api/atmosly/guardrails/rules` / `PATCH /api/atmosly/guardrails/rules/{id}` — Create rule or toggle `enabled` / `severity` (`block` | `approval` | `warn`).
- `POST /api/atmosly/approvals/{id}/decision` — `reject` removes pending spec; `approve` executes stored AWS provisioning spec via `execute_aws_provision()`.

### CI/CD Pipelines (`pipelines_service.py`)
- `GET /api/atmosly/cluster-targets` — Discovers live AWS EKS clusters (`eks:<name>`) + local kubeconfig contexts (`ctx:<context>` via `kubectl config get-contexts -o name`).
- `GET /api/atmosly/pipelines`
- `POST /api/atmosly/pipelines` — Validates repository & branch reachability via real `git ls-remote --heads` (`400` on invalid/unreachable repo/branch).
- `POST /api/atmosly/pipelines/{id}/trigger` — Launches background asyncio task executing:
  1. `git clone --depth 1 --branch <branch>` (injecting verified GitHub/GitLab token if linked, sanitized from logs)
  2. Optional `docker build` (if `dockerfilePath` / `imageTag` provided)
  3. YAML manifest Guardrail inspection (`privileged: true`, `:latest`)
  4. `kubectl apply -n <namespace> -f <manifestPath>` (builds scoped temporary kubeconfig + `aws eks get-token` for `eks:` targets, or `--context` for kubeconfig targets)
  5. `kubectl get deployments,pods,svc -n <namespace> -o wide`
- `DELETE /api/atmosly/pipelines/{id}`

---

## 5. Constraints & Quirks to Remember

1. **MUI v5 Pin (`^5.16.14`)**: Do NOT auto-upgrade `@mui/material` to v6 (`<Grid item>` props and `sx` typing expect MUI v5). Always pass **`--legacy-peer-deps`** when running `npm install` in `frontend/` because `@mui/lab@5.0.0-alpha.173` conflicts with React 19 peer range.
2. **Jest Polyfills**: `frontend/src/setupTests.ts` polyfills `TextEncoder`/`TextDecoder` from Node `util` so `@auth0/auth0-spa-js` loads under CRA Jest; `frontend/src/App.test.tsx` virtually mocks `react-router-dom` v7.
3. **Interactive 3D Card Stability**: `Perspective3DCard.tsx` uses a recessed 3D `backingPlane` while keeping its foreground interactive card axis-aligned so pointer hit-testing on buttons/tables never drifts.
4. **Python & CLI Environment on Host**:
   - Host Python is `Python 3.9.6` (with globally installed `fastapi 0.128.8`, `uvicorn 0.39.0`, `boto3 1.42.97`, `pydantic 2.13.5`).
   - Available CLIs on PATH (`/opt/homebrew/bin:/usr/local/bin:/usr/bin`): `git`, `docker`, `kubectl`, `aws`, `helm`, `terraform`. (`trivy` is not installed.)
   - `backend/connections/` already contains one existing connection file (`aws_20251101202316.json`).
   - Previous local test created kubeconfig discovery output showing context `arn:aws:eks:us-east-1:783953295581:cluster/test-anish`.
5. **Auth0 Status**:
   - Auth0 CLI (`auth0`) is not installed; `.env` files have NOT been written (only `.env.example` templates). Until real `REACT_APP_AUTH0_DOMAIN` & `REACT_APP_AUTH0_CLIENT_ID` are placed in `frontend/.env`, `AuthContext.tsx` safely runs `FallbackAuthBridge` (Dev SSO fallback + local auth) without mounting `<Auth0Provider>` on empty values.

---

## 6. How to Run & Verify Locally

Both dev servers were stopped at handoff time. Start them cleanly in two terminals:

```bash
# Terminal 1: FastAPI Backend (port 8000)
cd /Users/ankit/TW/technoworld/backend
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: React Frontend (port 3000)
cd /Users/ankit/TW/technoworld/frontend
TSC_COMPILE_ON_ERROR=true npm start
```

Tests & production build:
```bash
cd /Users/ankit/TW/technoworld/frontend
CI=true npm test -- --watchAll=false
npm run build
```

---

## 7. Known Gaps & Next Steps to Continue

1. **Incremental Streaming Logs in Pipelines**: Currently `_execute_pipeline_sync` returns all stages on completion; updating `state["stages"]` after *each* stage completes inside `run_pipeline_async` will stream live per-stage progress during long `docker build` / `kubectl apply` runs.
2. **Container Registry Push in Pipelines**: Wire verified `aws-ecr` (`aws ecr get-login-password | docker login`) and `dockerhub` integrations directly into the Pipeline modal (`registryIntegrationId`) and execute `docker push` after `docker build`.
3. **Auth0 Live Tenant + Backend JWT Enforcement**: Once `frontend/.env` (`REACT_APP_AUTH0_DOMAIN`, `REACT_APP_AUTH0_CLIENT_ID`, optional `REACT_APP_AUTH0_AUDIENCE`) and `backend/.env` (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`) are populated, add FastAPI RS256 JWKS Bearer token verification in `atmosly_router.py` (using `PyJWT` or `auth0-fastapi-api` — note `auth0-fastapi-api` requires Python 3.10+, whereas host currently has Python 3.9.6 so `PyJWT[crypto]` or a pyenv/venv Python 3.10+ works cleanly).
4. **Figma Sync / Motion (`uWj0q7V24rFEWWmxqpLQEv`)**: Previous Figma Starter plan hit MCP tool call quota before updating colors from the older blue/purple tokens to Obsidian Black/White/Blue or adding `/figma-use-motion` keyframe animations.
5. **Refresh `GEMINI.md`**: Update `GEMINI.md` color tokens and component inventory to match the Obsidian Black/White/Blue theme, Auth0 bridge, and real Atmosly modules.
