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
  MarkEmailRead as MarkEmailReadIcon,
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
  onSuccessToast?: (message: string) => void;
}

interface PendingEmailVerification {
  email: string;
  accountType: AccountType;
  organization: string;
  deliveryMode: 'smtp' | 'dev-preview' | 'local-offline';
  devOtp?: string;
  message: string;
  offlineProfile?: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    accountType: AccountType;
    organization: string;
  };
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

export const AuthPage: React.FC<AuthPageProps> = ({ onLogin, onSuccessToast }) => {
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
  const [notice, setNotice] = useState('');
  const [pendingVerification, setPendingVerification] =
    useState<PendingEmailVerification | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [ssoDialogOpen, setSsoDialogOpen] = useState(false);
  const [ssoEmail, setSsoEmail] = useState('platform.lead@company.io');
  const [ssoProviderLabel, setSsoProviderLabel] = useState('Auth0 Enterprise SSO');

  const resetAuthForm = () => {
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
    setOrganization('');
    setShowPassword(false);
    setOtpCode('');
    setPendingVerification(null);
    setError('');
    setNotice('');
  };

  const completeLocalLogin = (
    userEmail: string,
    token?: string,
    profile?: {
      firstName?: string;
      lastName?: string;
      accountType?: AccountType;
      organization?: string;
    },
    successMessage?: string
  ) => {
    loginWithLocal(userEmail, { token, profile });
    if (onLogin && onLogin !== loginWithLocal) {
      onLogin(userEmail);
    }
    if (successMessage) {
      onSuccessToast?.(successMessage);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
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
          const orgLabel =
            data.user.accountType === 'organization' && data.user.organization
              ? ` · ${data.user.organization}`
              : '';
          completeLocalLogin(
            data.user.email,
            data.token,
            data.user,
            `Signed in as ${data.user.email}${orgLabel}.`
          );
          return;
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
      if (data.verificationRequired) {
        setPendingVerification({
          email: data.email || trimmedEmail,
          accountType: data.accountType || accountType,
          organization: data.organization || resolvedOrg,
          deliveryMode: data.deliveryMode || 'dev-preview',
          devOtp: data.devOtp,
          message:
            data.message || `Verification code sent to ${trimmedEmail}. Enter the 6-digit OTP below.`,
        });
        setOtpCode('');
        setNotice(
          data.message || `Verification code generated for ${trimmedEmail}.`
        );
        return;
      }
      if (data.user) {
        const createdMsg =
          data.user.accountType === 'organization'
            ? `Organization account created for ${data.user.organization}.`
            : `Individual account created for ${data.user.email}.`;
        completeLocalLogin(data.user.email, data.token, data.user, createdMsg);
      }
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
          completeLocalLogin(
            trimmedEmail,
            undefined,
            users[trimmedEmail],
            `Signed in as ${trimmedEmail}.`
          );
          return;
        }
        const resolvedOrg =
          accountType === 'organization' ? organization.trim() : 'Individual Workspace';
        const localOtp = String(Math.floor(100000 + Math.random() * 900000));
        setPendingVerification({
          email: trimmedEmail,
          accountType,
          organization: resolvedOrg,
          deliveryMode: 'local-offline',
          devOtp: localOtp,
          message:
            'Backend offline preview: enter the 6-digit verification code below to finish creating your account.',
          offlineProfile: {
            email: trimmedEmail,
            password,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            accountType,
            organization: resolvedOrg,
          },
        });
        setOtpCode('');
        setNotice(`Verification code generated for ${trimmedEmail}.`);
        return;
      }
      setError('Unable to reach backend authentication service on localhost:8000.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVerification) return;
    setError('');
    setNotice('');
    const cleanOtp = otpCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanOtp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    setSubmitting(true);
    try {
      if (
        pendingVerification.deliveryMode === 'local-offline' &&
        pendingVerification.offlineProfile
      ) {
        if (cleanOtp !== pendingVerification.devOtp) {
          setError('Invalid verification code. Check the 6-digit code shown above.');
          return;
        }
        const profile = pendingVerification.offlineProfile;
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        users[profile.email] = profile;
        localStorage.setItem('users', JSON.stringify(users));
        const createdMsg =
          profile.accountType === 'organization'
            ? `Organization account verified and created for ${profile.organization}.`
            : `Individual account verified and created for ${profile.email}.`;
        completeLocalLogin(profile.email, undefined, profile, createdMsg);
        return;
      }

      const res = await fetch('http://localhost:8000/api/auth/email/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingVerification.email, otp: cleanOtp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || 'Invalid or expired verification code.');
        return;
      }
      const createdMsg =
        data.message ||
        (data.user?.accountType === 'organization'
          ? `Organization account verified and created for ${data.user.organization}.`
          : `Individual account verified and created for ${data.user?.email || pendingVerification.email}.`);
      setNotice(createdMsg);
      completeLocalLogin(data.user.email, data.token, data.user, createdMsg);
    } catch {
      setError('Unable to reach backend verification endpoint on localhost:8000.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!pendingVerification) return;
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      if (pendingVerification.deliveryMode === 'local-offline') {
        const nextOtp = String(Math.floor(100000 + Math.random() * 900000));
        setPendingVerification({
          ...pendingVerification,
          devOtp: nextOtp,
        });
        setOtpCode('');
        setNotice(`New verification code generated for ${pendingVerification.email}.`);
        return;
      }

      const res = await fetch('http://localhost:8000/api/auth/email/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingVerification.email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || 'Unable to resend verification code.');
        return;
      }
      setPendingVerification({
        ...pendingVerification,
        deliveryMode: data.deliveryMode || pendingVerification.deliveryMode,
        devOtp: data.devOtp,
        message: data.message || pendingVerification.message,
      });
      setOtpCode('');
      setNotice(data.message || `New verification code issued for ${pendingVerification.email}.`);
    } catch {
      setError('Unable to reach backend resend OTP endpoint on localhost:8000.');
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
              {notice && (
                <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
                  {notice}
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
                  if (v !== tab) {
                    setTab(v);
                    resetAuthForm();
                  }
                }}
                variant="fullWidth"
                sx={{ mb: 2.25 }}
              >
                <Tab label="Sign In" sx={{ fontWeight: 700, textTransform: 'none' }} />
                <Tab label="Create Account" sx={{ fontWeight: 700, textTransform: 'none' }} />
              </Tabs>

              {tab === 1 && pendingVerification ? (
                <Box
                  component="form"
                  key="verify-otp-form"
                  onSubmit={handleVerifyOtp}
                  sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}
                >
                  <Box
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      bgcolor: '#f8fafc',
                      border: '1px solid rgba(37, 99, 235, 0.22)',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <MarkEmailReadIcon fontSize="small" sx={{ color: '#2563eb' }} />
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b' }}>
                          Verify Email Address
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        label={
                          pendingVerification.accountType === 'organization'
                            ? `Organization · ${pendingVerification.organization}`
                            : 'Individual Account'
                        }
                        sx={{
                          fontWeight: 700,
                          bgcolor: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe',
                        }}
                      />
                    </Box>
                    <Typography variant="caption" sx={{ color: '#475569', display: 'block' }}>
                      Enter the 6-digit verification OTP for <strong>{pendingVerification.email}</strong>
                    </Typography>
                  </Box>

                  {pendingVerification.deliveryMode !== 'smtp' && pendingVerification.devOtp && (
                    <Alert
                      severity="info"
                      sx={{ borderRadius: 2, alignItems: 'center' }}
                      action={
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => setOtpCode(pendingVerification.devOtp || '')}
                          sx={{ fontWeight: 700, textTransform: 'none', whiteSpace: 'nowrap' }}
                        >
                          Use Code
                        </Button>
                      }
                    >
                      <Typography variant="caption" sx={{ display: 'block', color: '#0f172a' }}>
                        Local dev preview OTP:{' '}
                        <Box component="strong" sx={{ fontFamily: 'monospace', fontSize: '0.95rem', letterSpacing: 1 }}>
                          {pendingVerification.devOtp}
                        </Box>
                      </Typography>
                    </Alert>
                  )}

                  <TextField
                    label="Verification Code (6-digit OTP)"
                    placeholder="Enter 6-digit code"
                    size="small"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputProps={{ maxLength: 6, inputMode: 'numeric', pattern: '[0-9]*' }}
                    autoComplete="one-time-code"
                    required
                    fullWidth
                  />

                  <Button
                    type="submit"
                    variant="contained"
                    disabled={submitting}
                    fullWidth
                    sx={{
                      mt: 0.5,
                      py: 1.15,
                      borderRadius: 2.5,
                      fontWeight: 700,
                      textTransform: 'none',
                    }}
                  >
                    {submitting ? 'Verifying OTP...' : 'Verify Email & Create Account'}
                  </Button>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      type="button"
                      size="small"
                      disabled={submitting}
                      onClick={handleResendOtp}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      Resend Code
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      disabled={submitting}
                      onClick={() => {
                        setPendingVerification(null);
                        setOtpCode('');
                        setError('');
                        setNotice('');
                      }}
                      sx={{ textTransform: 'none', fontWeight: 600, color: '#475569' }}
                    >
                      Edit Registration Details
                    </Button>
                  </Box>
                </Box>
              ) : (
              <Box
                component="form"
                key={tab === 0 ? 'signin-form' : 'signup-form'}
                autoComplete="off"
                onSubmit={handleSubmit}
                sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}
              >
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
                          if (val && val !== accountType) {
                            setAccountType(val);
                            setOrganization('');
                            setError('');
                            setNotice('');
                          }
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
                          autoComplete="given-name"
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
                          autoComplete="family-name"
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
                        autoComplete="organization"
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
                  autoComplete={tab === 0 ? 'username' : 'off'}
                  required
                  fullWidth
                />

                <TextField
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  size="small"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={tab === 0 ? 'current-password' : 'new-password'}
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
                    ? 'Sending Verification OTP...'
                    : accountType === 'organization'
                    ? 'Create Organization Account'
                    : 'Create Individual Account'}
                </Button>
              </Box>
              )}

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
