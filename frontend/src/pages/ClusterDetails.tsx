import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  CheckCircle as CheckCircleIcon,
  ContentCopy as CopyIcon,
  DeleteOutline as DeleteIcon,
  Extension as AddonIcon,
  History as HistoryIcon,
  Hub as NetworkIcon,
  Label as TagIcon,
  Memory as ComputeIcon,
  OpenInNew as OpenInNewIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Security as SecurityIcon,
  Storage as StorageIcon,
  Sync as SyncIcon,
  Tune as TuneIcon,
  Visibility as ObservabilityIcon,
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
import {
  ClusterPod,
  ClusterWorkerNode,
  NodeDetailsDialog,
  formatClusterDateTime,
  getPodStatusChipColor,
} from '../components/Clusters/NodeDetailsDialog';
import { EKS_AMI_TYPES } from '../components/CreateCluster/ClusterEnvironment';
import { InstanceTypeSelect } from '../components/CreateCluster/InstanceTypeSelect';
import { NumericCountField } from '../components/CreateCluster/NumericCountField';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { fetchWithSwr, invalidateSwrCache, readSwrCache } from '../utils/swrCache';

interface ClusterDetailResponse {
  name: string;
  accountId: string;
  region: string;
  status: string;
  stateStatus: string;
  awsMissing?: boolean;
  cluster: {
    name: string;
    arn?: string;
    createdAt?: string;
    version?: string;
    platformVersion?: string;
    endpoint?: string;
    roleArn?: string;
    status?: string;
    certificateAuthority?: string;
    oidcIssuer?: string;
    logging?: Array<{ types?: string[]; enabled?: boolean }>;
    encryptionConfig?: Array<{ resources?: string[]; provider?: { keyArn?: string } }>;
    accessConfig?: { authenticationMode?: string; bootstrapClusterCreatorAdminPermissions?: boolean };
    upgradePolicy?: { supportType?: string };
    health?: { issues?: Array<{ code?: string; message?: string; resourceIds?: string[] }> };
  } | null;
  networking: {
    vpc?: { vpcId?: string; name?: string; cidrBlock?: string; isDefault?: boolean };
    subnets?: Array<{
      subnetId: string;
      name?: string;
      cidrBlock?: string;
      availabilityZone?: string;
      mapPublicIpOnLaunch?: boolean;
      availableIpAddressCount?: number;
    }>;
    securityGroups?: Array<{
      groupId: string;
      groupName?: string;
      description?: string;
      isClusterSecurityGroup?: boolean;
    }>;
    clusterSecurityGroupId?: string;
    endpointPublicAccess?: boolean;
    endpointPrivateAccess?: boolean;
    publicAccessCidrs?: string[];
    kubernetesNetworkConfig?: { serviceIpv4Cidr?: string; ipFamily?: string };
  };
  nodegroups: Array<{
    nodegroupName: string;
    status?: string;
    instanceTypes?: string[];
    amiType?: string;
    capacityType?: string;
    diskSize?: number;
    version?: string;
    releaseVersion?: string;
    scalingConfig?: { minSize?: number; desiredSize?: number; maxSize?: number };
    subnets?: string[];
  }>;
  workerNodes?: ClusterWorkerNode[];
  pods?: ClusterPod[];
  k8sRuntimeWarning?: string | null;
  fargateProfiles: Array<{
    fargateProfileName: string;
    status?: string;
    podExecutionRoleArn?: string;
    selectors?: Array<{ namespace?: string }>;
  }>;
  addons: Array<{
    addonName: string;
    addonVersion?: string;
    status?: string;
    serviceAccountRoleArn?: string;
    health?: { issues?: Array<{ code?: string; message?: string }> };
  }>;
  updateHistory: Array<{
    id: string;
    type?: string;
    status?: string;
    createdAt?: string;
    params?: Array<{ type?: string; value?: string }>;
    errors?: Array<{ errorCode?: string; errorMessage?: string }>;
  }>;
  localState: {
    lastUpdated?: string | null;
    history?: Array<{ timestamp?: string; type?: string; details?: any }>;
    desiredState?: any;
    differences?: string[];
  };
  tags: Record<string, string>;
}

