# Tesserak Design System & Figma MCP Integration Rules

This document captures the design system structure, conventions, and technical rules for **Tesserak | EKS & Cloud IDP** (`frontend/` + `backend/`), to guide UI changes and translating Figma designs via the Model Context Protocol (MCP).

---

## 1. Token Definitions

### Where Tokens Are Defined
Design tokens are centralized in `frontend/src/App.tsx` via Material UI's `createTheme()` (`obsidianBlueTheme`) and injected globally at the root via `<ThemeProvider theme={obsidianBlueTheme}>` and `<CssBaseline />`.

```tsx
// frontend/src/App.tsx
const obsidianBlueTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563eb', // Electric Blue
      light: '#60a5fa',
      dark: '#1d4ed8',
    },
    secondary: {
      main: '#09090b', // Obsidian Black
      light: '#27272a',
      dark: '#000000',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    text: {
      primary: '#09090b',
      secondary: '#475569',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 800 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 700,
          borderRadius: 10,
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #09090b 0%, #2563eb 100%)',
          color: '#ffffff',
          boxShadow: '0 8px 18px -6px rgba(37, 99, 235, 0.42)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: '#ffffff',
          backgroundImage: 'none',
          borderRadius: 16,
          border: '1px solid rgba(15, 23, 42, 0.14)',
          boxShadow: '0 28px 64px -16px rgba(9, 9, 11, 0.45)',
        },
      },
    },
  },
});
```

### Brand, Shell, and Status Tokens
| Token Category | Value | Location |
| :--- | :--- | :--- |
| Primary CTA Gradient | `linear-gradient(135deg, #09090b 0%, #2563eb 100%)` | `frontend/src/App.tsx` |
| Shell / Sidebar Surface | `#09090b` (Obsidian Black) with `rgba(59, 130, 246, 0.25)` border | `frontend/src/App.tsx` |
| Active Nav Pill | `rgba(37, 99, 235, 0.22)` fill, `rgba(96, 165, 250, 0.45)` border | `frontend/src/App.tsx` |
| Dialog Backdrop | `rgba(9, 9, 11, 0.62)` | `frontend/src/App.tsx` |
| Chart Status Palette | `['#4caf50', '#ff9800', '#f44336']` (Synced, Needs Sync, Missing/Deleted) | `frontend/src/components/ClusterHealth.tsx` |
| Brand Mark (`TesserakLogo`) | `variant="light" | "gradient"` (`#2563eb` / `#7c3aed` gradient option) | `frontend/src/components/TesserakLogo.tsx` |
| Layout Constants | `drawerWidth = 248` | `frontend/src/App.tsx` |

### Spacing & Radius Rules
- MUI `sx` numeric spacing uses the `8px` base unit (`p: 3` = `24px`, `gap: 2` = `16px`).
- Numeric `borderRadius` inside `sx` multiplies `theme.shape.borderRadius` (`12px`) — e.g., `borderRadius: 2.2` ≈ `26.4px`, whereas `styleOverrides` / `styled()` CSS literals (`borderRadius: 10`) resolve to `10px`.
- Respect user accessibility preferences: avoid continuous infinite 3D animations when `prefers-reduced-motion: reduce` is active.

---

## 2. Component Library

- **Base Component Library**: Material UI v5 (`@mui/material` `^5.16.14`), plus `@mui/lab` (`^5.0.0-alpha.173`).
  - **Version Constraint**: Stay pinned to **MUI v5**. Do not auto-upgrade to MUI v6, which breaks `<Grid item>` props and `sx` TypeScript inference.
- **Route Pages (`frontend/src/pages/`)**:
  - Primary routes (`BrowserRouter` in `App.tsx`):
    - `/` -> `Dashboard.tsx`
    - `/clusters` -> `Clusters.tsx`
    - `/clusters/:clusterName` -> `ClusterDetails.tsx`
    - `/create-cluster` -> `CreateCluster.tsx`
    - `/resources` -> `CloudResources.tsx` (alias `/infrastructure` -> `CloudResources.tsx`)
    - `/pipelines` -> `Pipelines.tsx`
    - `/guardrails` -> `Guardrails.tsx` (alias `/security` -> `Guardrails.tsx`)
    - `/integrations` -> `Integrations.tsx` (alias `/connectors` -> `Integrations.tsx`)
    - `/settings` -> `Settings.tsx`
    - `/profile` -> `Profile.tsx`
