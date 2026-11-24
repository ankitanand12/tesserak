import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  Link,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  Business as BusinessIcon,
  Google as GoogleIcon,
  Key as KeyIcon,
  Layers as LayersIcon,
  Security as SecurityIcon,
  Shield as ShieldIcon,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { TesserakLogo } from '../TesserakLogo';
import { Hypercube3D } from '../Hypercube3D';
import { Perspective3DCard } from '../Perspective3DCard';
import { useTesserakAuth } from '../../auth/AuthContext';

interface AuthPageProps {
  onLogin?: (email: string) => void;
}

const AuthButton = styled(Button)({
  borderRadius: 10,
  padding: '11px 22px',
  textTransform: 'none',
  fontSize: '0.96rem',
  fontWeight: 700,
  boxShadow: 'none',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&.MuiButton-contained': {
    background: 'linear-gradient(135deg, #09090b 0%, #2563eb 100%)',
    color: '#ffffff',
    '&:hover': {
      background: 'linear-gradient(135deg, #000000 0%, #1d4ed8 100%)',
      transform: 'translateY(-1px)',
      boxShadow: '0 10px 22px rgba(37, 99, 235, 0.28)',
    },
  },
});

const PillChip = ({ label, icon }: { label: string; icon: React.ReactNode }) => (
  <Box
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.75,
      px: 1.5,
      py: 0.75,
      borderRadius: '999px',
      bgcolor: 'rgba(255, 255, 255, 0.08)',
      border: '1px solid rgba(96, 165, 250, 0.35)',
      color: '#ffffff',
      fontSize: '0.78rem',
      fontWeight: 600,
      backdropFilter: 'blur(8px)',
    }}
  >
    {icon}
    <span>{label}</span>
  </Box>
);

