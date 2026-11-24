# Tesserak Design System & Figma MCP Integration Rules

This document captures the design system structure, conventions, and technical rules for the **Tesserak | EKS Cluster Manager** codebase (`frontend/` + `backend/`), to guide implementing Figma designs via the Model Context Protocol (MCP).

---

## 1. Token Definitions

### Where Tokens Are Defined
Design tokens are centralized in `frontend/src/App.tsx` via Material UI's `createTheme()` (`lightTheme`) and injected globally at the root via `<ThemeProvider theme={lightTheme}>` and `<CssBaseline />`.

```tsx
// frontend/src/App.tsx
const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563eb', // Tesserak Blue
      light: '#60a5fa',
      dark: '#1d4ed8',
    },
    secondary: {
      main: '#7c3aed', // Tesserak Purple
      light: '#a78bfa',
      dark: '#5b21b6',
    },
    background: {
      default: '#fafafa',
      paper: '#ffffff',
    },
    text: {
      primary: '#1e293b',
      secondary: '#475569',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700 },
    h2: { fontWeight: 600 },
    h3: { fontWeight: 600 },
  },
});
```

### Component-Local & Uncentralized Tokens
Several gradients, status colors, and surface tokens live outside `lightTheme` and must be preserved or consolidated into `lightTheme` when translating Figma variables:

| Token Category | Value | Location |
| :--- | :--- | :--- |
| AppBar Gradient | `linear-gradient(90deg, #1e40af 0%, #3730a3 100%)` | `frontend/src/App.tsx` |
| Auth Page Backdrop | `linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)` + subtle purple/blue radial gradients (`rgba(124, 58, 237, 0.1)`, `rgba(37, 99, 235, 0.1)`) | `frontend/src/components/Auth/AuthPage.tsx` |
| Primary CTA Gradient | `linear-gradient(45deg, #2563eb, #7c3aed)` (hover: `#1d4ed8` -> `#6d28d9`) | `frontend/src/components/Auth/AuthPage.tsx` |
| Glass Card Surface | `rgba(255, 255, 255, 0.9)` with `backdropFilter: 'blur(10px)'` | `frontend/src/components/Auth/AuthPage.tsx` |
| Chart Status Palette | `['#4caf50', '#ff9800', '#f44336']` (Healthy/Synced, Warning/Needs Sync, Critical/Missing) | `frontend/src/components/ClusterHealth.tsx` |
| Brand Mark Palette | Light: `#ffffff` / `#c7d2fe`; Gradient: `#2563eb` / `#7c3aed` | `frontend/src/components/TesserakLogo.tsx` |
| PWA / Browser Chrome | `theme-color: #1e40af`, `background_color: #fafafa` | `frontend/public/index.html`, `frontend/public/manifest.json` |
| Layout Constants | `drawerWidth = 240` | `frontend/src/App.tsx` |

### Token Structure & Transformation Rules
- **Format**: Typed JavaScript/TypeScript theme object consumed by MUI v5 (`ThemeProvider`).
- **Spacing & Radius Nuance**:
  - MUI `sx` numeric spacing uses the default `8px` base unit (`p: 3` = `24px`, `gap: 2` = `16px`).
  - Numeric `borderRadius` inside `sx` multiplies `theme.shape.borderRadius` (`12px`) — e.g., `sx={{ borderRadius: 3 }}` resolves to `36px`, whereas `styled()` CSS literals (`borderRadius: 10` in `AuthPage.tsx`) resolve to `10px`.
- **Transformation Systems**: **None** (no Style Dictionary, Tokens Studio sync, `:root` CSS custom properties, or Tailwind config). Map Figma design tokens directly into `lightTheme` palette/typography/shape keys or `sx` theme callbacks (`(theme) => ...`).
- **Font Caveat**: `Inter` is listed first in `lightTheme.typography.fontFamily`, though no external Google Fonts `<link>` is currently loaded in `frontend/public/index.html`; system fonts (`Roboto`, `Helvetica`, `-apple-system`) act as fallback unless `Inter` is loaded.

---