const KeyValRow: React.FC<{ label: string; value?: React.ReactNode; copyValue?: string }> = ({
  label,
  value,
  copyValue,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!copyValue || !navigator.clipboard) return;
    navigator.clipboard.writeText(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box
      sx={{
        py: 1.2,
        borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'space-between',
        gap: 1,
        alignItems: { xs: 'flex-start', sm: 'center' },
      }}
    >
      <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 600, minWidth: 190 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, maxWidth: '100%' }}>
        <Typography
          variant="body2"
          sx={{
            color: '#09090b',
            fontWeight: 600,
            wordBreak: 'break-all',
            fontFamily: copyValue ? 'monospace' : 'inherit',
            fontSize: copyValue ? '0.8rem' : '0.875rem',
          }}
        >
          {value || '—'}
        </Typography>
        {copyValue && (
          <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
            <IconButton size="small" onClick={handleCopy} sx={{ color: '#2563eb' }}>
              {copied ? <CheckCircleIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
};

export const ClusterDetails: React.FC = () => {
  const { clusterName = '' } = useParams();
  const decodedName = decodeURIComponent(clusterName);
  const navigate = useNavigate();
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';
  const cacheKey = `cluster:${decodedName}`;

  const cached = readSwrCache<ClusterDetailResponse>(userEmail, cacheKey);
  const [detail, setDetail] = useState<ClusterDetailResponse | null>(() => cached ?? null);
  const [loading, setLoading] = useState<boolean>(() => !cached);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState(0);

  // Node Group create / scale / delete state
  const [ngDialogOpen, setNgDialogOpen] = useState(false);
  const [ngName, setNgName] = useState('');
  const [ngAmiType, setNgAmiType] = useState('amazon-linux-2023/x86_64/standard');
  const [ngAmiId, setNgAmiId] = useState('');
  const [ngAmiManual, setNgAmiManual] = useState(false);
  const [ngLoadingAmi, setNgLoadingAmi] = useState(false);
  const [ngInstanceType, setNgInstanceType] = useState('t3.medium');
  const [ngCapacityType, setNgCapacityType] = useState<'ON_DEMAND' | 'SPOT'>('ON_DEMAND');
  const [ngMinSize, setNgMinSize] = useState(1);
  const [ngDesiredSize, setNgDesiredSize] = useState(2);
  const [ngMaxSize, setNgMaxSize] = useState(4);
  const [ngDiskSize, setNgDiskSize] = useState(20);
  const [ngSubnets, setNgSubnets] = useState<string[]>([]);
  const [ngSubmitting, setNgSubmitting] = useState(false);
  const [ngDialogError, setNgDialogError] = useState('');

  const [scaleTarget, setScaleTarget] = useState<{
    nodegroupName: string;
    minSize: number;
    desiredSize: number;
    maxSize: number;
  } | null>(null);
  const [scaleSubmitting, setScaleSubmitting] = useState(false);

  const [deleteNgTarget, setDeleteNgTarget] = useState<string | null>(null);
  const [deleteNgSubmitting, setDeleteNgSubmitting] = useState(false);
  const [selectedNode, setSelectedNode] = useState<ClusterWorkerNode | null>(null);
  const [podSearch, setPodSearch] = useState('');

  const loadDetails = useCallback(
    async (force: boolean = false) => {
      if (!decodedName) return;
      const existing = readSwrCache<ClusterDetailResponse>(userEmail, cacheKey);
      if (existing) {
        setDetail(existing);
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError('');

      try {
        const res = await fetchWithSwr(
          userEmail,
          cacheKey,
          async () => {
            const response = await fetch(
              `http://localhost:8000/clusters/${encodeURIComponent(decodedName)}`,
              {
                headers: { 'x-user-email': userEmail },
              }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(data.detail || `Failed to load cluster "${decodedName}"`);
            }
            return data as ClusterDetailResponse;
          },
          { force, dedupeWindowMs: 5000 }
        );
        setDetail(res);
      } catch (err: any) {
        if (!existing) {
          setError(err?.message || 'Unable to load AWS cluster details');
        }
      } finally {
        setLoading(false);
      }
    },
    [decodedName, userEmail, cacheKey]
  );

  useEffect(() => {
    loadDetails(false);
  }, [loadDetails]);

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `http://localhost:8000/clusters/${encodeURIComponent(decodedName)}/sync`,
        {
          method: 'POST',
          headers: { 'x-user-email': userEmail },
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Sync failed');
      }
      setNotice(`Synchronized "${decodedName}" with live AWS EKS state.`);
      invalidateSwrCache(userEmail, 'clusters');
      invalidateSwrCache(userEmail, cacheKey);
      invalidateSwrCache(userEmail, 'overview');
      await loadDetails(true);
    } catch (err: any) {
      setError(err?.message || 'Unable to sync cluster state');
    } finally {
      setSyncing(false);
    }
  };

  const fetchNodegroupAmi = async (amiTypeVal: string, forceOverwrite: boolean = false) => {
    if (!detail?.accountId || !detail?.region) return;
    setNgLoadingAmi(true);
    try {
      const params = new URLSearchParams({ ami_type: amiTypeVal });
      if (detail.cluster?.version) {
        params.set('kubernetes_version', detail.cluster.version);
      }
      const res = await fetch(
        `http://localhost:8000/api/aws/eks-ami/${detail.accountId}/${detail.region}?${params.toString()}`,
        { headers: { 'x-user-email': userEmail } }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.amiId && (forceOverwrite || !ngAmiManual)) {
        setNgAmiId(data.amiId);
        setNgAmiManual(false);
      }
    } catch {
      // Optional preview helper; EKS defaults safely via amiType enum
    } finally {
      setNgLoadingAmi(false);
    }
  };

  const openAddNodegroupDialog = () => {
    const defaultType = 'amazon-linux-2023/x86_64/standard';
    setNgName(`${decodedName}-ng`);
    setNgAmiType(defaultType);
    setNgAmiManual(false);
    setNgInstanceType('t3.medium');
    setNgCapacityType('ON_DEMAND');
    setNgMinSize(1);
    setNgDesiredSize(2);
    setNgMaxSize(4);
    setNgDiskSize(20);
    setNgSubnets((detail?.networking.subnets || []).map((s) => s.subnetId));
    setNgDialogError('');
    setNgDialogOpen(true);
    fetchNodegroupAmi(defaultType, true);
  };

  const handleCreateNodegroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setNgDialogError('');
    setNgSubmitting(true);
    try {
      const res = await fetch(
        `http://localhost:8000/clusters/${encodeURIComponent(decodedName)}/nodegroups`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-email': userEmail,
          },
          body: JSON.stringify({
            nodegroupName: ngName.trim(),
            amiType: ngAmiType,
            amiId: ngAmiId.trim() || undefined,
            amiManual: ngAmiManual,
            instanceTypes: [ngInstanceType.trim() || 't3.medium'],
            capacityType: ngCapacityType,
            minSize: Number(ngMinSize),
            desiredSize: Number(ngDesiredSize),
            maxSize: Number(ngMaxSize),
            diskSize: Number(ngDiskSize),
            subnets: ngSubnets,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create node group');
      }
      setNgDialogOpen(false);
      setNotice(`Node group "${ngName.trim()}" creation initiated on AWS EKS.`);
      invalidateSwrCache(userEmail, cacheKey);
      invalidateSwrCache(userEmail, 'clusters');
      await loadDetails(true);
    } catch (err: any) {
      setNgDialogError(err?.message || 'Unable to create node group');
    } finally {
      setNgSubmitting(false);
    }
  };

  const handleScaleNodegroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scaleTarget) return;
    setScaleSubmitting(true);
    setError('');
    try {
      const res = await fetch(
        `http://localhost:8000/clusters/${encodeURIComponent(decodedName)}/nodegroups/${encodeURIComponent(scaleTarget.nodegroupName)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-user-email': userEmail,
          },
          body: JSON.stringify({
            minSize: Number(scaleTarget.minSize),
            desiredSize: Number(scaleTarget.desiredSize),
            maxSize: Number(scaleTarget.maxSize),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to update node group scaling');
      }
      setNotice(`Scaling update started for node group "${scaleTarget.nodegroupName}".`);
      setScaleTarget(null);
      invalidateSwrCache(userEmail, cacheKey);
      await loadDetails(true);
    } catch (err: any) {
      setError(err?.message || 'Unable to scale node group');
    } finally {
      setScaleSubmitting(false);
    }
  };

  const handleDeleteNodegroup = async () => {
    if (!deleteNgTarget) return;
    setDeleteNgSubmitting(true);
    setError('');
    try {
      const res = await fetch(
        `http://localhost:8000/clusters/${encodeURIComponent(decodedName)}/nodegroups/${encodeURIComponent(deleteNgTarget)}`,
        {
          method: 'DELETE',
          headers: { 'x-user-email': userEmail },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to delete node group');
      }
      setNotice(`Node group "${deleteNgTarget}" deletion initiated.`);
      setDeleteNgTarget(null);
      invalidateSwrCache(userEmail, cacheKey);
      await loadDetails(true);
    } catch (err: any) {
      setError(err?.message || 'Unable to delete node group');
    } finally {
      setDeleteNgSubmitting(false);
    }
  };

  if (loading && !detail) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 10, gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Fetching live AWS EKS control plane, VPC networking, add-ons, and update history...
        </Typography>
      </Box>
    );
  }

  const c = detail?.cluster;
  const tagEntries = Object.entries(detail?.tags || {});
  const loggingEntries = c?.logging || [];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        '@keyframes panelReveal': {
          from: { opacity: 0, transform: 'translate3d(0, 12px, 0)' },
          to: { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        },
        animation: 'panelReveal 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* Top Breadcrumb + Action Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', md: 'center' },
          flexDirection: { xs: 'column', md: 'row' },
          gap: 2,
        }}
      >
        <Box>
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/clusters')}
            sx={{ color: '#475569', mb: 1, px: 0 }}
          >
            Back to EKS Clusters
          </Button>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <StorageIcon sx={{ color: '#2563eb', fontSize: 30 }} />
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', letterSpacing: '-0.02em' }}>
              {decodedName}
            </Typography>
            <Chip
              label={detail?.status || 'UNKNOWN'}
              size="small"
              sx={{
                bgcolor:
                  detail?.status === 'ACTIVE'
                    ? '#dcfce7'
                    : detail?.status === 'CREATING'
                    ? '#fef3c7'
                    : '#fee2e2',
                color:
                  detail?.status === 'ACTIVE'
                    ? '#16a34a'
                    : detail?.status === 'CREATING'
                    ? '#d97706'
                    : '#dc2626',
                fontWeight: 700,
              }}
            />
            <Chip
              label={
                detail?.stateStatus === 'synced'
                  ? 'State Synced'
                  : detail?.stateStatus === 'missing_local'
                  ? 'AWS Only'
                  : detail?.stateStatus || 'Unknown'
              }
              size="small"
              sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#475569', mt: 0.5 }}>
            AWS Account {detail?.accountId} · Region {detail?.region} · Kubernetes{' '}
            {c?.version || '—'} ({c?.platformVersion || 'EKS'})
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => loadDetails(true)}
            sx={{ borderColor: '#09090b', color: '#09090b' }}
          >
            Refresh
          </Button>
          {!detail?.awsMissing && (
            <Button
              variant="contained"
              startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              disabled={syncing}
              onClick={handleSync}
            >
              {syncing ? 'Syncing...' : 'Sync AWS State'}
            </Button>
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {/* Top 3D Summary Cards */}
      <Grid container spacing={2.25}>
        <Grid item xs={12} sm={6} md={3}>
          <Perspective3DCard
            sx={{
              p: 2.25,
              bgcolor: '#09090b',
              color: '#ffffff',
              border: '1px solid rgba(59, 130, 246, 0.45)',
            }}
          >
            <Typography variant="caption" sx={{ color: '#93c5fd', fontWeight: 700 }}>
              KUBERNETES VERSION
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, mt: 0.5 }}>
              {c?.version || '—'}
            </Typography>
            <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
              Platform {c?.platformVersion || '—'} ·{' '}
              {c?.upgradePolicy?.supportType || 'STANDARD'}
            </Typography>
          </Perspective3DCard>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Perspective3DCard sx={{ p: 2.25 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              ENDPOINT ACCESS
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: '#09090b', mt: 0.75 }}>
              {detail?.networking.endpointPublicAccess && detail?.networking.endpointPrivateAccess
                ? 'Public + Private'
                : detail?.networking.endpointPublicAccess
                ? 'Public Only'
                : 'Private Only'}
            </Typography>
            <Typography variant="caption" sx={{ color: '#2563eb', fontWeight: 600 }}>
              {detail?.networking.subnets?.length || 0} subnets · {detail?.networking.vpc?.vpcId || '—'}
            </Typography>
          </Perspective3DCard>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Perspective3DCard sx={{ p: 2.25 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              COMPUTE &amp; ADD-ONS
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mt: 0.5 }}>
              {detail?.nodegroups.length || 0} / {detail?.addons.length || 0}
            </Typography>
            <Typography variant="caption" sx={{ color: '#475569' }}>
              Node groups · Installed EKS add-ons
            </Typography>
          </Perspective3DCard>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Perspective3DCard sx={{ p: 2.25 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              UPDATES &amp; TAGS
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mt: 0.5 }}>
              {detail?.updateHistory.length || 0} / {tagEntries.length}
            </Typography>
            <Typography variant="caption" sx={{ color: '#475569' }}>
              AWS control plane updates · Tags
            </Typography>
          </Perspective3DCard>
        </Grid>
      </Grid>

      {/* AWS EKS Console Tabs */}
      <Perspective3DCard sx={{ overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            px: 2,
            bgcolor: '#f8fafc',
            borderBottom: '1px solid rgba(15, 23, 42, 0.1)',
          }}
        >
          <Tab icon={<StorageIcon fontSize="small" />} iconPosition="start" label="Overview & Config" />
          <Tab
            icon={<ComputeIcon fontSize="small" />}
            iconPosition="start"
            label={`Compute & Add-ons (${(detail?.nodegroups.length || 0) + (detail?.addons.length || 0)})`}
          />
          <Tab icon={<NetworkIcon fontSize="small" />} iconPosition="start" label="Networking" />
          <Tab icon={<ObservabilityIcon fontSize="small" />} iconPosition="start" label="Observability & Access" />
          <Tab
            icon={<HistoryIcon fontSize="small" />}
            iconPosition="start"
            label={`Update & State History (${(detail?.updateHistory.length || 0) + (detail?.localState.history?.length || 0)})`}
          />
          <Tab icon={<TagIcon fontSize="small" />} iconPosition="start" label={`Tags (${tagEntries.length})`} />
        </Tabs>

        <Box sx={{ p: 3 }}>
          {/* Tab 0: Overview & Configuration */}
          {tab === 0 && (
            <Grid container spacing={3}>
              <Grid item xs={12} md={7}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  Control Plane Configuration
                </Typography>
                <KeyValRow label="Cluster ARN" value={c?.arn} copyValue={c?.arn} />
                <KeyValRow label="API Server Endpoint" value={c?.endpoint} copyValue={c?.endpoint} />
                <KeyValRow label="Cluster IAM Role ARN" value={c?.roleArn} copyValue={c?.roleArn} />
                <KeyValRow
                  label="Kubernetes Version"
                  value={c?.version ? `${c.version} (${c.platformVersion || 'eks'})` : '—'}
                />
                <KeyValRow
                  label="Created At"
                  value={c?.createdAt ? new Date(c.createdAt).toLocaleString() : '—'}
                />
                <KeyValRow
                  label="Upgrade Support Policy"
                  value={c?.upgradePolicy?.supportType || 'STANDARD'}
                />
              </Grid>

              <Grid item xs={12} md={5}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  Cluster Health &amp; Reconciliation
                </Typography>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
                  <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                    AWS EKS HEALTH ISSUES
                  </Typography>
                  {c?.health?.issues && c.health.issues.length > 0 ? (
                    c.health.issues.map((iss, idx) => (
                      <Alert key={idx} severity="warning" sx={{ mt: 1 }}>
                        <strong>{iss.code}:</strong> {iss.message}
                      </Alert>
                    ))
                  ) : (
                    <Typography variant="body2" sx={{ color: '#16a34a', fontWeight: 600, mt: 0.75 }}>
                      No active health issues reported by AWS EKS.
                    </Typography>
                  )}
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                    LOCAL STATE COMPARISON
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 600 }}>
                    Last Synced:{' '}
                    {detail?.localState.lastUpdated
                      ? new Date(detail.localState.lastUpdated).toLocaleString()
                      : 'Never synced locally'}
                  </Typography>
                  {detail?.localState.differences && detail.localState.differences.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
                      {detail.localState.differences.map((d) => (
                        <Chip key={d} label={d} size="small" color="warning" />
                      ))}
                    </Box>
                  )}
                </Paper>
              </Grid>
            </Grid>
          )}

          {/* Tab 1: Compute & Add-ons */}
          {tab === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b' }}>
                    Managed Node Groups ({detail?.nodegroups.length || 0})
                  </Typography>
                  {!detail?.awsMissing && (
                    <Tooltip
                      title={
                        detail?.status !== 'ACTIVE'
                          ? 'Wait until cluster status is ACTIVE to create a node group'
                          : 'Launch a managed EKS node group with EC2 worker nodes'
                      }
                    >
                      <span>
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<AddIcon />}
                          disabled={detail?.status !== 'ACTIVE'}
                          onClick={openAddNodegroupDialog}
                        >
                          Add Node Group
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </Box>
                {detail?.nodegroups && detail.nodegroups.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Name</strong></TableCell>
                          <TableCell><strong>Status</strong></TableCell>
                          <TableCell><strong>Instance Types</strong></TableCell>
                          <TableCell><strong>Scaling (Min / Desired / Max)</strong></TableCell>
                          <TableCell><strong>AMI Type / Disk</strong></TableCell>
                          <TableCell><strong>Capacity</strong></TableCell>
                          <TableCell align="right"><strong>Actions</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detail.nodegroups.map((ng) => (
                          <TableRow key={ng.nodegroupName}>
                            <TableCell sx={{ fontWeight: 700 }}>{ng.nodegroupName}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={ng.status || 'UNKNOWN'}
                                color={ng.status === 'ACTIVE' ? 'success' : 'default'}
                              />
                            </TableCell>
                            <TableCell>{ng.instanceTypes?.join(', ') || '—'}</TableCell>
                            <TableCell>
                              {ng.scalingConfig
                                ? `${ng.scalingConfig.minSize ?? 0} / ${ng.scalingConfig.desiredSize ?? 0} / ${ng.scalingConfig.maxSize ?? 0}`
                                : '—'}
                            </TableCell>
                            <TableCell>
                              {ng.amiType || '—'} · {ng.diskSize ? `${ng.diskSize} GB` : 'default'}
                            </TableCell>
                            <TableCell>{ng.capacityType || 'ON_DEMAND'}</TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                              <Box sx={{ display: 'inline-flex', gap: 1 }}>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<TuneIcon fontSize="small" />}
                                  onClick={() =>
                                    setScaleTarget({
                                      nodegroupName: ng.nodegroupName,
                                      minSize: ng.scalingConfig?.minSize ?? 1,
                                      desiredSize: ng.scalingConfig?.desiredSize ?? 2,
                                      maxSize: ng.scalingConfig?.maxSize ?? 4,
                                    })
                                  }
                                >
                                  Scale
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                  startIcon={<DeleteIcon fontSize="small" />}
                                  onClick={() => setDeleteNgTarget(ng.nodegroupName)}
                                >
                                  Delete
                                </Button>
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">
                    No managed node groups attached yet. Click <strong>Add Node Group</strong> to provision EC2 worker nodes for pods, add-ons, and CI/CD workloads.
                  </Alert>
                )}
              </Box>

              <Divider />

              <Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                    mb: 1.5,
                  }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b' }}>
                    Nodes ({detail?.workerNodes?.length || 0})
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>
                    Click any node name to inspect system info, capacity allocation, pods, conditions &amp; raw JSON
                  </Typography>
                </Box>
                {detail?.k8sRuntimeWarning && (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>
                    Live Kubernetes API inspection notice: {detail.k8sRuntimeWarning}
                  </Alert>
                )}
                {detail?.workerNodes && detail.workerNodes.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Node name</strong></TableCell>
                          <TableCell><strong>Instance type</strong></TableCell>
                          <TableCell><strong>Capacity type</strong></TableCell>
                          <TableCell><strong>Node group</strong></TableCell>
                          <TableCell><strong>Created</strong></TableCell>
                          <TableCell><strong>Status</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detail.workerNodes.map((n) => {
                          const nodeLabel = n.nodeName || n.name || n.instanceId;
                          const nodeStatus = n.k8sStatus || n.state || 'unknown';
                          return (
                            <TableRow
                              key={n.instanceId}
                              hover
                              onClick={() => setSelectedNode(n)}
                              sx={{ cursor: 'pointer' }}
                            >
                              <TableCell>
                                <Button
                                  size="small"
                                  variant="text"
                                  endIcon={<OpenInNewIcon sx={{ fontSize: '14px !important' }} />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedNode(n);
                                  }}
                                  sx={{
                                    p: 0,
                                    minWidth: 0,
                                    textTransform: 'none',
                                    fontFamily: 'monospace',
                                    fontWeight: 700,
                                    color: '#2563eb',
                                    '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' },
                                  }}
                                >
                                  {nodeLabel}
                                </Button>
                              </TableCell>
                              <TableCell>{n.instanceType || '—'}</TableCell>
                              <TableCell>{n.capacityType || 'ON_DEMAND'}</TableCell>
                              <TableCell>{n.nodegroupName || '—'}</TableCell>
                              <TableCell>
                                {formatClusterDateTime(n.createdAt || n.launchTime)}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  label={nodeStatus}
                                  color={getPodStatusChipColor(nodeStatus)}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No running EC2 worker nodes discovered for this cluster yet.</Alert>
                )}
              </Box>

              <Divider />

              <Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1.5,
                    mb: 1.5,
                  }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b' }}>
                    Cluster Pods ({detail?.pods?.length || 0})
                  </Typography>
                  <TextField
                    size="small"
                    placeholder="Filter pods by name, namespace, status, IP..."
                    value={podSearch}
                    onChange={(e) => setPodSearch(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" color="action" />
                        </InputAdornment>
                      ),
                    }}
                    sx={{ minWidth: { xs: '100%', sm: 290 } }}
                  />
                </Box>
                {(() => {
                  const podsList = detail?.pods || [];
                  const q = podSearch.trim().toLowerCase();
                  const filteredPods = q
                    ? podsList.filter(
                        (p) =>
                          p.name.toLowerCase().includes(q) ||
                          p.namespace.toLowerCase().includes(q) ||
                          p.status.toLowerCase().includes(q) ||
                          (p.podIp || '').toLowerCase().includes(q) ||
                          (p.nodeName || '').toLowerCase().includes(q)
                      )
                    : podsList;

                  if (filteredPods.length === 0) {
                    return (
                      <Alert severity="info">
                        {podsList.length > 0
                          ? `No pods match "${podSearch}".`
                          : 'No Kubernetes pods discovered yet for this cluster.'}
                      </Alert>
                    );
                  }

                  return (
                    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow sx={{ bgcolor: '#f8fafc' }}>
                            <TableCell><strong>Pod Name</strong></TableCell>
                            <TableCell><strong>Namespace</strong></TableCell>
                            <TableCell><strong>Status</strong></TableCell>
                            <TableCell><strong>Restarts</strong></TableCell>
                            <TableCell><strong>Created Date</strong></TableCell>
                            <TableCell><strong>Pod IP</strong></TableCell>
                            <TableCell><strong>Node</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {filteredPods.map((pod) => {
                            const matchedNode = (detail?.workerNodes || []).find(
                              (n) =>
                                pod.nodeName &&
                                (n.nodeName === pod.nodeName ||
                                  n.name === pod.nodeName ||
                                  n.privateDnsName === pod.nodeName)
                            );
                            return (
                              <TableRow key={`${pod.namespace}/${pod.name}`} hover>
                                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                                  {pod.name}{' '}
                                  {pod.ready && (
                                    <Typography
                                      component="span"
                                      variant="caption"
                                      sx={{ color: '#64748b', fontWeight: 600, ml: 0.5 }}
                                    >
                                      ({pod.ready})
                                    </Typography>
                                  )}
                                </TableCell>
                                <TableCell>{pod.namespace}</TableCell>
                                <TableCell>
                                  <Chip
                                    size="small"
                                    label={pod.status}
                                    color={getPodStatusChipColor(pod.status)}
                                  />
                                </TableCell>
                                <TableCell>{pod.restarts ?? 0}</TableCell>
                                <TableCell>{formatClusterDateTime(pod.createdAt)}</TableCell>
                                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>
                                  {pod.podIp || '—'}
                                </TableCell>
                                <TableCell>
                                  {matchedNode ? (
                                    <Button
                                      size="small"
                                      variant="text"
                                      onClick={() => setSelectedNode(matchedNode)}
                                      sx={{
                                        p: 0,
                                        minWidth: 0,
                                        textTransform: 'none',
                                        fontFamily: 'monospace',
                                        fontSize: '0.8rem',
                                        color: '#2563eb',
                                      }}
                                    >
                                      {pod.nodeName}
                                    </Button>
                                  ) : (
                                    <Typography
                                      variant="caption"
                                      sx={{ fontFamily: 'monospace', color: '#475569' }}
                                    >
                                      {pod.nodeName || '—'}
                                    </Typography>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  );
                })()}
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  Installed AWS EKS Add-ons ({detail?.addons.length || 0})
                </Typography>
                {detail?.addons && detail.addons.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Add-on</strong></TableCell>
                          <TableCell><strong>Version</strong></TableCell>
                          <TableCell><strong>Status</strong></TableCell>
                          <TableCell><strong>Health Issues</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detail.addons.map((ad) => (
                          <TableRow key={ad.addonName}>
                            <TableCell sx={{ fontWeight: 700 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <AddonIcon fontSize="small" color="primary" />
                                {ad.addonName}
                              </Box>
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{ad.addonVersion || '—'}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={ad.status || 'UNKNOWN'}
                                color={ad.status === 'ACTIVE' ? 'success' : 'warning'}
                              />
                            </TableCell>
                            <TableCell>
                              {ad.health?.issues && ad.health.issues.length > 0
                                ? ad.health.issues.map((i) => i.message || i.code).join('; ')
                                : 'Healthy'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">
                    No AWS EKS add-ons currently installed (if cluster is CREATING, queued add-ons install once ACTIVE).
                  </Alert>
                )}
              </Box>
            </Box>
          )}

          {/* Tab 2: Networking */}
          {tab === 2 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1, color: '#09090b' }}>
                    VPC &amp; Endpoint Settings
                  </Typography>
                  <KeyValRow
                    label="VPC"
                    value={
                      detail?.networking.vpc?.vpcId
                        ? `${detail.networking.vpc.name || detail.networking.vpc.vpcId} (${detail.networking.vpc.vpcId})`
                        : '—'
                    }
                    copyValue={detail?.networking.vpc?.vpcId}
                  />
                  <KeyValRow label="VPC IPv4 CIDR" value={detail?.networking.vpc?.cidrBlock} />
                  <KeyValRow
                    label="Service IPv4 CIDR"
                    value={`${detail?.networking.kubernetesNetworkConfig?.serviceIpv4Cidr || '—'} (${detail?.networking.kubernetesNetworkConfig?.ipFamily || 'ipv4'})`}
                  />
                  <KeyValRow
                    label="Public Access"
                    value={detail?.networking.endpointPublicAccess ? 'Enabled' : 'Disabled'}
                  />
                  <KeyValRow
                    label="Private Access"
                    value={detail?.networking.endpointPrivateAccess ? 'Enabled' : 'Disabled'}
                  />
                  <KeyValRow
                    label="Public Access CIDRs"
                    value={detail?.networking.publicAccessCidrs?.join(', ') || '—'}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1, color: '#09090b' }}>
                    Security Groups
                  </Typography>
                  {detail?.networking.securityGroups?.map((sg) => (
                    <Paper key={sg.groupId} variant="outlined" sx={{ p: 1.5, mb: 1.25 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <SecurityIcon fontSize="small" color="primary" />
                        <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                          {sg.groupId}
                        </Typography>
                        {sg.isClusterSecurityGroup && (
                          <Chip size="small" label="Cluster Security Group" color="primary" />
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {sg.groupName} {sg.description ? `— ${sg.description}` : ''}
                      </Typography>
                    </Paper>
                  ))}
                </Grid>
              </Grid>

              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  Cluster Subnets ({detail?.networking.subnets?.length || 0})
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell><strong>Subnet ID</strong></TableCell>
                        <TableCell><strong>Name</strong></TableCell>
                        <TableCell><strong>Availability Zone</strong></TableCell>
                        <TableCell><strong>CIDR Block</strong></TableCell>
                        <TableCell><strong>Auto-Assign Public IP</strong></TableCell>
                        <TableCell><strong>Available IPs</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(detail?.networking.subnets || []).map((sub) => (
                        <TableRow key={sub.subnetId}>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{sub.subnetId}</TableCell>
                          <TableCell>{sub.name || '—'}</TableCell>
                          <TableCell>{sub.availabilityZone || '—'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{sub.cidrBlock || '—'}</TableCell>
                          <TableCell>{sub.mapPublicIpOnLaunch ? 'Yes' : 'No'}</TableCell>
                          <TableCell>{sub.availableIpAddressCount ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Box>
          )}

          {/* Tab 3: Observability & Access */}
          {tab === 3 && (
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  Control Plane Logging
                </Typography>
                {loggingEntries.length > 0 ? (
                  loggingEntries.map((entry, idx) => (
                    <Box key={idx} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                      {(entry.types || []).map((logType) => (
                        <Chip
                          key={logType}
                          label={`${logType}: ${entry.enabled ? 'Enabled' : 'Disabled'}`}
                          color={entry.enabled ? 'success' : 'default'}
                          variant={entry.enabled ? 'filled' : 'outlined'}
                          size="small"
                        />
                      ))}
                    </Box>
                  ))
                ) : (
                  <Alert severity="info">No control plane logging configuration found.</Alert>
                )}
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  IAM, OIDC &amp; Secrets Encryption
                </Typography>
                <KeyValRow
                  label="OpenID Connect Provider URL"
                  value={c?.oidcIssuer}
                  copyValue={c?.oidcIssuer}
                />
                <KeyValRow
                  label="Authentication Mode"
                  value={c?.accessConfig?.authenticationMode || 'CONFIG_MAP'}
                />
                <KeyValRow
                  label="KMS Envelope Encryption"
                  value={
                    c?.encryptionConfig && c.encryptionConfig.length > 0
                      ? c.encryptionConfig
                          .map((e) => `${(e.resources || []).join(', ')} (${e.provider?.keyArn || 'KMS'})`)
                          .join(' | ')
                      : 'Not configured'
                  }
                />
                <KeyValRow
                  label="Certificate Authority"
                  value={c?.certificateAuthority ? `${c.certificateAuthority.slice(0, 36)}...` : '—'}
                  copyValue={c?.certificateAuthority}
                />
              </Grid>
            </Grid>
          )}

          {/* Tab 4: Update & State History */}
          {tab === 4 && (
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  AWS EKS Control Plane Update History
                </Typography>
                {detail?.updateHistory && detail.updateHistory.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Type</strong></TableCell>
                          <TableCell><strong>Status</strong></TableCell>
                          <TableCell><strong>Time</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detail.updateHistory.map((upd) => (
                          <TableRow key={upd.id}>
                            <TableCell sx={{ fontWeight: 600 }}>{upd.type || upd.id}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={upd.status || 'InProgress'}
                                color={
                                  upd.status === 'Successful'
                                    ? 'success'
                                    : upd.status === 'Failed' || upd.status === 'Cancelled'
                                    ? 'error'
                                    : 'warning'
                                }
                              />
                            </TableCell>
                            <TableCell>
                              {upd.createdAt ? new Date(upd.createdAt).toLocaleString() : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No AWS control-plane update events recorded yet.</Alert>
                )}
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  Tesserak Local State History (PostgreSQL)
                </Typography>
                {detail?.localState.history && detail.localState.history.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Event</strong></TableCell>
                          <TableCell><strong>Timestamp</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {[...detail.localState.history].reverse().map((ev, idx) => (
                          <TableRow key={idx}>
                            <TableCell sx={{ fontWeight: 600 }}>{ev.type || 'change'}</TableCell>
                            <TableCell>
                              {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">
                    No local PostgreSQL state snapshots yet—click Sync AWS State to record one.
                  </Alert>
                )}
              </Grid>
            </Grid>
          )}

          {/* Tab 5: Tags */}
          {tab === 5 && (
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                Cluster Tags ({tagEntries.length})
              </Typography>
              {tagEntries.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell><strong>Key</strong></TableCell>
                        <TableCell><strong>Value</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {tagEntries.map(([k, v]) => (
                        <TableRow key={k}>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{k}</TableCell>
                          <TableCell>{v}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No tags configured on this EKS cluster.</Alert>
              )}
            </Box>
          )}
        </Box>
      </Perspective3DCard>

      {/* Add Node Group Dialog */}
      <Dialog open={ngDialogOpen} onClose={() => setNgDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCreateNodegroup}>
          <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
            Add Managed Node Group
          </DialogTitle>
          <DialogContent sx={{ pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2.25 }}>
            {ngDialogError && (
              <Alert severity="error" onClose={() => setNgDialogError('')}>
                {ngDialogError}
              </Alert>
            )}
            <TextField
              label="Node Group Name"
              value={ngName}
              onChange={(e) => setNgName(e.target.value)}
              required
              fullWidth
            />
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>AMI Type</InputLabel>
                  <Select
                    value={ngAmiType}
                    label="AMI Type"
                    onChange={(e) => {
                      const next = e.target.value;
                      setNgAmiType(next);
                      setNgAmiManual(false);
                      if (next.includes('arm64') && ngInstanceType.startsWith('t3.')) {
                        setNgInstanceType('t4g.medium');
                      } else if (!next.includes('arm64') && ngInstanceType.startsWith('t4g.')) {
                        setNgInstanceType('t3.medium');
                      }
                      fetchNodegroupAmi(next, true);
                    }}
                  >
                    {EKS_AMI_TYPES.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="AMI ID"
                  value={ngAmiId}
                  onChange={(e) => {
                    setNgAmiId(e.target.value);
                    setNgAmiManual(true);
                  }}
                  fullWidth
                  helperText={`K8s ${detail?.cluster?.version || 'latest'} (${detail?.region || ''}) · Editable`}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        {ngLoadingAmi ? <CircularProgress size={16} /> : null}
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>
            </Grid>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <InstanceTypeSelect
                  accountId={detail?.accountId}
                  region={detail?.region}
                  userEmail={userEmail}
                  amiType={ngAmiType}
                  value={ngInstanceType}
                  onChange={setNgInstanceType}
                  size="medium"
                  required
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Capacity Type</InputLabel>
                  <Select
                    value={ngCapacityType}
                    label="Capacity Type"
                    onChange={(e) => setNgCapacityType(e.target.value as 'ON_DEMAND' | 'SPOT')}
                  >
                    <MenuItem value="ON_DEMAND">On-Demand</MenuItem>
                    <MenuItem value="SPOT">Spot Instances</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <NumericCountField
                  label="Min Nodes"
                  size="medium"
                  value={ngMinSize}
                  min={0}
                  fallbackValue={1}
                  onChange={setNgMinSize}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <NumericCountField
                  label="Desired"
                  size="medium"
                  value={ngDesiredSize}
                  min={0}
                  fallbackValue={2}
                  onChange={setNgDesiredSize}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <NumericCountField
                  label="Max Nodes"
                  size="medium"
                  value={ngMaxSize}
                  min={1}
                  fallbackValue={4}
                  onChange={setNgMaxSize}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <NumericCountField
                  label="Disk (GB)"
                  size="medium"
                  value={ngDiskSize}
                  min={20}
                  fallbackValue={20}
                  onChange={setNgDiskSize}
                />
              </Grid>
            </Grid>

            <Autocomplete
              multiple
              filterSelectedOptions
              options={(detail?.networking.subnets || []).map((s) => s.subnetId)}
              value={ngSubnets}
              onChange={(_, vals) => setNgSubnets(vals)}
              renderInput={(params) => (
                <TextField {...params} label="Worker Subnets" placeholder="Select cluster subnets..." />
              )}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setNgDialogOpen(false)} disabled={ngSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={ngSubmitting || !ngName.trim()}>
              {ngSubmitting ? 'Creating...' : 'Create Node Group'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Scale Node Group Dialog */}
      <Dialog open={Boolean(scaleTarget)} onClose={() => setScaleTarget(null)} maxWidth="xs" fullWidth>
        <form onSubmit={handleScaleNodegroup}>
          <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
            Scale Node Group: {scaleTarget?.nodegroupName}
          </DialogTitle>
          <DialogContent sx={{ pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <NumericCountField
              label="Min Size"
              size="medium"
              value={scaleTarget?.minSize ?? 1}
              min={0}
              fallbackValue={1}
              onChange={(val) => scaleTarget && setScaleTarget({ ...scaleTarget, minSize: val })}
            />
            <NumericCountField
              label="Desired Size"
              size="medium"
              value={scaleTarget?.desiredSize ?? 2}
              min={0}
              fallbackValue={2}
              onChange={(val) => scaleTarget && setScaleTarget({ ...scaleTarget, desiredSize: val })}
            />
            <NumericCountField
              label="Max Size"
              size="medium"
              value={scaleTarget?.maxSize ?? 4}
              min={1}
              fallbackValue={4}
              onChange={(val) => scaleTarget && setScaleTarget({ ...scaleTarget, maxSize: val })}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setScaleTarget(null)} disabled={scaleSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={scaleSubmitting}>
              {scaleSubmitting ? 'Updating...' : 'Apply Scaling'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Delete Node Group Dialog */}
      <Dialog open={Boolean(deleteNgTarget)} onClose={() => setDeleteNgTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
          Delete Node Group?
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Typography variant="body2" sx={{ color: '#334155' }}>
            This will terminate worker nodes in <strong>{deleteNgTarget}</strong> on AWS EKS.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteNgTarget(null)} disabled={deleteNgSubmitting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" disabled={deleteNgSubmitting} onClick={handleDeleteNodegroup}>
            {deleteNgSubmitting ? 'Deleting...' : 'Confirm Delete'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Clickable AWS EKS Node Inspector Dialog */}
      <NodeDetailsDialog
        node={selectedNode}
        pods={detail?.pods || []}
        onClose={() => setSelectedNode(null)}
      />
    </Box>
  );
};

export default ClusterDetails;