export const AuthPage: React.FC<AuthPageProps> = ({ onLogin }) => {
  const {
    isAuth0Configured,
    authError,
    loginWithLocal,
    loginWithAuth0,
    simulateAuth0Sso,
  } = useTesserakAuth();

  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [organization, setOrganization] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [ssoDialogOpen, setSsoDialogOpen] = useState(false);
  const [ssoEmail, setSsoEmail] = useState('platform.lead@company.io');
  const [ssoProviderLabel, setSsoProviderLabel] = useState('Auth0 Enterprise SSO');

  const completeLocalLogin = (userEmail: string) => {
    loginWithLocal(userEmail);
    onLogin?.(userEmail);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.');
      return;
    }

    const users = JSON.parse(localStorage.getItem('users') || '{}');

    if (tab === 0) {
      if (users[trimmedEmail] && users[trimmedEmail].password !== password) {
        setError('Incorrect password for this account.');
        return;
      }
      if (!users[trimmedEmail]) {
        users[trimmedEmail] = {
          email: trimmedEmail,
          password,
          firstName: trimmedEmail.split('@')[0],
          lastName: 'User',
          organization: 'Tesserak Cloud',
        };
        localStorage.setItem('users', JSON.stringify(users));
      }
      completeLocalLogin(trimmedEmail);
    } else {
      if (!firstName.trim() || !lastName.trim()) {
        setError('Please enter your first and last name.');
        return;
      }
      users[trimmedEmail] = {
        email: trimmedEmail,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        organization: organization.trim() || 'Tesserak Cloud',
      };
      localStorage.setItem('users', JSON.stringify(users));
      completeLocalLogin(trimmedEmail);
    }
  };

  const handleAuth0Trigger = async (
    label: string,
    options?: { connection?: string; screen_hint?: 'signup' | 'login' }
  ) => {
    setError('');
    if (isAuth0Configured) {
      try {
        await loginWithAuth0(options);
      } catch (err: any) {
        setError(err?.message || 'Unable to redirect to Auth0 Universal Login.');
      }
      return;
    }
    setSsoProviderLabel(label);
    setSsoDialogOpen(true);
  };

  const handleDemoSsoSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = ssoEmail.trim().toLowerCase();
    if (!clean) return;
    simulateAuth0Sso(clean, ssoProviderLabel);
    setSsoDialogOpen(false);
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)',
        position: 'relative',
        overflow: 'hidden',
        py: 4,
      }}
    >
      <Container maxWidth="lg">
        <Grid container spacing={4} alignItems="center">
          {/* Left Obsidian 3D Spatial Showcase */}
          <Grid item xs={12} md={6}>
            <Box
              sx={{
                borderRadius: '24px',
                bgcolor: '#09090b',
                color: '#ffffff',
                p: { xs: 3.5, md: 5 },
                border: '1px solid rgba(59, 130, 246, 0.35)',
                boxShadow: '0 28px 64px -20px rgba(9, 9, 11, 0.55)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  top: -90,
                  right: -90,
                  width: 280,
                  height: 280,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(37,99,235,0.28) 0%, rgba(9,9,11,0) 70%)',
                  pointerEvents: 'none',
                }}
              />

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
                <TesserakLogo size={42} variant="light" />
                <Box>
                  <Typography
                    component="h1"
                    variant="h4"
                    sx={{ fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em', lineHeight: 1.1 }}
                  >
                    Tesserak
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#93c5fd', fontWeight: 700 }}>
                    Tesserak | EKS Cluster Manager
                  </Typography>
                </Box>
              </Box>

              <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.25, color: '#ffffff' }}>
                Multi-dimensional Cloud & Kubernetes Control Plane
              </Typography>
              <Typography variant="body2" sx={{ color: '#cbd5e1', mb: 3, lineHeight: 1.65 }}>
                Provision AWS EKS clusters, self-service RDS/Redis cloud resources, CI/CD preview pipelines, and policy guardrails with enterprise Auth0 SSO.
              </Typography>

              <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                <Hypercube3D size={156} interactive />
              </Box>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
                <PillChip
                  label="Cloud Resources"
                  icon={<LayersIcon sx={{ fontSize: 15, color: '#60a5fa' }} />}
                />
                <PillChip
                  label="Guardrails Engine"
                  icon={<ShieldIcon sx={{ fontSize: 15, color: '#60a5fa' }} />}
                />
                <PillChip
                  label="CI/CD Pipelines"
                  icon={<SecurityIcon sx={{ fontSize: 15, color: '#60a5fa' }} />}
                />
              </Box>
            </Box>
          </Grid>

          {/* Right Auth0 SSO & Credential Card */}
          <Grid item xs={12} md={6}>
            <Perspective3DCard flattenOnFocus sx={{ p: { xs: 3, sm: 4.5 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#09090b' }}>
                    {tab === 0 ? 'Sign in to Workspace' : 'Create Platform Account'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#475569' }}>
                    Secured by Auth0 SSO & Local Workspace Fallback
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={isAuth0Configured ? 'Auth0 Connected' : 'Auth0 Ready (Dev Mode)'}
                  sx={{
                    fontWeight: 700,
                    bgcolor: isAuth0Configured ? '#eff6ff' : '#09090b',
                    color: isAuth0Configured ? '#1d4ed8' : '#ffffff',
                    border: '1px solid #2563eb',
                  }}
                />
              </Box>

              {(error || authError) && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                  {error || authError}
                </Alert>
              )}

              {/* Auth0 SSO Action Buttons */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, mb: 2.5 }}>
                <AuthButton
                  fullWidth
                  variant="contained"
                  startIcon={<KeyIcon />}
                  onClick={() =>
                    handleAuth0Trigger('Auth0 Universal Login', {
                      screen_hint: tab === 1 ? 'signup' : 'login',
                    })
                  }
                >
                  Continue with Auth0 SSO
                </AuthButton>

                <Grid container spacing={1.25}>
                  <Grid item xs={12} sm={6}>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<GoogleIcon />}
                      onClick={() =>
                        handleAuth0Trigger('Google Workspace (Auth0)', {
                          connection: 'google-oauth2',
                        })
                      }
                      sx={{
                        py: 1,
                        borderRadius: 2.5,
                        borderColor: 'rgba(15,23,42,0.2)',
                        color: '#09090b',
                        fontWeight: 600,
                        '&:hover': { borderColor: '#2563eb', bgcolor: '#eff6ff' },
                      }}
                    >
                      Google SSO
                    </Button>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<BusinessIcon />}
                      onClick={() => handleAuth0Trigger('Enterprise SAML / Okta')}
                      sx={{
                        py: 1,
                        borderRadius: 2.5,
                        borderColor: 'rgba(15,23,42,0.2)',
                        color: '#09090b',
                        fontWeight: 600,
                        '&:hover': { borderColor: '#2563eb', bgcolor: '#eff6ff' },
                      }}
                    >
                      Enterprise SAML
                    </Button>
                  </Grid>
                </Grid>
              </Box>

              <Divider sx={{ my: 2 }}>
                <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                  OR LOCAL WORKSPACE ACCESS
                </Typography>
              </Divider>

              <Tabs
                value={tab}
                onChange={(_, v) => {
                  setTab(v);
                  setError('');
                }}
                variant="fullWidth"
                sx={{ mb: 2.5 }}
              >
                <Tab label="Sign In" sx={{ fontWeight: 700, textTransform: 'none' }} />
                <Tab label="Create Account" sx={{ fontWeight: 700, textTransform: 'none' }} />
              </Tabs>

              <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                {tab === 1 && (
                  <>
                    <Grid container spacing={1.5}>
                      <Grid item xs={6}>
                        <TextField
                          label="First Name"
                          size="small"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          fullWidth
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          label="Last Name"
                          size="small"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          fullWidth
                        />
                      </Grid>
                    </Grid>
                    <TextField
                      label="Organization"
                      size="small"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      fullWidth
                    />
                  </>
                )}

                <TextField
                  label="Work Email"
                  type="email"
                  size="small"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  fullWidth
                />

                <TextField
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  size="small"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setShowPassword(!showPassword)}>
                          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                <Button
                  type="submit"
                  variant="outlined"
                  fullWidth
                  sx={{
                    mt: 0.5,
                    py: 1.15,
                    borderRadius: 2.5,
                    borderColor: '#09090b',
                    color: '#09090b',
                    fontWeight: 700,
                    '&:hover': {
                      bgcolor: '#09090b',
                      color: '#ffffff',
                      borderColor: '#09090b',
                    },
                  }}
                >
                  {tab === 0 ? 'Sign In Locally' : 'Register Local Account'}
                </Button>
              </Box>

              {!isAuth0Configured && (
                <Typography variant="caption" sx={{ display: 'block', mt: 2, color: '#64748b', textAlign: 'center' }}>
                  To enable live Auth0 redirects, copy <code>frontend/.env.example</code> to{' '}
                  <code>frontend/.env</code> or{' '}
                  <Link
                    component="button"
                    type="button"
                    onClick={() => handleAuth0Trigger('Auth0 Universal Login')}
                    sx={{ color: '#2563eb', fontWeight: 700 }}
                  >
                    test SSO in Dev Mode
                  </Link>
                  .
                </Typography>
              )}
            </Perspective3DCard>
          </Grid>
        </Grid>
      </Container>

      {/* Auth0 Configuration / Dev SSO Preview Modal */}
      <Dialog
        open={ssoDialogOpen}
        onClose={() => setSsoDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: '#ffffff',
            backgroundImage: 'none',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 28px 64px rgba(9, 9, 11, 0.48)',
          },
        }}
        sx={{
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(9, 9, 11, 0.68)',
            backdropFilter: 'blur(4px)',
          },
        }}
      >
        <form onSubmit={handleDemoSsoSignIn}>
          <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
            {ssoProviderLabel} — Auth0 Tenant Configuration
          </DialogTitle>
          <DialogContent sx={{ bgcolor: '#ffffff', pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Alert severity="info">
              Live Auth0 redirect requires <strong>REACT_APP_AUTH0_DOMAIN</strong> and{' '}
              <strong>REACT_APP_AUTH0_CLIENT_ID</strong> in <code>frontend/.env</code> (callback URL:{' '}
              <code>{window.location.origin}</code>).
            </Alert>
            <Typography variant="body2" sx={{ color: '#334155' }}>
              You can test the full SSO experience right now in Dev Fallback mode by entering your corporate email below:
            </Typography>
            <TextField
              label="SSO Work Email"
              type="email"
              value={ssoEmail}
              onChange={(e) => setSsoEmail(e.target.value)}
              required
              fullWidth
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setSsoDialogOpen(false)} sx={{ color: '#475569' }}>
              Close
            </Button>
            <Button type="submit" variant="contained">
              Continue as SSO User (Dev Fallback)
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};
