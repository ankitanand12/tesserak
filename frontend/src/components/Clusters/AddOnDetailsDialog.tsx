import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  DeleteOutline as DeleteIcon,
  Extension as AddonIcon,
  Refresh as RefreshIcon,
  RocketLaunch as InstallIcon,
} from '@mui/icons-material';
import { ClusterPod, formatClusterDateTime, getPodStatusChipColor } from './NodeDetailsDialog';
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';

export interface AwsClusterAddon {
  addonName: string;
  addonVersion?: string;
  addonArn?: string;
  status?: string;
  serviceAccountRoleArn?: string;
  createdAt?: string;
  modifiedAt?: string;
  configurationValues?: string;
  health?: { issues?: Array<{ code?: string; message?: string; resourceIds?: string[] }> };
  publisher?: string;
  owner?: string;
}

export interface CommunityClusterAddon {
  id: string;
  name: string;
  releaseName?: string;
  namespace?: string;
  chart?: string;
  version?: string;
  requestedVersion?: string;
  status: string;
  source?: string;
  details?: string;
  logs?: string;
  notes?: string;
  valuesYaml?: string;
  presetValuesYaml?: string;
  accessHints?: string[];
}

interface K8sEventItem {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  source?: string;
  involvedKind?: string;
  involvedName?: string;
  firstSeen?: string;
  lastSeen?: string;
}

interface CommunityAddonLiveDetails {
  id: string;
  releaseName?: string;
  namespace?: string;
  helmStatus?: {
    status?: string;
    description?: string;
    last_deployed?: string;
    notes?: string;
  };
  notes?: string;
  valuesYaml?: string;
  presetValuesYaml?: string;
  accessHints?: string[];
  logs?: string;
  details?: string;
  updatedAt?: string;
  resources?: {
    pods?: ClusterPod[];
    services?: Array<{
      name?: string;
      type?: string;
      clusterIP?: string;
      externalEndpoints?: string[];
      ports?: string[];
    }>;
    ingresses?: Array<{
      name?: string;
      className?: string;
      hosts?: string[];
      addresses?: string[];
      tls?: boolean;
    }>;
  };
  events?: K8sEventItem[];
}

interface AddOnDetailsDialogProps {
  clusterName: string;
  accountId?: string;
  userEmail: string;
  awsAddon: AwsClusterAddon | null;
  communityAddon: CommunityClusterAddon | null;
  pods: ClusterPod[];
  isClusterActive?: boolean;
  readOnly?: boolean;
  installing?: boolean;
  onClose: () => void;
  onSelectPod?: (pod: ClusterPod) => void;
  onInstallCommunityAddon?: (
    addonId: string,
    name: string,
    version?: string,
    valuesYaml?: string
  ) => Promise<void> | void;
  onUninstallCommunityAddon?: (addonId: string, name: string) => Promise<void> | void;
}

