import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  DeleteOutline as DeleteIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';
import { ClusterWorkerNode, formatClusterDateTime } from './NodeDetailsDialog';

export interface ClusterNodegroup {
  nodegroupName: string;
  nodegroupArn?: string;
  clusterName?: string;
  version?: string;
  releaseVersion?: string;
  createdAt?: string;
  modifiedAt?: string;
  status?: string;
  capacityType?: string;
  scalingConfig?: { minSize?: number; desiredSize?: number; maxSize?: number };
  instanceTypes?: string[];
  subnets?: string[];
  remoteAccess?: { ec2SshKey?: string; sourceSecurityGroups?: string[] };
  amiType?: string;
  nodeRole?: string;
  labels?: Record<string, string>;
  taints?: Array<{ key?: string; value?: string; effect?: string }>;
  resources?: {
    autoScalingGroups?: Array<{ name?: string }>;
    remoteAccessSecurityGroup?: string;
  };
  diskSize?: number;
  health?: { issues?: Array<{ code?: string; message?: string; resourceIds?: string[] }> };
  updateConfig?: {
    maxUnavailable?: number;
    maxUnavailablePercentage?: number;
    updateStrategy?: string;
  };
  launchTemplate?: { name?: string; id?: string; version?: string };
  nodeRepairConfig?: { enabled?: boolean };
  tags?: Record<string, string>;
  updateHistory?: Array<{
    id: string;
    type?: string;
    status?: string;
    createdAt?: string;
    errors?: Array<{ errorCode?: string; errorMessage?: string }>;
  }>;
}

export interface ClusterSubnetInfo {
  subnetId: string;
  name?: string;
  cidrBlock?: string;
  availabilityZone?: string;
  mapPublicIpOnLaunch?: boolean;
  isPublic?: boolean;
  availableIpAddressCount?: number;
}

export const isClusterSubnetPublic = (s?: Partial<ClusterSubnetInfo> | null): boolean => {
  if (!s) return false;
  if (typeof s.isPublic === 'boolean') return s.isPublic;
  return Boolean(s.mapPublicIpOnLaunch || (s.name || '').toLowerCase().includes('public'));
};

interface NodeGroupDetailsDialogProps {
  nodegroup: ClusterNodegroup | null;
  workerNodes: ClusterWorkerNode[];
  subnets?: ClusterSubnetInfo[];
  onClose: () => void;
  onScale?: (ng: ClusterNodegroup) => void;
  onDelete?: (nodegroupName: string) => void;
  onSelectNode?: (node: ClusterWorkerNode) => void;
}