## 2. Component Library

### UI Component Locations & Architecture
- **Base Component Library**: Material UI v5 (`@mui/material`), plus `@mui/lab`.
  - **Version Constraint**: Stay pinned to **MUI v5** (`^5.16.14`). Do not auto-upgrade to MUI v6, which breaks existing `<Grid item>` props and `sx` TypeScript inference.
- **Page Components (`frontend/src/pages/`)**:
  - `Dashboard.tsx`, `CreateCluster.tsx`, `Connectors.tsx`, `Profile.tsx`
  - Scaffolded placeholders: `Infrastructure.tsx`, `Security.tsx`, `Settings.tsx`
- **Feature & Shared Components (`frontend/src/components/`)**:
  - `TesserakLogo.tsx`: Geometric hypercube brand icon (`size`, `variant: 'light' | 'gradient'`, `sx`).
  - `Hypercube3D.tsx`: Interactive 6-face CSS 3D perspective hypercube (`size`, `interactive`) mirroring Figma's `Tesserak/Hypercube 3D`.
  - `Perspective3DCard.tsx`: Reusable 3D tilted glass card wrapper (`perspective`, `baseRotateX`, `baseRotateY`, `backingPlane`, `flattenOnFocus`).
  - `Auth/AuthPage.tsx`: Split-panel 3D hero & login/sign-up view with `Hypercube3D`, floating telemetry pills, and `Perspective3DCard` form.
  - `ClusterListManager.tsx`: Render-prop polling container (`children: (clusters: Cluster[]) => React.ReactNode`, 60s interval).
  - `ClusterTable.tsx`: MUI `Table` with pill status indicators, tooltips, and delete actions.
  - `ClusterHealth.tsx`: Recharts donut chart + side-by-side legend rows.
  - `Connectors/ConnectorForm.tsx` & `ConnectorList.tsx`: AWS credential testing form and 3D `Perspective3DCard` connector list.
  - `CreateCluster/`: Multi-step 3D pill workflow (`ClusterBasicDetails.tsx`, `ClusterEnvironment.tsx`, `ClusterAddons.tsx`, `ClusterPreview.tsx`) paired with live 3D stacked layers preview.

### Key Component Patterns
1. **Typed Functional Components + MUI Composition**:
   ```tsx
   // frontend/src/components/TesserakLogo.tsx
   interface TesserakLogoProps {
     size?: number;
     variant?: 'light' | 'gradient';
     sx?: SxProps<Theme>;
   }
   ```
2. **Custom `styled()` Overrides for Branded Controls**:
   ```tsx
   // frontend/src/components/Auth/AuthPage.tsx
   const AuthButton = styled(Button)({
     borderRadius: 10,
     padding: '12px 24px',
     textTransform: 'none',
     '&.MuiButton-contained': {
       background: 'linear-gradient(45deg, #2563eb, #7c3aed)',
     },
   });
   ```
3. **Domain Layout Wrapper (`Layout` in `frontend/src/App.tsx`)**: Wraps all authenticated routes in a fixed `AppBar` + permanent `Drawer` + `<Box component="main" sx={{ flexGrow: 1, p: 3 }}>`.
4. **No `components/ui/` Folder & No Storybook**: There is no shadcn/ui structure, no barrel `index.ts` exports, and no Storybook setup. Document new reusable primitives directly under `frontend/src/components/`.

---

## 3. Frameworks & Libraries

