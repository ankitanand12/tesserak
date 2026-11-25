import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
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
} from '@mui/icons-material';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { useTesserakAuth } from '../auth/AuthContext';

export const Settings: React.FC = () => {
  const { isAuth0Configured, sessionUser } = useTesserakAuth();
  const [backendAuthStatus, setBackendAuthStatus] = useState<{
    mode: string;
    auth0Configured: boolean;
    database?: string;
  } | null>(null);
  const [authStatusError, setAuthStatusError] = useState(false);
  const [autoReconcile, setAutoReconcile] = useState(true);
  const [finopsAlerts, setFinopsAlerts] = useState(true);
  const [ephemeralReap, setEphemeralReap] = useState(true);

  useEffect(() => {
    fetch('http://localhost:8000/api/auth/status')
      .then((r) => {
        if (!r.ok) throw new Error('Backend auth status unavailable');
        return r.json();
      })
      .then((data) => {
        setBackendAuthStatus(data);
        setAuthStatusError(false);
      })
      .catch(() => {
        setBackendAuthStatus(null);
        setAuthStatusError(true);
      });
  }, []);

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
                  authStatusError
                    ? 'Backend Status Unreachable'
                    : backendAuthStatus === null
                    ? 'Checking Backend Auth...'
                    : backendAuthStatus.auth0Configured
                    ? 'Backend JWT Verification Active'
                    : 'Backend: Open Dev Header Mode'
                }
                variant="outlined"
                color={authStatusError ? 'warning' : 'default'}
                sx={{
                  borderColor: authStatusError ? '#f59e0b' : '#2563eb',
                  color: '#09090b',
                  fontWeight: 600,
                }}
              />
              {backendAuthStatus?.database === 'postgresql' && (
                <Chip
                  label="PostgreSQL Active"
                  sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 700 }}
                />
              )}
            </Box>

            <Alert severity="info" sx={{ mb: 2 }}>
              Signed in as <strong>{sessionUser?.email}</strong> ({sessionUser?.authProvider || 'local'}).
              Copy <code>frontend/.env.example</code> to <code>frontend/.env</code> with your Auth0 tenant domain and SPA Client ID to activate Universal Login redirects.
            </Alert>
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