const KeyVal: React.FC<{ label: string; value?: React.ReactNode; copyValue?: string }> = ({
  label,
  value,
  copyValue,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <Box
      sx={{
        py: 1.15,
        borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.3,
      }}
    >
      <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography
          variant="body2"
          component="div"
          sx={{ color: '#09090b', fontWeight: 600, wordBreak: 'break-all' }}
        >
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

export const NodeGroupDetailsDialog: React.FC<NodeGroupDetailsDialogProps> = ({
  nodegroup,
  workerNodes,
  subnets = [],
  onClose,
  onScale,
  onDelete,
  onSelectNode,
}) => {
  const [tab, setTab] = useState(0);

  const ngNodes = useMemo(() => {
    if (!nodegroup) return [];
    return workerNodes.filter((n) => n.nodegroupName === nodegroup.nodegroupName);
  }, [nodegroup, workerNodes]);

  if (!nodegroup) return null;

  const subnetMap = new Map(subnets.map((s) => [s.subnetId, s]));
  const healthIssues = nodegroup.health?.issues || [];
  const labelEntries = Object.entries(nodegroup.labels || {});
  const taints = nodegroup.taints || [];
  const tagEntries = Object.entries(nodegroup.tags || {});
  const updates = nodegroup.updateHistory || [];
  const asgNames = (nodegroup.resources?.autoScalingGroups || [])
    .map((a) => a.name)
    .filter(Boolean) as string[];

  return (
    <Dialog open={Boolean(nodegroup)} onClose={onClose} maxWidth="lg" fullWidth>
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
          <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'monospace' }}>
            {nodegroup.nodegroupName}
          </Typography>
          <Chip
            size="small"
            label={nodegroup.status || 'UNKNOWN'}
            color={nodegroup.status === 'ACTIVE' ? 'success' : 'warning'}
            sx={{ fontWeight: 700 }}
          />
          <Chip
            size="small"
            label={nodegroup.capacityType || 'ON_DEMAND'}
            sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#ffffff', fontWeight: 700 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {onScale && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<TuneIcon fontSize="small" />}
              onClick={() => onScale(nodegroup)}
              sx={{ color: '#ffffff', borderColor: 'rgba(255,255,255,0.35)' }}
            >
              Scale / Edit
            </Button>
          )}
          {onDelete && (
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon fontSize="small" />}
              onClick={() => onDelete(nodegroup.nodegroupName)}
            >
              Delete Node Group
            </Button>
          )}
          <IconButton aria-label="Close node group details" onClick={onClose} sx={{ color: '#cbd5e1' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5, pb: 3 }}>
        {/* Summary Strip matching AWS Node group configuration */}
        <Paper variant="outlined" sx={{ p: 2, mb: 2.5, bgcolor: '#f8fafc', borderRadius: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1.5 }}>
            Node group configuration
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={4} md={2}>
              <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                Kubernetes version
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, color: '#09090b' }}>
                {nodegroup.version || '—'}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                AMI type
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, color: '#09090b' }}>
                {nodegroup.amiType || '—'}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
              <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                AMI release version
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace', color: '#09090b' }}>
                {nodegroup.releaseVersion || '—'}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
              <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                Instance types
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace', color: '#09090b' }}>
                {nodegroup.instanceTypes?.join(', ') || '—'}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                Disk size
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, color: '#09090b' }}>
                {nodegroup.diskSize ? `${nodegroup.diskSize} GiB` : 'Default (20 GiB)'}
              </Typography>
            </Grid>
          </Grid>
        </Paper>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: '1px solid rgba(15, 23, 42, 0.1)', mb: 2 }}
        >
          <Tab label="Details" />
          <Tab label={`Nodes (${ngNodes.length})`} />
          <Tab label={`Health issues (${healthIssues.length})`} />
          <Tab label={`Kubernetes labels (${labelEntries.length})`} />
          <Tab label="Update config" />
          <Tab label={`Kubernetes taints (${taints.length})`} />
          <Tab label={`Update history (${updates.length})`} />
          <Tab label={`Tags (${tagEntries.length})`} />
        </Tabs>

        {tab === 0 && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <KeyVal label="Node group ARN" value={nodegroup.nodegroupArn} copyValue={nodegroup.nodegroupArn} />
              <KeyVal
                label="Auto Scaling group name"
                value={asgNames.length > 0 ? asgNames.join(', ') : '—'}
                copyValue={asgNames[0]}
              />
              <KeyVal label="Node IAM role ARN" value={nodegroup.nodeRole} copyValue={nodegroup.nodeRole} />
              <KeyVal label="Created at" value={formatClusterDateTime(nodegroup.createdAt)} />
              <KeyVal
                label="Node auto repair"
                value={nodegroup.nodeRepairConfig?.enabled ? 'Enabled' : 'Disabled'}
              />
              {nodegroup.launchTemplate && (nodegroup.launchTemplate.name || nodegroup.launchTemplate.id) && (
                <KeyVal
                  label="Launch template"
                  value={`${nodegroup.launchTemplate.name || nodegroup.launchTemplate.id} (v${nodegroup.launchTemplate.version || 'default'})`}
                />
              )}
            </Grid>
            <Grid item xs={12} md={6}>
              <KeyVal label="Capacity type" value={nodegroup.capacityType || 'ON_DEMAND'} />
              <KeyVal
                label="Scaling configuration"
                value={
                  nodegroup.scalingConfig
                    ? `Desired: ${nodegroup.scalingConfig.desiredSize ?? 0} · Min: ${nodegroup.scalingConfig.minSize ?? 0} · Max: ${nodegroup.scalingConfig.maxSize ?? 0}`
                    : '—'
                }
              />
              <KeyVal
                label="Configure remote access to nodes"
                value={nodegroup.remoteAccess?.ec2SshKey ? `Enabled (${nodegroup.remoteAccess.ec2SshKey})` : 'Off'}
              />
              <KeyVal
                label="Subnets"
                value={
                  nodegroup.subnets && nodegroup.subnets.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 0.5 }}>
                      {nodegroup.subnets.map((sid) => {
                        const meta = subnetMap.get(sid);
                        const pub = meta ? isClusterSubnetPublic(meta) : null;
                        return (
                          <Box key={sid} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                            <Chip
                              size="small"
                              label={meta?.name && meta.name !== sid ? `${meta.name} (${sid})` : sid}
                              variant="outlined"
                              sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                            />
                            {pub !== null && (
                              <Chip
                                size="small"
                                label={pub ? 'Public' : 'Private'}
                                color={pub ? 'primary' : 'default'}
                                variant={pub ? 'filled' : 'outlined'}
                                sx={{ fontWeight: 700, height: 20 }}
                              />
                            )}
                            {meta?.availabilityZone && (
                              <Typography variant="caption" sx={{ color: '#64748b' }}>
                                {meta.cidrBlock ? `${meta.cidrBlock} · ` : ''}
                                {meta.availabilityZone}
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  ) : (
                    '—'
                  )
                }
              />
            </Grid>
          </Grid>
        )}

        {tab === 1 && (
          <Box>
            {ngNodes.length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell><strong>Node name</strong></TableCell>
                      <TableCell><strong>Instance type</strong></TableCell>
                      <TableCell><strong>Capacity type</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell><strong>Pods</strong></TableCell>
                      <TableCell><strong>Created</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ngNodes.map((n) => (
                      <TableRow key={n.instanceId || n.nodeName || n.name} hover>
                        <TableCell>
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => onSelectNode?.(n)}
                            sx={{ p: 0, textTransform: 'none', fontFamily: 'monospace', fontWeight: 700, color: '#2563eb' }}
                          >
                            {n.nodeName || n.name || n.instanceId}
                          </Button>
                        </TableCell>
                        <TableCell>{n.instanceType || '—'}</TableCell>
                        <TableCell>{n.capacityType || '—'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={n.k8sStatus || n.state || 'unknown'}
                            color={(n.k8sStatus || n.state) === 'Ready' || n.state === 'running' ? 'success' : 'warning'}
                          />
                        </TableCell>
                        <TableCell>{n.podCount ?? 0}</TableCell>
                        <TableCell>{formatClusterDateTime(n.createdAt || n.launchTime)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">No EC2/Kubernetes nodes currently active for this node group.</Alert>
            )}
          </Box>
        )}

        {tab === 2 && (
          <Box>
            {healthIssues.length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell><strong>Issue type</strong></TableCell>
                      <TableCell><strong>Description</strong></TableCell>
                      <TableCell><strong>Affected resources</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {healthIssues.map((iss, i) => (
                      <TableRow key={`${iss.code || 'issue'}-${i}`}>
                        <TableCell sx={{ fontWeight: 700 }}>{iss.code || 'Issue'}</TableCell>
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
              <Alert severity="success">
                <strong>Node group healthy</strong> — This node group has no reported health issues.
              </Alert>
            )}
          </Box>
        )}

        {tab === 3 && (
          <Box>
            {labelEntries.length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell><strong>Key</strong></TableCell>
                      <TableCell><strong>Value</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {labelEntries.map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{k}</TableCell>
                        <TableCell>{v || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">This node group does not have any Kubernetes labels.</Alert>
            )}
          </Box>
        )}

        {tab === 4 && (
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <KeyVal
                label="Maximum unavailable"
                value={
                  nodegroup.updateConfig?.maxUnavailablePercentage !== undefined
                    ? `${nodegroup.updateConfig.maxUnavailablePercentage}% of nodes`
                    : `${nodegroup.updateConfig?.maxUnavailable ?? 1} node(s)`
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <KeyVal
                label="Update strategy"
                value={nodegroup.updateConfig?.updateStrategy || 'DEFAULT'}
              />
            </Grid>
          </Grid>
        )}

        {tab === 5 && (
          <Box>
            {taints.length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell><strong>Key</strong></TableCell>
                      <TableCell><strong>Value</strong></TableCell>
                      <TableCell><strong>Effect</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {taints.map((t, i) => (
                      <TableRow key={`${t.key || 'taint'}-${i}`}>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{t.key || '—'}</TableCell>
                        <TableCell>{t.value || '—'}</TableCell>
                        <TableCell>{t.effect || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">This node group does not have any Kubernetes taints.</Alert>
            )}
          </Box>
        )}

        {tab === 6 && (
          <Box>
            {updates.length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell><strong>Update ID</strong></TableCell>
                      <TableCell><strong>Type</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell><strong>Created</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {updates.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{u.id}</TableCell>
                        <TableCell>{u.type || '—'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={u.status || 'Unknown'}
                            color={u.status === 'Successful' ? 'success' : u.status === 'Failed' ? 'error' : 'warning'}
                          />
                        </TableCell>
                        <TableCell>{formatClusterDateTime(u.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">This node group has not been updated.</Alert>
            )}
          </Box>
        )}

        {tab === 7 && (
          <Box>
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
                        <TableCell>{v || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">This node group does not have any AWS tags.</Alert>
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
};