- **Feature & Shared Components (`frontend/src/components/`)**:
  - `TesserakLogo.tsx`: Geometric hypercube brand mark (`size`, `variant`, `sx`).
  - `Hypercube3D.tsx`: Interactive 6-face CSS 3D perspective hypercube (`size`, `interactive`).
  - `Perspective3DCard.tsx`: Reusable 3D tilted surface wrapper (`perspective`, `baseRotateX`, `baseRotateY`, `backingPlane`, `flattenOnFocus`).
  - `ConfirmDeleteDialog.tsx`: Reusable confirmation modal required before every destructive delete action across the platform.
  - `Auth/AuthPage.tsx`: Split-panel 3D hero & Auth0/email/org login experience.
  - `ClusterListManager.tsx`: 60-second polling state reconciliation wrapper.
  - `ClusterTable.tsx`: EKS cluster inventory table with status pills, sync triggers, and confirmation-guarded deletion.
  - `ClusterHealth.tsx`: Recharts `PieChart` donut ring + status legend rows.
  - `Clusters/NodeDetailsDialog.tsx`: Kubernetes node inspection modal with metadata and paginated pod table (`10` pods/page).
  - `Connectors/ConnectorForm.tsx` & `ConnectorList.tsx`: AWS IAM credential test/save workflow and connected account cards.
  - `CreateCluster/`: `ClusterBasicDetails.tsx`, `ClusterEnvironment.tsx`, `ClusterAddons.tsx`, `ClusterPreview.tsx`, `InstanceTypeSelect.tsx`, `NumericCountField.tsx`.

---

## 3. Frameworks & Libraries

| Layer | Technology / Version (`frontend/package.json`) | Notes |
| :--- | :--- | :--- |
| UI Framework | `react` (`^19.2.0`), `react-dom` (`^19.2.0`) | Functional components + Hooks |
| Language | `typescript` (`^4.9.5`) | `strict: true` (`frontend/tsconfig.json`) |
| Routing | `react-router-dom` (`^7.14.1`) | `BrowserRouter` (`Router`) in `frontend/src/App.tsx` |
| Auth | `@auth0/auth0-react` (`^2.30.0`) | Wrapped by `TesserakAuthProvider` (`frontend/src/auth/AuthContext.tsx`) |
| UI Kit & Styling | `@mui/material` (`^5.16.14`), `@mui/lab` (`^5.0.0-alpha.173`), `@emotion/react` (`^11.14.0`), `@emotion/styled` (`^11.14.0`) | Install with `--legacy-peer-deps` |
| Icons | `@mui/icons-material` (`^5.16.14`) | Individual or named icon imports (`*Icon` suffix) |
| Charts | `recharts` (`^3.8.1`) | Used in `ClusterHealth.tsx` |
| Build / Testing | `react-scripts` (`5.0.1`), `@testing-library/react` (`^16.3.0`), `@testing-library/jest-dom` (`^6.9.1`) | CRA Webpack + Jest |
| Backend API | FastAPI (`0.104.1`), Pydantic (`2.4.2`), Boto3 (`1.29.0`), SQLAlchemy (`>=2.0,<2.1`), Uvicorn (`0.24.0`) | Runs on `http://localhost:8000` |

---

## 4. Styling, Assets & Conventions

- **Styling**: Emotion CSS-in-JS via MUI `sx` and `styled()` (`@mui/material/styles`). Do not introduce Tailwind CSS, CSS Modules, or SCSS.
- **Controlled Input Pattern**: For search-heavy `Autocomplete` (`InstanceTypeSelect`) and bounded integer fields (`NumericCountField`), decouple interactive input strings from normalized parent values during typing/focus so users can clear fields cleanly without cursor jump or snap-back.
- **Static Assets**: `frontend/public/` holds `devops-illustration.svg`, icons, and `manifest.json`; `frontend/src/utils/imageUtils.ts` (`compressImage`) resizes avatar uploads client-side.
- **Client Cache & Utilities**: Use `frontend/src/utils/swrCache.ts`, `dateUtils.ts`, `regionMapping.ts` rather than duplicating date formatting or fetch caching helpers.

---

## 5. Project Structure & Integration Checklist

```text
tesserak/
├── README.md
├── PROJECT_CONTEXT.md
├── GEMINI.md
├── CHANGELOG.md
├── docs/
│   └── FEATURES.md
├── backend/                            # FastAPI + SQLAlchemy (PostgreSQL) + Boto3 API
│   ├── main.py
│   ├── tesserak_router.py
│   ├── db.py
│   ├── connections.py
│   ├── auth.py
│   ├── state_manager.py
│   ├── state_management.py
│   ├── resources_service.py
│   ├── pipelines_service.py
│   ├── integrations_service.py
│   ├── migrate_json_to_pg.py
│   └── test_fixes.py
└── frontend/
    ├── package.json
    ├── public/
    └── src/
        ├── App.tsx
        ├── auth/AuthContext.tsx
        ├── pages/
        ├── components/
        ├── types/
        └── utils/
```

1. **Place new routes** in `frontend/src/pages/` and register them inside `<Routes>` (`BrowserRouter`) plus `ROUTE_TITLES` in `frontend/src/App.tsx`.
2. **Guard every delete flow** with `<ConfirmDeleteDialog />` (`frontend/src/components/ConfirmDeleteDialog.tsx`).
3. **Map Figma styles into `obsidianBlueTheme`** (`#09090b` / `#ffffff` / `#f8fafc` / `#2563eb`) using MUI v5 components and `sx`.
4. **Preserve brand identity**: Use `<TesserakLogo />` and keep the `Tesserak` Obsidian/Blue palette consistent across all views.