const KeyVal: React.FC<{ label: string; value?: React.ReactNode; copyValue?: string }> = ({
  label,
  value,
  copyValue,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <Box sx={{ py: 1, borderBottom: '1px solid rgba(15, 23, 42, 0.08)' }}>
      <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.25 }}>
        <Typography variant="body2" component="div" sx={{ color: '#09090b', fontWeight: 600, wordBreak: 'break-all' }}>
          {value ?? '—'}
        </Typography>
        {copyValue && (
          <Tooltip title={copied ? 'Copied' : 'Copy'}>
            <IconButton
              size="small"
              aria-label={`Copy ${label}`}
              onClick={() => {
                navigator.clipboard?.writeText(copyValue);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              <CopyIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
};

const AWS_ADDON_POD_HINTS: Record<string, string[]> = {
  'vpc-cni': ['aws-node'],
  'coredns': ['coredns'],
  'kube-proxy': ['kube-proxy'],
  'aws-ebs-csi-driver': ['ebs-csi'],
  'aws-efs-csi-driver': ['efs-csi'],
  'aws-fsx-csi-driver': ['fsx-csi'],
  'eks-pod-identity-agent': ['eks-pod-identity'],
  'snapshot-controller': ['snapshot-controller'],
};

export const AddOnDetailsDialog: React.FC<AddOnDetailsDialogProps> = ({
  clusterName,
  accountId,
  userEmail,
  awsAddon,
  communityAddon,
  pods,
  isClusterActive = false,
  readOnly = false,
  installing = false,
  onClose,
  onSelectPod,
  onInstallCommunityAddon,
  onUninstallCommunityAddon,
}) => {
  const [tab, setTab] = useState(0);
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveData, setLiveData] = useState<CommunityAddonLiveDetails | null>(null);
  const [customValues, setCustomValues] = useState('');
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  const open = Boolean(awsAddon || communityAddon);

  const loadCommunityLiveDetails = useCallback(async () => {
    if (!communityAddon || !clusterName) return;
    setLoadingLive(true);
    try {
      const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
      const res = await fetch(
        `http://localhost:8000/clusters/${encodeURIComponent(clusterName)}/community-addons/${encodeURIComponent(communityAddon.id)}/details${qs}`,
        { headers: { 'x-user-email': userEmail } }
      );
      if (res.ok) {
        const data: CommunityAddonLiveDetails = await res.json();
        setLiveData(data);
        if (data.valuesYaml) {
          setCustomValues((prev) => (prev.trim() ? prev : data.valuesYaml || ''));
        }
      }
    } catch {
      // Optional live telemetry helper
    } finally {
      setLoadingLive(false);
    }
  }, [communityAddon, clusterName, accountId, userEmail]);

  useEffect(() => {
    setTab(0);
    setLiveData(null);
    if (communityAddon) {
      setCustomValues(communityAddon.valuesYaml || '');
      loadCommunityLiveDetails();
    } else {
      setCustomValues('');
    }
  }, [awsAddon?.addonName, communityAddon?.id, loadCommunityLiveDetails]);

  useEffect(() => {
    if (!communityAddon || !installing) return;
    const timer = setInterval(() => {
      loadCommunityLiveDetails();
    }, 5000);
    return () => clearInterval(timer);
  }, [communityAddon, installing, loadCommunityLiveDetails]);

  const matchedAwsAddonPods = useMemo(() => {
    if (!awsAddon) return [];
    const tokens = AWS_ADDON_POD_HINTS[awsAddon.addonName] || [awsAddon.addonName];
    return pods.filter((p) => {
      const n = (p.name || '').toLowerCase();
      return tokens.some((tok) => n.includes(tok));
    });
  }, [awsAddon, pods]);

  if (!open) return null;

  // Render AWS Managed EKS Add-on Details
  if (awsAddon) {
    const issues = awsAddon.health?.issues || [];
    let parsedConfig = awsAddon.configurationValues || '';
    if (parsedConfig) {
      try {
        parsedConfig = JSON.stringify(JSON.parse(parsedConfig), null, 2);
      } catch {
        // Keep raw string
      }
    }

    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle
          sx={{
            bgcolor: '#09090b',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1.5,
            py: 1.75,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <AddonIcon sx={{ color: '#60a5fa' }} />
            <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'monospace' }}>
              {awsAddon.addonName}
            </Typography>
            <Chip
              size="small"
              label={awsAddon.status || 'UNKNOWN'}
              color={awsAddon.status === 'ACTIVE' ? 'success' : 'warning'}
              sx={{ fontWeight: 700 }}
            />
            {awsAddon.addonVersion && (
              <Chip
                size="small"
                label={awsAddon.addonVersion}
                sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#ffffff', fontFamily: 'monospace' }}
              />
            )}
          </Box>
          <IconButton aria-label="Close add-on details" onClick={onClose} sx={{ color: '#cbd5e1' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pt: 2.5, pb: 3 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{ borderBottom: '1px solid rgba(15, 23, 42, 0.1)', mb: 2 }}
          >
            <Tab label="Details & Configuration" />
            <Tab label={`Health issues (${issues.length})`} />
            <Tab label={`Pods (${matchedAwsAddonPods.length})`} />
          </Tabs>

          {tab === 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Grid container spacing={2.5}>
                <Grid item xs={12} md={6}>
                  <KeyVal label="Add-on ARN" value={awsAddon.addonArn} copyValue={awsAddon.addonArn} />
                  <KeyVal label="Version" value={awsAddon.addonVersion} />
                  <KeyVal label="Owner / Publisher" value={`${awsAddon.owner || 'aws'} · ${awsAddon.publisher || 'eks'}`} />
                </Grid>
                <Grid item xs={12} md={6}>
                  <KeyVal
                    label="Service Account Role ARN"
                    value={awsAddon.serviceAccountRoleArn || 'Cluster IAM / Pod Identity'}
                    copyValue={awsAddon.serviceAccountRoleArn}
                  />
                  <KeyVal label="Created at" value={formatClusterDateTime(awsAddon.createdAt)} />
                  <KeyVal label="Modified at" value={formatClusterDateTime(awsAddon.modifiedAt)} />
                </Grid>
              </Grid>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                  Configuration values
                </Typography>
                {parsedConfig ? (
                  <Paper
                    variant="outlined"
                    sx={{ p: 2, bgcolor: '#09090b', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}
                  >
                    {parsedConfig}
                  </Paper>
                ) : (
                  <Alert severity="info">Using default AWS EKS add-on configuration values.</Alert>
                )}
              </Box>
            </Box>
          )}

          {tab === 1 && (
            <Box>
              {issues.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell><strong>Code</strong></TableCell>
                        <TableCell><strong>Message</strong></TableCell>
                        <TableCell><strong>Affected Resources</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {issues.map((iss, idx) => (
                        <TableRow key={`${iss.code || 'issue'}-${idx}`}>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{iss.code || 'Issue'}</TableCell>
                          <TableCell>{iss.message || '—'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>
                            {iss.resourceIds?.join(', ') || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="success">Add-on is healthy with no reported health issues.</Alert>
              )}
            </Box>
          )}

          {tab === 2 && (
            <Box>
              {matchedAwsAddonPods.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell><strong>Pod Name</strong></TableCell>
                        <TableCell><strong>Namespace</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                        <TableCell><strong>Restarts</strong></TableCell>
                        <TableCell><strong>Pod IP</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {matchedAwsAddonPods.map((pod) => (
                        <TableRow key={`${pod.namespace}/${pod.name}`} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                            {onSelectPod ? (
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => onSelectPod(pod)}
                                sx={{ p: 0, textTransform: 'none', fontFamily: 'monospace', fontWeight: 700, color: '#2563eb' }}
                              >
                                {pod.name}
                              </Button>
                            ) : (
                              pod.name
                            )}
                          </TableCell>
                          <TableCell>{pod.namespace}</TableCell>
                          <TableCell>
                            <Chip size="small" label={pod.status} color={getPodStatusChipColor(pod.status)} />
                          </TableCell>
                          <TableCell>{pod.restarts ?? 0}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{pod.podIp || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No pods matched this add-on on active nodes.</Alert>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // Render Community / Helm Add-on Details
  const ca = communityAddon!;
  const effectiveStatus = installing
    ? 'INSTALLING'
    : (liveData?.helmStatus?.status || ca.status || 'NOT_INSTALLED').toUpperCase();
  const isDeployed = ['DEPLOYED', 'INSTALLED', 'SUCCESS'].includes(effectiveStatus);
  const logsText = liveData?.logs || ca.logs || ca.details || 'No Helm execution trace recorded yet.';
  const notesText = liveData?.notes || ca.notes || '';
  const presetYaml = liveData?.presetValuesYaml || ca.presetValuesYaml || '';
  const accessHints = liveData?.accessHints || ca.accessHints || [];
  const nsPods = liveData?.resources?.pods || pods.filter((p) => p.namespace === (liveData?.namespace || ca.namespace));
  const nsServices = liveData?.resources?.services || [];
  const nsIngresses = liveData?.resources?.ingresses || [];
  const nsEvents = liveData?.events || [];

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle
          sx={{
            bgcolor: '#09090b',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1.5,
            py: 1.75,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <AddonIcon sx={{ color: '#60a5fa' }} />
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {ca.name || ca.id}
            </Typography>
            <Chip
              size="small"
              label={liveData?.namespace || ca.namespace || 'kube-system'}
              sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#ffffff', fontFamily: 'monospace' }}
            />
            <Chip
              size="small"
              label={effectiveStatus}
              color={
                isDeployed
                  ? 'success'
                  : effectiveStatus === 'FAILED'
                  ? 'error'
                  : effectiveStatus === 'INSTALLING'
                  ? 'info'
                  : 'warning'
              }
              sx={{ fontWeight: 700 }}
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              disabled={loadingLive}
              startIcon={loadingLive ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon fontSize="small" />}
              onClick={loadCommunityLiveDetails}
              sx={{ color: '#ffffff', borderColor: 'rgba(255,255,255,0.35)' }}
            >
              Refresh
            </Button>
            {!readOnly && isClusterActive && onInstallCommunityAddon && (
              <Button
                size="small"
                variant="contained"
                disabled={installing}
                startIcon={installing ? <CircularProgress size={14} color="inherit" /> : <InstallIcon fontSize="small" />}
                onClick={async () => {
                  await onInstallCommunityAddon(
                    ca.id,
                    ca.name || ca.id,
                    ca.requestedVersion || ca.version,
                    customValues.trim() ? customValues : undefined
                  );
                  loadCommunityLiveDetails();
                }}
              >
                {installing ? 'Installing...' : isDeployed ? 'Upgrade / Apply' : 'Install via Helm'}
              </Button>
            )}
            {!readOnly && isClusterActive && isDeployed && onUninstallCommunityAddon && (
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={installing || uninstalling}
                startIcon={<DeleteIcon fontSize="small" />}
                onClick={() => setConfirmUninstall(true)}
              >
                Uninstall
              </Button>
            )}
            <IconButton aria-label="Close add-on details" onClick={onClose} sx={{ color: '#cbd5e1' }}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 2.5, pb: 3 }}>
          {effectiveStatus === 'FAILED' && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <strong>Last Helm install failed:</strong> {liveData?.details || ca.details || 'See Install Logs tab below.'}
            </Alert>
          )}

          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: '1px solid rgba(15, 23, 42, 0.1)', mb: 2 }}
          >
            <Tab label="Overview & Access" />
            <Tab label={`Install Logs & Events (${nsEvents.length})`} />
            <Tab label="Custom Values (values.yaml)" />
          </Tabs>

          {tab === 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Grid container spacing={2.5}>
                <Grid item xs={12} sm={6} md={4}>
                  <KeyVal label="Release Name" value={liveData?.releaseName || ca.releaseName || ca.id} />
                  <KeyVal label="Chart" value={ca.chart || ca.id} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <KeyVal label="Namespace" value={liveData?.namespace || ca.namespace || 'kube-system'} />
                  <KeyVal label="Version" value={ca.version || ca.requestedVersion || 'latest'} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <KeyVal label="Helm Status" value={effectiveStatus} />
                  <KeyVal
                    label="Last Updated"
                    value={formatClusterDateTime(liveData?.helmStatus?.last_deployed || liveData?.updatedAt)}
                  />
                </Grid>
              </Grid>

              {accessHints.length > 0 && (
                <Alert severity="info">
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                    Domain &amp; Access Guide
                  </Typography>
                  {accessHints.map((hint, idx) => (
                    <Typography key={idx} variant="body2" sx={{ fontFamily: hint.includes('kubectl') ? 'monospace' : 'inherit', mt: 0.35 }}>
                      • {hint}
                    </Typography>
                  ))}
                </Alert>
              )}

              {/* Services & Ingresses in Add-on Namespace */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                  Services &amp; External Endpoints ({nsServices.length})
                </Typography>
                {nsServices.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Service Name</strong></TableCell>
                          <TableCell><strong>Type</strong></TableCell>
                          <TableCell><strong>Cluster IP</strong></TableCell>
                          <TableCell><strong>External LoadBalancer / Host</strong></TableCell>
                          <TableCell><strong>Ports</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {nsServices.map((svc) => (
                          <TableRow key={svc.name}>
                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{svc.name}</TableCell>
                            <TableCell>{svc.type}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{svc.clusterIP || '—'}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', color: '#2563eb' }}>
                              {svc.externalEndpoints && svc.externalEndpoints.length > 0
                                ? svc.externalEndpoints.join(', ')
                                : '—'}
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{svc.ports?.join(', ') || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No Kubernetes services found yet in namespace {liveData?.namespace || ca.namespace}.</Alert>
                )}
              </Box>

              {nsIngresses.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                    Ingresses &amp; Mapped Domains ({nsIngresses.length})
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Ingress</strong></TableCell>
                          <TableCell><strong>Class</strong></TableCell>
                          <TableCell><strong>Domain Hosts</strong></TableCell>
                          <TableCell><strong>LoadBalancer Address</strong></TableCell>
                          <TableCell><strong>TLS</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {nsIngresses.map((ing) => (
                          <TableRow key={ing.name}>
                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{ing.name}</TableCell>
                            <TableCell>{ing.className || '—'}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', color: '#2563eb' }}>
                              {ing.hosts?.join(', ') || '—'}
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{ing.addresses?.join(', ') || 'Pending'}</TableCell>
                            <TableCell>{ing.tls ? 'Enabled' : 'HTTP'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              )}

              {notesText && (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                    Helm Release Notes
                  </Typography>
                  <Paper
                    variant="outlined"
                    sx={{ p: 2, bgcolor: '#09090b', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.78rem', maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                  >
                    {notesText}
                  </Paper>
                </Box>
              )}
            </Box>
          )}

          {tab === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                  Helm Execution Trace &amp; Logs
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{ p: 2, bgcolor: '#09090b', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.79rem', maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                >
                  {logsText}
                </Paper>
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                  Namespace Pods ({nsPods.length})
                </Typography>
                {nsPods.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Pod Name</strong></TableCell>
                          <TableCell><strong>Status</strong></TableCell>
                          <TableCell><strong>Ready</strong></TableCell>
                          <TableCell><strong>Restarts</strong></TableCell>
                          <TableCell><strong>Pod IP</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {nsPods.map((pod) => (
                          <TableRow key={`${pod.namespace}/${pod.name}`} hover>
                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                              {onSelectPod ? (
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() => onSelectPod(pod)}
                                  sx={{ p: 0, textTransform: 'none', fontFamily: 'monospace', fontWeight: 700, color: '#2563eb' }}
                                >
                                  {pod.name}
                                </Button>
                              ) : (
                                pod.name
                              )}
                            </TableCell>
                            <TableCell>
                              <Chip size="small" label={pod.status} color={getPodStatusChipColor(pod.status)} />
                            </TableCell>
                            <TableCell>{pod.ready || '—'}</TableCell>
                            <TableCell>{pod.restarts ?? 0}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{pod.podIp || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No pods running yet in namespace {liveData?.namespace || ca.namespace}.</Alert>
                )}
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                  Namespace Kubernetes Events ({nsEvents.length})
                </Typography>
                {nsEvents.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell><strong>Type</strong></TableCell>
                          <TableCell><strong>Reason</strong></TableCell>
                          <TableCell><strong>Object</strong></TableCell>
                          <TableCell><strong>Message</strong></TableCell>
                          <TableCell><strong>Last Seen</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {nsEvents.map((ev, i) => (
                          <TableRow key={`${ev.reason || 'ev'}-${i}`}>
                            <TableCell>
                              <Chip
                                size="small"
                                label={ev.type || 'Normal'}
                                color={ev.type === 'Warning' ? 'warning' : 'default'}
                              />
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{ev.reason || '—'}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                              {ev.involvedKind}/{ev.involvedName}
                            </TableCell>
                            <TableCell>{ev.message || '—'}</TableCell>
                            <TableCell>{formatClusterDateTime(ev.lastSeen)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No recent Kubernetes events reported in this namespace.</Alert>
                )}
              </Box>
            </Box>
          )}

          {tab === 2 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="body2" sx={{ color: '#475569' }}>
                  Pass custom Helm <code>values.yaml</code> overrides (for custom Ingress domain hosts, annotations, replicas, resource limits, etc.).
                </Typography>
                {presetYaml && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setCustomValues(presetYaml)}
                  >
                    Load Preset / Domain Template
                  </Button>
                )}
              </Box>

              <TextField
                label="Custom Helm values.yaml"
                multiline
                minRows={10}
                maxRows={20}
                value={customValues}
                onChange={(e) => setCustomValues(e.target.value)}
                placeholder="# Optional YAML overrides passed to helm upgrade --install via --values"
                InputProps={{
                  sx: { fontFamily: 'monospace', fontSize: '0.84rem', bgcolor: '#f8fafc' },
                }}
                fullWidth
              />

              {!readOnly && isClusterActive && onInstallCommunityAddon && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    disabled={installing}
                    startIcon={installing ? <CircularProgress size={16} color="inherit" /> : <InstallIcon fontSize="small" />}
                    onClick={async () => {
                      await onInstallCommunityAddon(
                        ca.id,
                        ca.name || ca.id,
                        ca.requestedVersion || ca.version,
                        customValues.trim() ? customValues : undefined
                      );
                      setTab(1);
                      loadCommunityLiveDetails();
                    }}
                  >
                    {installing ? 'Applying Helm Release...' : isDeployed ? 'Upgrade with Custom Values' : 'Install with Custom Values'}
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDeleteDialog
        open={confirmUninstall}
        title="Uninstall Community Add-on?"
        description={
          <>
            Uninstall Helm release <strong>{liveData?.releaseName || ca.releaseName || ca.id}</strong> from namespace{' '}
            <strong>{liveData?.namespace || ca.namespace || 'kube-system'}</strong>?
          </>
        }
        confirmLabel="Confirm Uninstall"
        loading={uninstalling}
        onCancel={() => setConfirmUninstall(false)}
        onConfirm={async () => {
          if (!onUninstallCommunityAddon) return;
          setUninstalling(true);
          try {
            await onUninstallCommunityAddon(ca.id, ca.name || ca.id);
            setConfirmUninstall(false);
            onClose();
          } finally {
            setUninstalling(false);
          }
        }}
      />
    </>
  );
};
