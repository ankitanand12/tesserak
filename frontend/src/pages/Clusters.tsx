import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Cable as CableIcon,
  GppGood as GuardrailIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Storage as StorageIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
import ClusterHealth from '../components/ClusterHealth';
import ClusterListManager from '../components/ClusterListManager';
import type { ClusterListHelpers } from '../components/ClusterListManager';
import ClusterTable from '../components/ClusterTable';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { Cluster } from '../types/cluster';

type ClusterFilter = 'all' | 'active' | 'synced' | 'drift' | 'deleted';

const isClusterSynced = (c: Cluster) =>
  c.stateStatus === 'synced' || c.stateStatus === 'in_sync';

export const Clusters: React.FC = () => {
  const navigate = useNavigate();
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';

  const [filter, setFilter] = useState<ClusterFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [actionSeverity, setActionSeverity] = useState<'info' | 'error'>('info');
  const [syncingCluster, setSyncingCluster] = useState<string | null>(null);

  const handleDeleteCluster = async (clusterName: string, refresh: () => Promise<void>) => {
    try {
      const response = await fetch(`http://localhost:8000/clusters/${encodeURIComponent(clusterName)}`, {
        method: 'DELETE',
        headers: {
          'x-user-email': userEmail,
        },
      });
      if (response.ok) {
        setActionSeverity('info');
        setActionMsg(`Deletion initiated for cluster "${clusterName}".`);
        await refresh();
      } else {
        const data = await response.json().catch(() => ({}));
        setActionSeverity('error');
        setActionMsg(data.detail || `Unable to delete cluster "${clusterName}" right now.`);
      }
    } catch {
      setActionSeverity('error');
      setActionMsg(`Failed to reach backend to delete "${clusterName}".`);
    }
  };

  const handleSyncCluster = async (clusterName: string, refresh: () => Promise<void>) => {
    setSyncingCluster(clusterName);
    try {
      const response = await fetch(
        `http://localhost:8000/clusters/${encodeURIComponent(clusterName)}/sync`,
        {
          method: 'POST',
          headers: {
            'x-user-email': userEmail,
          },
        }
      );
      if (response.ok) {
        setActionSeverity('info');
        setActionMsg(`Synchronized local state with live AWS EKS state for "${clusterName}".`);
        await refresh();
      } else {
        const data = await response.json().catch(() => ({}));
        setActionSeverity('error');
        setActionMsg(data.detail || `Failed to synchronize state for "${clusterName}".`);
      }
    } catch {
      setActionSeverity('error');
      setActionMsg(`Unable to reach backend to sync "${clusterName}".`);
    } finally {
      setSyncingCluster(null);
    }
  };

  return (
    <ClusterListManager>
      {(clusters: Cluster[], helpers: ClusterListHelpers) => (
        <ClustersContent
          clusters={clusters}
          helpers={helpers}
          filter={filter}
          setFilter={setFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          actionMsg={actionMsg}
          actionSeverity={actionSeverity}
          clearActionMsg={() => setActionMsg('')}
          syncingCluster={syncingCluster}
          onDeleteCluster={(name) => handleDeleteCluster(name, helpers.refreshClusters)}
          onSyncCluster={(name) => handleSyncCluster(name, helpers.refreshClusters)}
          onNavigate={navigate}
        />
      )}
    </ClusterListManager>
  );
};

interface ClustersContentProps {
  clusters: Cluster[];
  helpers: ClusterListHelpers;
  filter: ClusterFilter;
  setFilter: (f: ClusterFilter) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  actionMsg: string;
  actionSeverity: 'info' | 'error';
  clearActionMsg: () => void;
  syncingCluster: string | null;
  onDeleteCluster: (name: string) => void;
  onSyncCluster: (name: string) => void;
  onNavigate: (path: string) => void;
}

const ClustersContent: React.FC<ClustersContentProps> = ({
  clusters,
  helpers,
  filter,
  setFilter,
  searchQuery,
  setSearchQuery,
  actionMsg,
  actionSeverity,
  clearActionMsg,
  syncingCluster,
  onDeleteCluster,
  onSyncCluster,
  onNavigate,
}) => {
  const syncedCount = useMemo(() => clusters.filter(isClusterSynced).length, [clusters]);
  const diffCount = useMemo(
    () => clusters.filter((c) => c.stateStatus === 'differences_found').length,
    [clusters]
  );
  const missingCount = useMemo(
    () =>
      clusters.filter(
        (c) => c.stateStatus === 'missing_local' || c.stateStatus === 'deleted'
      ).length,
    [clusters]
  );
  const activeCount = useMemo(
    () => clusters.filter((c) => c.status === 'ACTIVE' && !c.deletedAt).length,
    [clusters]
  );
  const deletedCount = useMemo(
    () => clusters.filter((c) => c.stateStatus === 'deleted' || Boolean(c.deletedAt)).length,
    [clusters]
  );

  const filteredClusters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return clusters.filter((c) => {
      if (filter === 'active' && (c.status !== 'ACTIVE' || Boolean(c.deletedAt))) return false;
      if (filter === 'synced' && !isClusterSynced(c)) return false;
      if (
        filter === 'drift' &&
        c.stateStatus !== 'differences_found' &&
        c.stateStatus !== 'missing_local'
      ) {
        return false;
      }
      if (filter === 'deleted' && c.stateStatus !== 'deleted' && !c.deletedAt) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.region.toLowerCase().includes(q) ||
        c.accountId.toLowerCase().includes(q)
      );
    });
  }, [clusters, filter, searchQuery]);

  const healthData = [
    { name: 'Synced', value: syncedCount },
    { name: 'Needs Sync', value: diffCount },
    { name: 'Missing / Deleted', value: missingCount },
  ];

  const filterChips: Array<{ id: ClusterFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: clusters.length },
    { id: 'active', label: 'Active', count: activeCount },
    { id: 'synced', label: 'Synced', count: syncedCount },
    { id: 'drift', label: 'Needs Sync', count: diffCount + clusters.filter((c) => c.stateStatus === 'missing_local').length },
    { id: 'deleted', label: 'Deleted', count: deletedCount },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 0.5 }}>
            <Typography
              variant="h4"
              component="h1"
              sx={{ fontWeight: 800, color: '#09090b', letterSpacing: '-0.02em' }}
            >
              EKS Clusters
            </Typography>
            <Chip
              icon={<StorageIcon sx={{ color: '#60a5fa !important', fontSize: 16 }} />}
              label="AWS EKS Control Plane · 60s Sync"
              size="small"
              sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 600 }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#475569' }}>
            Provision Amazon EKS clusters, reconcile local-to-AWS control plane drift, and inspect live Kubernetes API endpoints.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={helpers.loading ? <CircularProgress size={16} /> : <RefreshIcon />}
            disabled={helpers.loading}
            onClick={() => helpers.refreshClusters()}
            sx={{ borderColor: '#09090b', color: '#09090b' }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => onNavigate('/create-cluster')}
          >
            Launch EKS Cluster
          </Button>
        </Box>
      </Box>

      {helpers.error && (
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          {helpers.error}
        </Alert>
      )}
      {actionMsg && (
        <Alert severity={actionSeverity} onClose={clearActionMsg} sx={{ borderRadius: 2 }}>
          {actionMsg}
        </Alert>
      )}

      <Grid container spacing={2.5}>
        <Grid item xs={12} sm={6} lg={3}>
          <Perspective3DCard
            sx={{
              p: 2.5,
              bgcolor: '#09090b',
              color: '#ffffff',
              border: '1px solid rgba(59, 130, 246, 0.45)',
            }}
          >
            <Typography variant="caption" sx={{ color: '#93c5fd', fontWeight: 700 }}>
              TRACKED EKS CLUSTERS
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, mt: 0.5 }}>
              {clusters.length}
            </Typography>
            <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
              {activeCount} active in AWS EKS
            </Typography>
          </Perspective3DCard>
        </Grid>

        <Grid item xs={12} sm={6} lg={3}>
          <Perspective3DCard sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              SYNCED WITH AWS
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mt: 0.5 }}>
              {syncedCount}
            </Typography>
            <Typography variant="caption" sx={{ color: '#2563eb', fontWeight: 600 }}>
              Version, status &amp; endpoint match
            </Typography>
          </Perspective3DCard>
        </Grid>

        <Grid item xs={12} sm={6} lg={3}>
          <Perspective3DCard sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              DRIFT / UNSYNCED
            </Typography>
            <Typography
              variant="h4"
              sx={{ fontWeight: 800, color: diffCount > 0 ? '#d97706' : '#09090b', mt: 0.5 }}
            >
              {diffCount + clusters.filter((c) => c.stateStatus === 'missing_local').length}
            </Typography>
            <Typography variant="caption" sx={{ color: '#475569' }}>
              {diffCount} state diff · {clusters.filter((c) => c.stateStatus === 'missing_local').length} AWS-only
            </Typography>
          </Perspective3DCard>
        </Grid>

        <Grid item xs={12} sm={6} lg={3}>
          <Perspective3DCard sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              MISSING / DELETED
            </Typography>
            <Typography
              variant="h4"
              sx={{ fontWeight: 800, color: deletedCount > 0 ? '#dc2626' : '#09090b', mt: 0.5 }}
            >
              {deletedCount}
            </Typography>
            <Typography variant="caption" sx={{ color: '#475569' }}>
              Retained 7 days for audit history
            </Typography>
          </Perspective3DCard>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Perspective3DCard sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
              EKS State Health
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
              gap: 2,
            }}
          >
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <SyncIcon sx={{ color: '#2563eb' }} />
                <Typography variant="h6" component="h2" sx={{ fontWeight: 700, color: '#09090b' }}>
                  Local-to-AWS State Reconciliation
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ color: '#475569' }}>
                {clusters.length === 0
                  ? 'No active EKS clusters found yet. Connect an AWS IAM account in Integrations or launch a new EKS cluster to start live state tracking.'
                  : `Comparing ${clusters.length} tracked cluster(s) against AWS EKS describe_cluster every 60 seconds. Use Sync on any row to pull live AWS configuration into local state.`}
              </Typography>
              {helpers.lastUpdated && (
                <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 1 }}>
                  Last polled: {helpers.lastUpdated.toLocaleTimeString()}
                </Typography>
              )}
            </Box>

            <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CableIcon />}
                onClick={() => onNavigate('/integrations')}
                sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
              >
                AWS IAM Connectors
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<GuardrailIcon />}
                onClick={() => onNavigate('/guardrails')}
                sx={{ borderColor: 'rgba(15,23,42,0.22)', color: '#09090b', fontWeight: 700 }}
              >
                EKS Guardrail Audit
              </Button>
            </Box>
          </Perspective3DCard>
        </Grid>
      </Grid>

      <Perspective3DCard sx={{ overflow: 'hidden' }}>
        <Box
          sx={{
            px: 3,
            py: 2,
            bgcolor: '#09090b',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: { xs: 'flex-start', md: 'center' },
            flexDirection: { xs: 'column', md: 'row' },
            gap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <StorageIcon sx={{ color: '#60a5fa', fontSize: 20 }} />
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
              Kubernetes Clusters Inventory
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', width: { xs: '100%', md: 'auto' } }}>
            <TextField
              size="small"
              placeholder="Search name, region, account..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              inputProps={{ 'aria-label': 'Filter clusters by name, region, or account ID' }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#94a3b8', fontSize: 18 }} />
                  </InputAdornment>
                ),
              }}
              sx={{
                minWidth: { xs: '100%', sm: 240 },
                bgcolor: '#18181b',
                borderRadius: 1.5,
                '& .MuiOutlinedInput-root': {
                  color: '#ffffff',
                  fontSize: '0.84rem',
                  '& fieldset': { borderColor: 'rgba(96, 165, 250, 0.35)' },
                  '&:hover fieldset': { borderColor: '#60a5fa' },
                },
              }}
            />
          </Box>
        </Box>

        <Box
          sx={{
            px: 3,
            py: 1.5,
            borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            bgcolor: '#ffffff',
          }}
        >
          {filterChips.map((fc) => {
            const active = filter === fc.id;
            return (
              <Chip
                key={fc.id}
                label={`${fc.label} (${fc.count})`}
                clickable
                size="small"
                onClick={() => setFilter(fc.id)}
                sx={{
                  fontWeight: 700,
                  bgcolor: active ? '#09090b' : '#f1f5f9',
                  color: active ? '#ffffff' : '#334155',
                  border: active ? '1px solid #2563eb' : '1px solid transparent',
                }}
              />
            );
          })}
        </Box>

        <ClusterTable
          clusters={filteredClusters}
          onDeleteCluster={onDeleteCluster}
          onSyncCluster={onSyncCluster}
          syncingCluster={syncingCluster}
          emptyMessage={
            clusters.length === 0
              ? 'No EKS clusters found yet. Connect an AWS IAM account in Integrations or launch a new EKS cluster.'
              : 'No clusters match the current search or status filter.'
          }
        />
      </Perspective3DCard>
    </Box>
  );
};

export default Clusters;
