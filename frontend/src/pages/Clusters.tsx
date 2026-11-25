import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Cable as CableIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  Storage as StorageIcon,
  SyncProblem as SyncProblemIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
import ClusterHealth from '../components/ClusterHealth';
import ClusterListManager from '../components/ClusterListManager';
import ClusterTable from '../components/ClusterTable';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { Cluster } from '../types/cluster';
import { API_BASE_URL, buildAuthHeaders } from '../utils/apiClient';

export const Clusters: React.FC = () => {
  const navigate = useNavigate();
  const { userEmail: ctxEmail, getAccessToken } = useTesserakAuth();
  const userEmail = ctxEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';
  const [actionMsg, setActionMsg] = useState<{ severity: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [syncingCluster, setSyncingCluster] = useState<string | null>(null);

  const handleDeleteCluster = async (clusterName: string, refresh: () => Promise<void>) => {
    try {
      const headers = await buildAuthHeaders(userEmail, getAccessToken);
      const response = await fetch(`${API_BASE_URL}/clusters/${clusterName}`, {
        method: 'DELETE',
        headers,
      });
      if (response.ok) {
        setActionMsg({ severity: 'info', text: `Deletion initiated for cluster "${clusterName}".` });
        await refresh();
      } else {
        const err = await response.json().catch(() => ({}));
        setActionMsg({
          severity: 'error',
          text: err.detail || `Unable to delete cluster "${clusterName}" right now.`,
        });
      }
    } catch {
      setActionMsg({ severity: 'error', text: `Failed to reach backend to delete "${clusterName}".` });
    }
  };

  const handleSyncCluster = async (clusterName: string, refresh: () => Promise<void>) => {
    setSyncingCluster(clusterName);
    try {
      const headers = await buildAuthHeaders(userEmail, getAccessToken);
      const response = await fetch(`${API_BASE_URL}/clusters/${clusterName}/sync`, {
        method: 'POST',
        headers,
      });
      if (response.ok) {
        setActionMsg({
          severity: 'success',
          text: `Synchronized local state with live AWS EKS cluster "${clusterName}".`,
        });
        await refresh();
      } else {
        const err = await response.json().catch(() => ({}));
        setActionMsg({
          severity: 'error',
          text: err.detail || `Failed to sync state for "${clusterName}".`,
        });
      }
    } catch {
      setActionMsg({ severity: 'error', text: `Failed to reach backend to sync "${clusterName}".` });
    } finally {
      setSyncingCluster(null);
    }
  };

  return (
    <ClusterListManager>
      {(clusters: Cluster[], refresh, loading) => {
        const activeCount = clusters.filter((c) => c.status === 'ACTIVE' && !c.deletedAt).length;
        const syncedCount = clusters.filter(
          (c) => c.stateStatus === 'synced' || c.stateStatus === 'in_sync'
        ).length;
        const diffCount = clusters.filter((c) => c.stateStatus === 'differences_found').length;
        const missingCount = clusters.filter(
          (c) => c.stateStatus === 'missing_local' || c.stateStatus === 'deleted'
        ).length;

        const healthData = [
          { name: 'Synced', value: syncedCount },
          { name: 'Needs Sync', value: diffCount },
          { name: 'Unsynced / Deleted', value: missingCount },
        ];

        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box
              sx={{
                p: { xs: 2.5, sm: 3.5 },
                borderRadius: '20px',
                bgcolor: '#09090b',
                color: '#ffffff',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                boxShadow: '0 22px 48px -20px rgba(9, 9, 11, 0.55)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', md: 'center' },
                flexDirection: { xs: 'column', md: 'row' },
                gap: 2,
              }}
            >
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5, flexWrap: 'wrap' }}>
                  <Typography variant="h4" sx={{ fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
                    AWS EKS Clusters
                  </Typography>
                  <Chip
                    label="Live Boto3 + State Sync"
                    size="small"
                    sx={{
                      bgcolor: 'rgba(37, 99, 235, 0.2)',
                      color: '#93c5fd',
                      border: '1px solid rgba(96, 165, 250, 0.4)',
                      fontWeight: 700,
                    }}
                  />
                </Box>
                <Typography variant="body2" sx={{ color: '#cbd5e1' }}>
                  Provision Amazon EKS clusters, reconcile local cluster state against live AWS control planes, and manage cluster lifecycles.
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={() => refresh()}
                  disabled={loading}
                  sx={{
                    borderColor: 'rgba(96, 165, 250, 0.45)',
                    color: '#ffffff',
                    fontWeight: 700,
                    '&:hover': { borderColor: '#60a5fa', bgcolor: 'rgba(37, 99, 235, 0.14)' },
                  }}
                >
                  Refresh Fleet
                </Button>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => navigate('/create-cluster')}
                  sx={{
                    px: 2.5,
                    py: 1.1,
                    bgcolor: '#2563eb !important',
                    background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%) !important',
                    color: '#ffffff',
                    fontWeight: 700,
                    '&:hover': {
                      background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%) !important',
                    },
                  }}
                >
                  Launch EKS Cluster
                </Button>
              </Box>
            </Box>

            {actionMsg && (
              <Alert
                severity={actionMsg.severity}
                onClose={() => setActionMsg(null)}
                sx={{ borderRadius: 2 }}
              >
                {actionMsg.text}
              </Alert>
            )}

            <Grid container spacing={2.5}>
              <Grid item xs={12} sm={6} lg={3}>
                <Perspective3DCard sx={{ p: 2.5, height: '100%' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
                      Total EKS Clusters
                    </Typography>
                    <StorageIcon sx={{ color: '#2563eb' }} />
                  </Box>
                  <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mb: 0.5 }}>
                    {clusters.length}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#475569' }}>
                    Discovered across AWS &amp; local state
                  </Typography>
                </Perspective3DCard>
              </Grid>

              <Grid item xs={12} sm={6} lg={3}>
                <Perspective3DCard sx={{ p: 2.5, height: '100%' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
                      Active Control Planes
                    </Typography>
                    <CheckCircleIcon sx={{ color: '#16a34a' }} />
                  </Box>
                  <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mb: 0.5 }}>
                    {activeCount}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#475569' }}>
                    Reporting ACTIVE in AWS EKS
                  </Typography>
                </Perspective3DCard>
              </Grid>

              <Grid item xs={12} sm={6} lg={3}>
                <Perspective3DCard sx={{ p: 2.5, height: '100%' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
                      State Synced
                    </Typography>
                    <StorageIcon sx={{ color: '#2563eb' }} />
                  </Box>
                  <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mb: 0.5 }}>
                    {syncedCount}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#475569' }}>
                    Matching local &amp; AWS state snapshots
                  </Typography>
                </Perspective3DCard>
              </Grid>

              <Grid item xs={12} sm={6} lg={3}>
                <Perspective3DCard
                  sx={{
                    p: 2.5,
                    height: '100%',
                    bgcolor: '#09090b',
                    color: '#ffffff',
                    border: '1px solid rgba(59,130,246,0.45)',
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: '#93c5fd' }}>
                      Unsynced / Drift
                    </Typography>
                    <SyncProblemIcon sx={{ color: '#60a5fa' }} />
                  </Box>
                  <Typography variant="h4" sx={{ fontWeight: 800, mb: 0.5 }}>
                    {diffCount + missingCount}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                    Use Sync on any row to reconcile
                  </Typography>
                </Perspective3DCard>
              </Grid>
            </Grid>

            <Grid container spacing={3}>
              <Grid item xs={12} md={5}>
                <Perspective3DCard sx={{ p: 2.5, height: '100%' }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
                    EKS Cluster Health
                  </Typography>
                  <ClusterHealth data={healthData} />
                </Perspective3DCard>
              </Grid>

              <Grid item xs={12} md={7}>
                <Perspective3DCard
                  sx={{
                    p: 2.5,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <StorageIcon sx={{ color: '#2563eb' }} />
                      <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b' }}>
                        AWS EKS Fleet Reconciliation
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: '#475569', mb: 2 }}>
                      {clusters.length === 0
                        ? 'No active EKS clusters discovered yet. Connect an AWS IAM account in Integrations or launch a new EKS cluster.'
                        : `Tracking ${clusters.length} live EKS cluster(s) with 60s automated AWS state reconciliation.`}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip
                      label={`Total: ${clusters.length}`}
                      sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}
                    />
                    <Chip
                      label={`Synced: ${syncedCount}`}
                      sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<CableIcon fontSize="small" />}
                      onClick={() => navigate('/integrations')}
                      sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
                    >
                      Manage AWS IAM Connectors
                    </Button>
                  </Box>
                </Perspective3DCard>
              </Grid>

              <Grid item xs={12}>
                <Perspective3DCard sx={{ p: 2.5 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 1.5,
                      flexWrap: 'wrap',
                      gap: 1,
                    }}
                  >
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b' }}>
                      Kubernetes Clusters
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate('/pipelines')}
                      sx={{ borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 }}
                    >
                      Deploy via CI/CD Pipelines
                    </Button>
                  </Box>
                  <ClusterTable
                    clusters={clusters}
                    onDeleteCluster={(name) => handleDeleteCluster(name, refresh)}
                    onSyncCluster={(name) => handleSyncCluster(name, refresh)}
                    syncingCluster={syncingCluster}
                  />
                </Perspective3DCard>
              </Grid>
            </Grid>
          </Box>
        );
      }}
    </ClusterListManager>
  );
};

export default Clusters;