| Layer | Technology / Version (`frontend/package.json`) | Notes |
| :--- | :--- | :--- |
| UI Framework | `react` (`^19.2.0`), `react-dom` (`^19.2.0`) | Functional components + Hooks |
| Language | `typescript` (`^4.9.5`) | `strict: true`, `jsx: react-jsx` (`frontend/tsconfig.json`) |
| Routing | `react-router-dom` (`^7.14.1`) | `HashRouter` in `frontend/src/App.tsx` |
| UI Kit & Styling | `@mui/material` (`^5.16.14`), `@mui/lab` (`^5.0.0-alpha.173`), `@emotion/react` (`^11.14.0`), `@emotion/styled` (`^11.14.0`) | Install with `--legacy-peer-deps` due to React 19 vs `@mui/lab` peer range |
| Icons | `@mui/icons-material` (`^5.16.14`) | Material icon React components |
| Charts | `recharts` (`^3.8.1`) | Used in `ClusterHealth.tsx` (`PieChart`, `ResponsiveContainer`) |
| Build / Bundler | `react-scripts` (`5.0.1`) | Create React App (Webpack + Babel + ESLint) |
| Testing | `@testing-library/react` (`^16.3.0`), `@testing-library/jest-dom` (`^6.9.1`) | Jest requires virtual mock for `react-router-dom` v7 ESM (`App.test.tsx`) |
| Backend API | FastAPI (`0.104.1`), Pydantic (`2.4.2`), Boto3 (`1.29.0`), Uvicorn (`0.24.0`) | Runs on `http://localhost:8000` (`backend/main.py`) |

---

## 4. Asset Management

- **Public Static Assets (`frontend/public/`)**:
  - Served relative to `/` or `%PUBLIC_URL%/`.
  - Contains `devops-illustration.svg` (Auth hero graphic), `favicon.svg`, `favicon.ico`, `logo192.png`, `logo512.png`, `manifest.json`, and `robots.txt`.
  - Referenced directly in JSX via root path: `<img src="/devops-illustration.svg" alt="Tesserak Cloud Infrastructure Illustration" />` (`AuthPage.tsx`).
- **Inline SVG Assets (`frontend/src/components/`)**:
  - `TesserakLogo.tsx` embeds inline SVG markup so strokes/fills adapt via props (`variant="light" | "gradient"`).
  - Note: `frontend/src/logo.svg` is a leftover CRA asset and is unused.
- **User-Uploaded Images & Optimization**:
  - `frontend/src/utils/imageUtils.ts` (`compressImage`) resizes uploaded profile avatars on an HTML5 `<canvas>` (`maxWidth: 300`, `maxHeight: 300`) and iteratively lowers JPEG quality (`0.9` down to `0.1`) until payload fits under `0.2 MB` (`200 KB`), storing the base64 Data URL in `localStorage`.
- **Bundling & CDN**:
  - `npm run build` compiles and hashes static assets into `frontend/build/static/`.
  - **No CDN configuration** (`homepage` is unset in `frontend/package.json`).

---

## 5. Icon System

- **Library**: `@mui/icons-material` (`^5.16.14`) for all standard UI icons, plus `TesserakLogo` (`frontend/src/components/TesserakLogo.tsx`) for brand marks.
- **Import Conventions** (both patterns exist; prefer tree-shakeable individual path imports for new Figma components):
  ```tsx
  // Individual path imports (preferred)
  import GoogleIcon from '@mui/icons-material/Google';
  import DeleteIcon from '@mui/icons-material/Delete';

  // Named barrel imports (also used in App.tsx, Dashboard.tsx, ClusterTable.tsx)
  import { Dashboard as DashboardIcon, Add as AddIcon } from '@mui/icons-material';
  ```
- **Naming & Usage**:
  - Suffix imported Material icons with `Icon` (e.g., `AddIcon`, `MenuIcon`, `SecurityIcon`, `CloseIcon`, `InfoIcon`).
  - Render inside `<ListItemIcon>`, `<IconButton>`, `<Button startIcon={...}>`, `<InputAdornment>`, or `<Tooltip>`.
  - When importing custom SVG icons from Figma, wrap them as typed React SVG components matching `TesserakLogo.tsx` (using `viewBox`, `size`, and theme-aware stroke/fill props) rather than raw `<img>` tags when color customization is needed.

---

## 6. Styling Approach

- **CSS Methodology**: **Emotion CSS-in-JS via MUI's `sx` prop** (primary) and **`styled()` from `@mui/material/styles`** (for reusable styled variants).
  - No CSS Modules, no Tailwind CSS, no Sass/SCSS.
