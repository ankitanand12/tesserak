import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  CheckCircle as CheckCircleIcon,
  ContentCopy as CopyIcon,
  Extension as AddonIcon,
  History as HistoryIcon,
  Hub as NetworkIcon,
  Label as TagIcon,
  Memory as ComputeIcon,
  Refresh as RefreshIcon,
  Security as SecurityIcon,
  Storage as StorageIcon,
  Sync as SyncIcon,
  Visibility as ObservabilityIcon,
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
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
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: '#09090b' }}>
                  Managed Node Groups ({detail?.nodegroups.length || 0})
                </Typography>
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No managed node groups attached to this cluster yet.</Alert>
                )}
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
    </Box>
  );
};

export default ClusterDetails;
