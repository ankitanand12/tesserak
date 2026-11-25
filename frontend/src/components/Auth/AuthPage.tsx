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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  Business as BusinessIcon,
  Google as GoogleIcon,
  Key as KeyIcon,
  Layers as LayersIcon,
  Person as PersonIcon,
  Security as SecurityIcon,
  Shield as ShieldIcon,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { TesserakLogo } from '../TesserakLogo';
import { Hypercube3D } from '../Hypercube3D';
import { Perspective3DCard } from '../Perspective3DCard';
import { useTesserakAuth } from '../../auth/AuthContext';
import type { AccountType } from '../../types/user';

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
  const [accountType, setAccountType] = useState<AccountType>('individual');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [organization, setOrganization] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [ssoDialogOpen, setSsoDialogOpen] = useState(false);
  const [ssoEmail, setSsoEmail] = useState('platform.lead@company.io');
  const [ssoProviderLabel, setSsoProviderLabel] = useState('Auth0 Enterprise SSO');

  const completeLocalLogin = (
    userEmail: string,
    token?: string,
    profile?: {
      firstName?: string;
      lastName?: string;
      accountType?: AccountType;
      organization?: string;
    }
  ) => {
    loginWithLocal(userEmail, { token, profile });
    onLogin?.(userEmail);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.');
      return;
    }

    if (tab === 1) {
      if (!firstName.trim() || !lastName.trim()) {
        setError('Please enter your first and last name.');
        return;
      }
      if (accountType === 'organization' && !organization.trim()) {
        setError('Please enter your organization name.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
    }

    setSubmitting(true);
    const users = JSON.parse(localStorage.getItem('users') || '{}');

    try {
      if (tab === 0) {
        const res = await fetch('http://localhost:8000/api/auth/email/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmedEmail, password }),
        });

        if (res.ok) {
          const data = await res.json();
          completeLocalLogin(data.user.email, data.token, data.user);
          return;
        }

        // Seamless migration for accounts created earlier in localStorage
        const cached = users[trimmedEmail];
        if (res.status === 401 && cached && cached.password === password) {
          const regRes = await fetch('http://localhost:8000/api/auth/email/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: trimmedEmail,
              password,
              firstName: cached.firstName || trimmedEmail.split('@')[0],
              lastName: cached.lastName || 'User',
              accountType: cached.accountType || 'individual',
              organization: cached.organization || 'Individual Workspace',
            }),
          });
          if (regRes.ok) {
            const regData = await regRes.json();
            completeLocalLogin(regData.user.email, regData.token, regData.user);
            return;
          }
        }

        const errData = await res.json().catch(() => ({}));
        setError(errData.detail || 'Invalid email or password.');
        return;
      }

      const resolvedOrg =
        accountType === 'organization' ? organization.trim() : 'Individual Workspace';
      const res = await fetch('http://localhost:8000/api/auth/email/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          accountType,
          organization: resolvedOrg,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || 'Unable to create account.');
        return;
      }
      completeLocalLogin(data.user.email, data.token, data.user);
    } catch {
      // Offline fallback when Auth0 is unconfigured and backend isn't reachable
      if (!isAuth0Configured) {
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
              accountType: 'individual',
              organization: 'Individual Workspace',
            };
            localStorage.setItem('users', JSON.stringify(users));
          }
          completeLocalLogin(trimmedEmail, undefined, users[trimmedEmail]);
          return;
        }
        const resolvedOrg =
          accountType === 'organization' ? organization.trim() : 'Individual Workspace';
        users[trimmedEmail] = {
          email: trimmedEmail,
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          accountType,
          organization: resolvedOrg,
        };
        localStorage.setItem('users', JSON.stringify(users));
        completeLocalLogin(trimmedEmail, undefined, users[trimmedEmail]);
        return;
      }
      setError('Unable to reach backend authentication service on localhost:8000.');
    } finally {
      setSubmitting(false);
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
                Multi-dimensional Cloud &amp; Kubernetes Control Plane
              </Typography>
              <Typography variant="body2" sx={{ color: '#cbd5e1', mb: 3, lineHeight: 1.65 }}>
                Provision AWS EKS clusters, self-service RDS/Redis cloud resources, CI/CD preview pipelines, and policy guardrails with enterprise Auth0 SSO or email workspace access.
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

          {/* Right Auth0 SSO & Email Credential Card */}
          <Grid item xs={12} md={6}>
            <Perspective3DCard flattenOnFocus sx={{ p: { xs: 3, sm: 4.5 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#09090b' }}>
                    {tab === 0 ? 'Sign in to Workspace' : 'Create Platform Account'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#475569' }}>
                    Auth0 SSO &amp; Individual / Organization Email Access
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
                  OR EMAIL &amp; PASSWORD ACCESS
                </Typography>
              </Divider>

              <Tabs
                value={tab}
                onChange={(_, v) => {
                  setTab(v);
                  setError('');
                }}
                variant="fullWidth"
                sx={{ mb: 2.25 }}
              >
                <Tab label="Sign In" sx={{ fontWeight: 700, textTransform: 'none' }} />
                <Tab label="Create Account" sx={{ fontWeight: 700, textTransform: 'none' }} />
              </Tabs>

              <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                {tab === 1 && (
                  <>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#475569', fontWeight: 700, display: 'block', mb: 0.75 }}>
                        Account Type
                      </Typography>
                      <ToggleButtonGroup
                        exclusive
                        fullWidth
                        size="small"
                        value={accountType}
                        onChange={(_, val: AccountType | null) => {
                          if (val) setAccountType(val);
                        }}
                        aria-label="Account type"
                        sx={{
                          '& .MuiToggleButton-root': {
                            textTransform: 'none',
                            fontWeight: 700,
                            borderColor: 'rgba(15,23,42,0.18)',
                            color: '#334155',
                            gap: 0.75,
                          },
                          '& .MuiToggleButton-root.Mui-selected': {
                            bgcolor: '#09090b',
                            color: '#ffffff',
                            borderColor: '#2563eb',
                            '&:hover': { bgcolor: '#18181b' },
                          },
                        }}
                      >
                        <ToggleButton value="individual" aria-label="Individual account">
                          <PersonIcon fontSize="small" />
                          Individual
                        </ToggleButton>
                        <ToggleButton value="organization" aria-label="Organization account">
                          <BusinessIcon fontSize="small" />
                          Organization
                        </ToggleButton>
                      </ToggleButtonGroup>
                    </Box>

                    <Grid container spacing={1.5}>
                      <Grid item xs={6}>
                        <TextField
                          label="First Name"
                          size="small"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          required
                          fullWidth
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          label="Last Name"
                          size="small"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          required
                          fullWidth
                        />
                      </Grid>
                    </Grid>

                    {accountType === 'organization' && (
                      <TextField
                        label="Organization Name"
                        placeholder="e.g. Acme Cloud Platform"
                        size="small"
                        value={organization}
                        onChange={(e) => setOrganization(e.target.value)}
                        required
                        fullWidth
                      />
                    )}
                  </>
                )}

                <TextField
                  label={tab === 1 && accountType === 'organization' ? 'Work Email' : 'Email Address'}
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
                  helperText={tab === 1 ? 'Minimum 6 characters' : undefined}
                  required
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                <Button
                  type="submit"
                  variant="outlined"
                  disabled={submitting}
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
                  {tab === 0
                    ? submitting
                      ? 'Signing In...'
                      : 'Sign In with Email'
                    : submitting
                    ? 'Creating Account...'
                    : accountType === 'organization'
                    ? 'Create Organization Account'
                    : 'Create Individual Account'}
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