- **Global Styles**:
  - `<CssBaseline />` (`App.tsx`) normalizes styles and applies `lightTheme` defaults.
  - `frontend/src/index.css` sets baseline `body` margin and font fallback stack.
  - `frontend/src/App.css` is legacy CRA boilerplate and unused.
- **Responsive Design Rules**:
  - Use MUI `<Container maxWidth="lg" | "md">` and `<Grid container spacing={...}>` with breakpoint props (`xs`, `sm`, `md`):
    ```tsx
    // AuthPage.tsx (split desktop -> stacked mobile)
    <Grid container spacing={4} sx={{ minHeight: '80vh', alignItems: 'center' }}>
      <Grid item xs={12} md={6}>...</Grid>
      <Grid item xs={12} md={6}>...</Grid>
    </Grid>
    ```
  - **Responsive Shell & Layout Rules**:
    - `App.tsx` switches between a `temporary` mobile `<Drawer>` below `md` and a collapsible `permanent`/`persistent` 240px `<Drawer>` on `md+`.
    - Health cards in `Dashboard.tsx` and `ClusterHealth.tsx` use auto-height side-by-side `132×132` donut rings + legends so charts never clip across viewports.

---

## 7. Project Structure

```text
technoworld/
├── README.md                           # Full-stack documentation (Tesserak | EKS Cluster Manager)
├── GEMINI.md                           # Design system & Figma MCP rules
├── backend/                            # FastAPI + Boto3 API (port 8000)
│   ├── main.py                         # FastAPI routes, OpenAPI metadata, CORS (localhost:3000)
│   ├── connections.py                  # AWS credential connection manager
│   ├── state_manager.py                # Local/AWS cluster state sync engine
│   ├── state_management.py             # AWS EKS state reader
│   └── requirements.txt
└── frontend/                           # Create React App + TypeScript (port 3000)
    ├── package.json                    # tesserak-frontend, MUI v5, React 19, Recharts
    ├── tsconfig.json                   # Strict TypeScript config
    ├── public/                         # index.html, manifest.json, favicon.svg/.ico, logo192/512, devops-illustration.svg
    └── src/
        ├── App.tsx                     # lightTheme, Layout shell, auth gate, HashRouter routes
        ├── index.tsx & index.css       # React root & baseline CSS
        ├── pages/                      # Route-level pages (Dashboard, CreateCluster, Connectors, Profile, etc.)
        ├── components/                 # Reusable & feature-grouped components
        │   ├── Auth/                   # AuthPage.tsx
        │   ├── Connectors/             # ConnectorForm.tsx, ConnectorList.tsx
        │   ├── CreateCluster/          # Stepper step views (BasicDetails, Environment, Addons, Preview)
        │   ├── TesserakLogo.tsx        # Brand hypercube SVG component
        │   ├── Hypercube3D.tsx         # 6-face interactive CSS 3D perspective hypercube
        │   ├── Perspective3DCard.tsx   # Reusable 3D perspective glass surface wrapper
        │   ├── ClusterHealth.tsx       # Recharts PieChart status card
        │   ├── ClusterTable.tsx        # Cluster status data table
        │   └── ClusterListManager.tsx  # Polling state wrapper
        ├── types/                      # Shared TypeScript interfaces (cluster.ts, user.ts)
        └── utils/                      # Helpers (imageUtils.ts, regionMapping.ts)
```

### Feature Organization & Figma Integration Checklist
1. **Place new routes** in `frontend/src/pages/` and register them inside `<Routes>` in `frontend/src/App.tsx`.
2. **Group complex feature subcomponents** in subdirectories under `frontend/src/components/<FeatureName>/` (matching `Auth/`, `Connectors/`, `CreateCluster/`).
3. **Map Figma styles to MUI v5**: Translate Figma colors, spacing (`8px` grid), typography, and radii into `lightTheme` (`frontend/src/App.tsx`) and `sx` / `styled()` rather than introducing Tailwind or external CSS files.
4. **Preserve brand identity**: Use `<TesserakLogo />` and pair **Tesserak** with a clear product subtitle (e.g., `Tesserak | EKS Manager`) on top-level headers and entry screens.
