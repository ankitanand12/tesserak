import React, { useEffect, useState } from 'react';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  ThemeProvider,
  createTheme,
} from '@mui/material';
import {
  AccountTree as PipelineIcon,
  Cable as CableIcon,
  CloudQueue as CloudQueueIcon,
  Dashboard as DashboardIcon,
  GppGood as GuardrailIcon,
  Logout as LogoutIcon,
  Menu as MenuIcon,
  Person as PersonIcon,
  Settings as SettingsIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import {
  HashRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { TesserakAuthProvider, useTesserakAuth } from './auth/AuthContext';
import { AuthPage } from './components/Auth/AuthPage';
import { TesserakLogo } from './components/TesserakLogo';
import Dashboard from './pages/Dashboard';
import Clusters from './pages/Clusters';
import ClusterDetails from './pages/ClusterDetails';
import CreateCluster from './pages/CreateCluster';
import Profile from './pages/Profile';
import { CloudResources } from './pages/CloudResources';
import { Guardrails } from './pages/Guardrails';
import { Pipelines } from './pages/Pipelines';
import { Integrations } from './pages/Integrations';
import { Settings } from './pages/Settings';

const drawerWidth = 248;

const obsidianBlueTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563eb',
      light: '#60a5fa',
      dark: '#1d4ed8',
    },
    secondary: {
      main: '#09090b',
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
          '&:hover': {
            background: 'linear-gradient(135deg, #000000 0%, #1d4ed8 100%)',
            boxShadow: '0 12px 24px -6px rgba(37, 99, 235, 0.5)',
          },
          '&.Mui-disabled': {
            background: '#e2e8f0',
            color: '#64748b',
            boxShadow: 'none',
          },
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
    MuiBackdrop: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(9, 9, 11, 0.62)',
        },
      },
    },
  },
});

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Overview | Tesserak',
  '/clusters': 'Clusters (EKS) | Tesserak',
  '/create-cluster': 'Launch EKS Cluster | Tesserak',
  '/resources': 'Cloud Resources | Tesserak',
  '/infrastructure': 'Cloud Resources | Tesserak',
  '/pipelines': 'CI/CD Pipelines | Tesserak',
  '/guardrails': 'Guardrails | Tesserak',
  '/security': 'Guardrails | Tesserak',
  '/integrations': 'Integrations | Tesserak',
  '/connectors': 'Integrations | Tesserak',
  '/settings': 'Settings | Tesserak',
  '/profile': 'Profile & Identity | Tesserak',
};

const navItems = [
  { label: 'Overview', path: '/', icon: <DashboardIcon /> },
  { label: 'Clusters (EKS)', path: '/clusters', icon: <StorageIcon /> },
  { label: 'Cloud Resources', path: '/resources', icon: <CloudQueueIcon /> },
  { label: 'CI/CD Pipelines', path: '/pipelines', icon: <PipelineIcon /> },
  { label: 'Guardrails', path: '/guardrails', icon: <GuardrailIcon /> },
  { label: 'Integrations', path: '/integrations', icon: <CableIcon /> },
  { label: 'Settings', path: '/settings', icon: <SettingsIcon /> },
];

