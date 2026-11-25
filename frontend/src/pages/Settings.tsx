import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Grid,
  Switch,
  Typography,
} from '@mui/material';
import {
  Key as KeyIcon,
  NotificationsActive as NotificationsIcon,
  Security as SecurityIcon,
  VerifiedUser as VerifiedUserIcon,
} from '@mui/icons-material';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { useTesserakAuth } from '../auth/AuthContext';
import { API_BASE_URL, buildAuthHeaders } from '../utils/apiClient';

export const Settings: React.FC = () => {
  const { isAuth0Configured, sessionUser, userEmail, getAccessToken } = useTesserakAuth();
  const [backendAuthStatus, setBackendAuthStatus] = useState<{ mode: string; auth0Configured: boolean } | null>(null);
  const [jwtVerifyResult, setJwtVerifyResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [autoReconcile, setAutoReconcile] = useState(true);
  const [finopsAlerts, setFinopsAlerts] = useState(true);
  const [ephemeralReap, setEphemeralReap] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/auth/status`)
      .then((r) => r.json())
      .then(setBackendAuthStatus)
      .catch(() => null);
  }, []);

  const handleVerifyJwt = async () => {
    setJwtVerifyResult(null);
    try {
      const headers = await buildAuthHeaders(userEmail || 'demo@tesserak.dev', getAccessToken);
      const res = await fetch(`${API_BASE_URL}/api/auth/me`, { headers });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setJwtVerifyResult({
          ok: true,
          text: `JWKS Verified — sub: ${body.sub} · aud: ${Array.isArray(body.aud) ? body.aud.join(', ') : body.aud}`,
        });
      } else {
        const desc =
          typeof body.detail === 'object'
            ? `${body.detail.error}: ${body.detail.error_description}`
            : body.detail || `HTTP ${res.status}`;
        setJwtVerifyResult({ ok: false, text: `Rejected (${res.status}): ${desc}` });
      }
    } catch {
      setJwtVerifyResult({ ok: false, text: 'Unable to reach FastAPI /api/auth/me endpoint.' });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', letterSpacing: '-0.02em' }}>
          Platform Settings
        </Typography>
        <Typography variant="body2" sx={{ color: '#475569' }}>
          Manage Auth0 Single Sign-On status, telemetry preferences, and control-plane automation defaults.
        </Typography>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Perspective3DCard sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
              <KeyIcon sx={{ color: '#2563eb' }} />
              <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b' }}>
                Auth0 SSO & Identity Status
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              <Chip
                label={isAuth0Configured ? 'Frontend Auth0 Active' : 'Frontend: Local Fallback'}
                sx={{
                  bgcolor: isAuth0Configured ? '#eff6ff' : '#09090b',
                  color: isAuth0Configured ? '#1d4ed8' : '#ffffff',
                  fontWeight: 700,
                }}
              />
              <Chip
                label={
                  backendAuthStatus?.auth0Configured
                    ? 'Backend JWT Verification Active'
                    : 'Backend: Open Dev Header Mode'
                }
                variant="outlined"
                sx={{ borderColor: '#2563eb', color: '#09090b', fontWeight: 600 }}
              />
            </Box>

            <Alert severity="info" sx={{ mb: 2 }}>
              Signed in as <strong>{sessionUser?.email}</strong> ({sessionUser?.authProvider || 'local'}).
              Copy <code>frontend/.env.example</code> to <code>frontend/.env</code> and <code>backend/.env.example</code> to <code>backend/.env</code> with your Auth0 tenant domain, SPA Client ID, and API Audience to activate Universal Login + JWKS verification.
            </Alert>

            <Button
              variant="outlined"
              size="small"
              startIcon={<VerifiedUserIcon fontSize="small" />}
              onClick={handleVerifyJwt}
              sx={{ borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 }}
            >
              Test Backend JWT Guard (/api/auth/me)
            </Button>

            {jwtVerifyResult && (
              <Alert severity={jwtVerifyResult.ok ? 'success' : 'warning'} sx={{ mt: 1.5 }}>
                {jwtVerifyResult.text}
              </Alert>
            )}
          </Perspective3DCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <Perspective3DCard sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
              <SecurityIcon sx={{ color: '#2563eb' }} />
              <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b' }}>
                Control Plane Automation
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <FormControlLabel
                control={<Switch checked={autoReconcile} onChange={(e) => setAutoReconcile(e.target.checked)} />}
                label="Continuous Cloud Resource State & Drift Monitoring"
              />
              <FormControlLabel
                control={<Switch checked={finopsAlerts} onChange={(e) => setFinopsAlerts(e.target.checked)} />}
                label="Route High-Cost Provisioning (> $250/mo) to Guardrail Approvals"
              />
              <FormControlLabel
                control={<Switch checked={ephemeralReap} onChange={(e) => setEphemeralReap(e.target.checked)} />}
                label="Auto-Cleanup Ephemeral PR Preview Environments after 24h"
              />
            </Box>

            <Box sx={{ mt: 2, p: 1.75, borderRadius: 2, bgcolor: '#09090b', color: '#ffffff', display: 'flex', alignItems: 'center', gap: 1.2 }}>
              <NotificationsIcon sx={{ color: '#60a5fa' }} />
              <Typography variant="caption" sx={{ color: '#e2e8f0' }}>
                Theme Mode: Obsidian Black + Pure White + Electric Blue (MUI v5 3D Perspective)
              </Typography>
            </Box>
          </Perspective3DCard>
        </Grid>
      </Grid>
    </Box>
  );
};