interface LayoutProps {
  children: React.ReactNode;
  onLogout: () => void;
  currentUser: string;
  authProviderLabel: string;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  onLogout,
  currentUser,
  authProviderLabel,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const title = location.pathname.startsWith('/clusters/')
      ? 'Cluster Details | Tesserak'
      : ROUTE_TITLES[location.pathname] || 'Tesserak | EKS & Cloud IDP';
    document.title = title;
  }, [location.pathname]);

  const users = JSON.parse(localStorage.getItem('users') || '{}');
  const userProfile = users[currentUser] || { firstName: currentUser.split('@')[0], lastName: '' };
  const initials =
    ((userProfile.firstName?.[0] || currentUser[0] || 'T') +
      (userProfile.lastName?.[0] || '')).toUpperCase();

  const handleNav = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const drawerContent = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#09090b',
        color: '#ffffff',
        borderRight: '1px solid rgba(59, 130, 246, 0.25)',
      }}
    >
      <Toolbar sx={{ px: 2.5, gap: 1.25 }}>
        <TesserakLogo size={28} variant="light" />
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
            Tesserak
          </Typography>
          <Typography variant="caption" sx={{ color: '#60a5fa', fontWeight: 700, fontSize: '0.68rem' }}>
            EKS &amp; CLOUD IDP
          </Typography>
        </Box>
      </Toolbar>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
      <List sx={{ px: 1.5, py: 2, flexGrow: 1 }}>
        {navItems.map((item) => {
          const isActive =
            location.pathname === item.path ||
            (item.path === '/clusters' &&
              (location.pathname === '/create-cluster' || location.pathname.startsWith('/clusters/'))) ||
            (item.path === '/resources' && location.pathname === '/infrastructure') ||
            (item.path === '/guardrails' && location.pathname === '/security') ||
            (item.path === '/integrations' && location.pathname === '/connectors');

          return (
            <ListItem key={item.path} disablePadding sx={{ mb: 0.6 }}>
              <ListItemButton
                onClick={() => handleNav(item.path)}
                sx={{
                  borderRadius: 2.2,
                  py: 1,
                  bgcolor: isActive ? 'rgba(37, 99, 235, 0.22)' : 'transparent',
                  border: isActive ? '1px solid rgba(96, 165, 250, 0.45)' : '1px solid transparent',
                  color: isActive ? '#ffffff' : '#cbd5e1',
                  '&:hover': {
                    bgcolor: isActive ? 'rgba(37, 99, 235, 0.28)' : 'rgba(255, 255, 255, 0.06)',
                    color: '#ffffff',
                  },
                }}
              >
                <ListItemIcon sx={{ color: isActive ? '#60a5fa' : '#94a3b8', minWidth: 38 }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontSize: '0.88rem',
                    fontWeight: isActive ? 700 : 500,
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
      <Box sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <Chip
          label={authProviderLabel}
          size="small"
          sx={{
            width: '100%',
            bgcolor: '#18181b',
            color: '#93c5fd',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            fontWeight: 700,
            fontSize: '0.72rem',
          }}
        />
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          bgcolor: '#09090b',
          borderBottom: '1px solid rgba(37, 99, 235, 0.38)',
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => {
                if (window.innerWidth < 900) {
                  setMobileOpen(!mobileOpen);
                } else {
                  setDesktopOpen(!desktopOpen);
                }
              }}
            >
              <MenuIcon />
            </IconButton>
            <TesserakLogo size={30} variant="light" />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                Tesserak
              </Typography>
              <Typography variant="caption" sx={{ color: '#93c5fd', display: { xs: 'none', sm: 'block' } }}>
                EKS Manager · Resources · Guardrails · Pipelines
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="caption" sx={{ color: '#cbd5e1', display: { xs: 'none', sm: 'block' } }}>
              {currentUser}
            </Typography>
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ p: 0.4 }}>
              <Avatar
                src={userProfile.avatarUrl}
                sx={{
                  width: 36,
                  height: 36,
                  bgcolor: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 700,
                  border: '2px solid rgba(255,255,255,0.28)',
                }}
              >
                {initials}
              </Avatar>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={() => setAnchorEl(null)}
            >
              <MenuItem
                onClick={() => {
                  setAnchorEl(null);
                  navigate('/profile');
                }}
              >
                <ListItemIcon>
                  <PersonIcon fontSize="small" />
                </ListItemIcon>
                Profile &amp; Identity
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setAnchorEl(null);
                  navigate('/settings');
                }}
              >
                <ListItemIcon>
                  <SettingsIcon fontSize="small" />
                </ListItemIcon>
                Platform Settings
              </MenuItem>
              <Divider />
              <MenuItem
                onClick={() => {
                  setAnchorEl(null);
                  onLogout();
                }}
              >
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                Sign Out
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Mobile Drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box', bgcolor: '#09090b' },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Desktop Drawer */}
      {desktopOpen && (
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            width: drawerWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              bgcolor: '#09090b',
              borderRight: 'none',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        id="main-content"
        tabIndex={-1}
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3.5 },
          mt: '64px',
          maxWidth: '100%',
          overflowX: 'hidden',
          outline: 'none',
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

const AppShell: React.FC = () => {
  const { isAuthenticated, isLoading, userEmail, sessionUser, loginWithLocal, logout } =
    useTesserakAuth();

  if (isLoading) {
    return (
      <ThemeProvider theme={obsidianBlueTheme}>
        <CssBaseline />
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: '#09090b',
            color: '#ffffff',
            gap: 2,
          }}
        >
          <TesserakLogo size={42} variant="light" />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Verifying Auth0 Session...
          </Typography>
        </Box>
      </ThemeProvider>
    );
  }

  if (!isAuthenticated || !userEmail) {
    return (
      <ThemeProvider theme={obsidianBlueTheme}>
        <CssBaseline />
        <AuthPage onLogin={loginWithLocal} />
      </ThemeProvider>
    );
  }

  const providerBadge =
    sessionUser?.authProvider === 'auth0'
      ? 'Auth0 SSO Verified'
      : sessionUser?.authProvider === 'auth0-demo-sso'
      ? 'Auth0 SSO (Dev Mode)'
      : sessionUser?.authProvider === 'email'
      ? sessionUser.accountType === 'organization'
        ? `Org Account · ${sessionUser.organization || 'Team'}`
        : 'Individual Email Account'
      : 'Local Workspace Session';

  return (
    <Router>
      <ThemeProvider theme={obsidianBlueTheme}>
        <CssBaseline />
        <Layout onLogout={logout} currentUser={userEmail} authProviderLabel={providerBadge}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clusters" element={<Clusters />} />
            <Route path="/clusters/:clusterName" element={<ClusterDetails />} />
            <Route path="/create-cluster" element={<CreateCluster />} />
            <Route path="/resources" element={<CloudResources />} />
            <Route path="/infrastructure" element={<CloudResources />} />
            <Route path="/pipelines" element={<Pipelines />} />
            <Route path="/guardrails" element={<Guardrails />} />
            <Route path="/security" element={<Guardrails />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/connectors" element={<Integrations />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile email={userEmail} />} />
          </Routes>
        </Layout>
      </ThemeProvider>
    </Router>
  );
};

function App() {
  return (
    <TesserakAuthProvider>
      <AppShell />
    </TesserakAuthProvider>
  );
}

export default App;
