import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';

const PODS_PER_PAGE = 10;

export interface NodeAllocationMetrics {
  cpu?: {
    capacityMillicores?: number;
    allocatableMillicores?: number;
    systemReservedMillicores?: number;
    workloadReservedMillicores?: number;
    availableMillicores?: number;
  };
  memory?: {
    capacityBytes?: number;
    allocatableBytes?: number;
    systemReservedBytes?: number;
    workloadReservedBytes?: number;
    availableBytes?: number;
  };
  pods?: {
    max?: number;
    used?: number;
    available?: number;
  };
  ephemeralStorage?: {
    capacityBytes?: number;
    allocatableBytes?: number;
    systemReservedBytes?: number;
    availableBytes?: number;
  };
}

export interface ClusterWorkerNode {
  instanceId: string;
  name?: string;
  nodeName?: string;
  nodegroupName?: string;
  instanceType?: string;
  capacityType?: string;
  availabilityZone?: string;
  subnetId?: string;
  vpcId?: string;
  amiId?: string;
  architecture?: string;
  operatingSystem?: string;
  osImage?: string;
  kernelVersion?: string;
  containerRuntimeVersion?: string;
  kubeletVersion?: string;
  kubeProxyVersion?: string;
  privateDnsName?: string;
  privateIpAddress?: string;
  publicIpAddress?: string;
  state?: string;
  k8sStatus?: string;
  launchTime?: string;
  createdAt?: string;
  lastTransitionTime?: string;
  providerID?: string;
  capacity?: Record<string, string>;
  allocatable?: Record<string, string>;
  allocation?: NodeAllocationMetrics;
  conditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
  }>;
  taints?: Array<{ key?: string; value?: string; effect?: string }>;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  addresses?: Array<{ type?: string; address?: string }>;
  podCount?: number;
  rawNode?: Record<string, any>;
}

export interface ClusterPod {
  name: string;
  namespace: string;
  status: string;
  phase?: string;
  ready?: string;
  restarts?: number;
  podIp?: string | null;
  hostIp?: string | null;
  nodeName?: string | null;
  createdAt?: string | null;
  containers?: Array<{
    name?: string;
    image?: string;
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  }>;
}

export const getPodStatusChipColor = (
  status?: string
): 'success' | 'warning' | 'error' | 'default' => {
  const s = (status || '').toLowerCase();
  if (s === 'running' || s === 'ready' || s === 'succeeded') return 'success';
  if (
    s.includes('creating') ||
    s.includes('pending') ||
    s.includes('initializing') ||
    s.includes('terminating')
  ) {
    return 'warning';
  }
  if (
    s.includes('fail') ||
    s.includes('err') ||
    s.includes('backoff') ||
    s === 'notready'
  ) {
    return 'error';
  }
  return 'default';
};

export const formatClusterDateTime = (raw?: string | null): string => {
  if (!raw) return '—';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return String(raw);
  return parsed.toLocaleString();
};

const formatGiB = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 GiB';
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
};

interface DonutSegment {
  label: string;
  value: number;
  displayValue: string;
  color: string;
}

const AllocationRingCard: React.FC<{
  title: string;
  centerPrimary: string;
  centerSecondary: string;
  segments: DonutSegment[];
}> = ({ title, centerPrimary, centerSecondary, segments }) => {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((acc, s) => acc + Math.max(0, s.value), 0);
  let cumulativeOffset = 0;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
      <Typography variant="caption" sx={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ position: 'relative', width: 108, height: 108, flexShrink: 0 }}>
          <svg width="108" height="108" viewBox="0 0 108 108" aria-label={title}>
            <circle
              cx="54"
              cy="54"
              r={radius}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="12"
            />
            {total > 0 &&
              segments.map((seg) => {
                const frac = Math.max(0, seg.value) / total;
                const arc = frac * circumference;
                const offset = -cumulativeOffset;
                cumulativeOffset += arc;
                if (arc <= 0) return null;
                return (
                  <circle
                    key={seg.label}
                    cx="54"
                    cy="54"
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="12"
                    strokeDasharray={`${arc} ${circumference}`}
                    strokeDashoffset={offset}
                    transform="rotate(-90 54 54)"
                  />
                );
              })}
          </svg>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#09090b', lineHeight: 1.1 }}>
              {centerPrimary}
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
              {centerSecondary}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flex: 1, minWidth: 130 }}>
          {segments.map((seg) => {
            const pct = total > 0 ? Math.round((Math.max(0, seg.value) / total) * 100) : 0;
            return (
              <Box key={seg.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    bgcolor: seg.color,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" sx={{ color: '#334155', lineHeight: 1.3 }}>
                  <strong>{seg.label}</strong>: {seg.displayValue} ({pct}%)
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
};

interface NodeDetailsDialogProps {
  node: ClusterWorkerNode | null;
  pods: ClusterPod[];
  onClose: () => void;
}

export const NodeDetailsDialog: React.FC<NodeDetailsDialogProps> = ({ node, pods, onClose }) => {
  const [viewMode, setViewMode] = useState<'structured' | 'raw'>('structured');
  const [copiedJson, setCopiedJson] = useState(false);
  const [podsPage, setPodsPage] = useState(1);

  useEffect(() => {
    setPodsPage(1);
  }, [node?.instanceId, node?.nodeName]);

  const nodePods = useMemo(() => {
    if (!node) return [];
    const targetNames = new Set(
      [node.nodeName, node.name, node.privateDnsName].filter(Boolean) as string[]
    );
    return pods.filter((p) => p.nodeName && targetNames.has(p.nodeName));
  }, [node, pods]);

  const totalPodPages = Math.max(1, Math.ceil(nodePods.length / PODS_PER_PAGE));
  const safePodPage = Math.min(Math.max(1, podsPage), totalPodPages);
  const pagedNodePods = useMemo(
    () => nodePods.slice((safePodPage - 1) * PODS_PER_PAGE, safePodPage * PODS_PER_PAGE),
    [nodePods, safePodPage]
  );

  if (!node) return null;

  const displayName = node.nodeName || node.name || node.instanceId;
  const rawPayload = JSON.stringify(node.rawNode || node, null, 2);
  const labelEntries = Object.entries(node.labels || {});
  const annotationEntries = Object.entries(node.annotations || {});
  const alloc = node.allocation;

  const handleCopyJson = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(rawPayload);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 1500);
  };

  return (
    <Dialog open={Boolean(node)} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle
        sx={{
          bgcolor: '#09090b',
          color: '#ffffff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
          <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'monospace' }}>
            {displayName}
          </Typography>
          <Chip
            size="small"
            label={node.k8sStatus || node.state || 'Unknown'}
            color={getPodStatusChipColor(node.k8sStatus || node.state)}
          />
          {node.instanceType && (
            <Chip
              size="small"
              label={node.instanceType}
              sx={{ bgcolor: 'rgba(59,130,246,0.2)', color: '#93c5fd', fontWeight: 700 }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_, val) => val && setViewMode(val)}
            sx={{
              bgcolor: 'rgba(255,255,255,0.08)',
              '& .MuiToggleButton-root': {
                color: '#cbd5e1',
                borderColor: 'rgba(148,163,184,0.3)',
                px: 1.5,
                py: 0.4,
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'none',
                '&.Mui-selected': {
                  bgcolor: '#2563eb',
                  color: '#ffffff',
                },
              },
            }}
          >
            <ToggleButton value="structured">Structured view</ToggleButton>
            <ToggleButton value="raw">Raw view</ToggleButton>
          </ToggleButtonGroup>
          <IconButton aria-label="Close node details" onClick={onClose} sx={{ color: '#cbd5e1' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {viewMode === 'raw' ? (
          <Paper
            variant="outlined"
            sx={{ p: 2, bgcolor: '#09090b', color: '#e2e8f0', borderRadius: 2 }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
              <Typography variant="caption" sx={{ color: '#60a5fa', fontWeight: 700 }}>
                RAW KUBERNETES NODE &amp; EC2 PAYLOAD
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={copiedJson ? <CheckCircleIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
                onClick={handleCopyJson}
                sx={{ color: '#93c5fd', borderColor: 'rgba(147,197,253,0.4)' }}
              >
                {copiedJson ? 'Copied JSON' : 'Copy JSON'}
              </Button>
            </Box>
            <Box
              component="pre"
              sx={{
                m: 0,
                maxHeight: 460,
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.78rem',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {rawPayload}
            </Box>
          </Paper>
        ) : (
          <>
            {/* Summary Details matching AWS EKS Console Node Inspector */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
                Details
              </Typography>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Grid container spacing={2}>
                  {[
                    { label: 'Status', value: node.k8sStatus || node.state || '—' },
                    { label: 'Kernel version', value: node.kernelVersion || '—' },
                    { label: 'Created', value: formatClusterDateTime(node.createdAt || node.launchTime) },
                    { label: 'Last transition time', value: formatClusterDateTime(node.lastTransitionTime) },
                    { label: 'Node group', value: node.nodegroupName || '—' },
                    { label: 'Container runtime', value: node.containerRuntimeVersion || '—' },
                    {
                      label: 'OS (Architecture)',
                      value: `${node.operatingSystem || 'linux'} (${node.architecture || 'amd64'})`,
                    },
                    { label: 'Instance ID', value: node.instanceId || '—' },
                    { label: 'Kubelet version', value: node.kubeletVersion || '—' },
                    { label: 'OS image', value: node.osImage || '—' },
                    { label: 'AMI ID', value: node.amiId || '—' },
                    { label: 'Instance type', value: node.instanceType || '—' },
                    { label: 'Capacity type', value: node.capacityType || 'ON_DEMAND' },
                    {
                      label: 'Private / Public IP',
                      value: `${node.privateIpAddress || '—'}${node.publicIpAddress ? ` / ${node.publicIpAddress}` : ''}`,
                    },
                    {
                      label: 'AZ / Subnet',
                      value: `${node.availabilityZone || '—'}${node.subnetId ? ` (${node.subnetId})` : ''}`,
                    },
                  ].map((item) => (
                    <Grid item xs={12} sm={6} md={4} key={item.label}>
                      <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600, display: 'block' }}>
                        {item.label}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ color: '#09090b', fontWeight: 600, wordBreak: 'break-all' }}
                      >
                        {item.value}
                      </Typography>
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </Box>

            {/* Capacity Allocation */}
            {alloc && (
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
                  Capacity allocation
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <AllocationRingCard
                      title="CPU"
                      centerPrimary={String(
                        Number(((alloc.cpu?.capacityMillicores || 0) / 1000).toFixed(2))
                      )}
                      centerSecondary="Cores"
                      segments={[
                        {
                          label: 'System reserved',
                          value: alloc.cpu?.systemReservedMillicores || 0,
                          displayValue: `${alloc.cpu?.systemReservedMillicores || 0} m`,
                          color: '#09090b',
                        },
                        {
                          label: 'Workload reserved',
                          value: alloc.cpu?.workloadReservedMillicores || 0,
                          displayValue: `${alloc.cpu?.workloadReservedMillicores || 0} m`,
                          color: '#2563eb',
                        },
                        {
                          label: 'Available',
                          value: alloc.cpu?.availableMillicores || 0,
                          displayValue: `${alloc.cpu?.availableMillicores || 0} m`,
                          color: '#10b981',
                        },
                      ]}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <AllocationRingCard
                      title="Memory"
                      centerPrimary={((alloc.memory?.capacityBytes || 0) / 1024 ** 3).toFixed(2)}
                      centerSecondary="GiB"
                      segments={[
                        {
                          label: 'System reserved',
                          value: alloc.memory?.systemReservedBytes || 0,
                          displayValue: formatGiB(alloc.memory?.systemReservedBytes || 0),
                          color: '#09090b',
                        },
                        {
                          label: 'Workload reserved',
                          value: alloc.memory?.workloadReservedBytes || 0,
                          displayValue: formatGiB(alloc.memory?.workloadReservedBytes || 0),
                          color: '#2563eb',
                        },
                        {
                          label: 'Available',
                          value: alloc.memory?.availableBytes || 0,
                          displayValue: formatGiB(alloc.memory?.availableBytes || 0),
                          color: '#10b981',
                        },
                      ]}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <AllocationRingCard
                      title="Pods"
                      centerPrimary={String(alloc.pods?.max || 0)}
                      centerSecondary="Pods"
                      segments={[
                        {
                          label: 'Used',
                          value: alloc.pods?.used || 0,
                          displayValue: `${alloc.pods?.used || 0} pods`,
                          color: '#2563eb',
                        },
                        {
                          label: 'Available',
                          value: alloc.pods?.available || 0,
                          displayValue: `${alloc.pods?.available || 0} pods`,
                          color: '#10b981',
                        },
                      ]}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <AllocationRingCard
                      title="Ephemeral storage"
                      centerPrimary={((alloc.ephemeralStorage?.capacityBytes || 0) / 1024 ** 3).toFixed(2)}
                      centerSecondary="GiB"
                      segments={[
                        {
                          label: 'System reserved',
                          value: alloc.ephemeralStorage?.systemReservedBytes || 0,
                          displayValue: formatGiB(alloc.ephemeralStorage?.systemReservedBytes || 0),
                          color: '#09090b',
                        },
                        {
                          label: 'Available',
                          value: alloc.ephemeralStorage?.availableBytes || 0,
                          displayValue: formatGiB(alloc.ephemeralStorage?.availableBytes || 0),
                          color: '#10b981',
                        },
                      ]}
                    />
                  </Grid>
                </Grid>
              </Box>
            )}

            {/* Pods scheduled on this node (10 per page like AWS Console) */}
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
                  Pods on Node ({nodePods.length})
                </Typography>

                {nodePods.length > PODS_PER_PAGE && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" sx={{ color: '#64748b', mr: 1 }}>
                      {(safePodPage - 1) * PODS_PER_PAGE + 1}–
                      {Math.min(safePodPage * PODS_PER_PAGE, nodePods.length)} of {nodePods.length}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label="Previous pods page"
                      disabled={safePodPage <= 1}
                      onClick={() => setPodsPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeftIcon fontSize="small" />
                    </IconButton>
                    {Array.from({ length: totalPodPages }, (_, idx) => idx + 1).map((pageNum) => (
                      <Button
                        key={pageNum}
                        size="small"
                        variant={pageNum === safePodPage ? 'contained' : 'text'}
                        aria-label={`Pods page ${pageNum}`}
                        onClick={() => setPodsPage(pageNum)}
                        sx={{
                          minWidth: 28,
                          px: 0.75,
                          py: 0.25,
                          fontWeight: 700,
                          color: pageNum === safePodPage ? '#ffffff' : '#334155',
                        }}
                      >
                        {pageNum}
                      </Button>
                    ))}
                    <IconButton
                      size="small"
                      aria-label="Next pods page"
                      disabled={safePodPage >= totalPodPages}
                      onClick={() => setPodsPage((p) => Math.min(totalPodPages, p + 1))}
                    >
                      <ChevronRightIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )}
              </Box>
              {nodePods.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell><strong>Name</strong></TableCell>
                        <TableCell><strong>Namespace</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                        <TableCell><strong>Ready</strong></TableCell>
                        <TableCell><strong>Restarts</strong></TableCell>
                        <TableCell><strong>Created</strong></TableCell>
                        <TableCell><strong>IP</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pagedNodePods.map((pod) => (
                        <TableRow key={`${pod.namespace}/${pod.name}`}>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{pod.name}</TableCell>
                          <TableCell>{pod.namespace}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={pod.status}
                              color={getPodStatusChipColor(pod.status)}
                            />
                          </TableCell>
                          <TableCell>{pod.ready || '—'}</TableCell>
                          <TableCell>{pod.restarts ?? 0}</TableCell>
                          <TableCell>{formatClusterDateTime(pod.createdAt)}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{pod.podIp || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No pods currently scheduled on this node.</Alert>
              )}
            </Box>

            {/* Conditions */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
                Conditions ({node.conditions?.length || 0})
              </Typography>
              {node.conditions && node.conditions.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell><strong>Type</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                        <TableCell><strong>Message</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {node.conditions.map((cond, idx) => (
                        <TableRow key={`${cond.type}-${idx}`}>
                          <TableCell sx={{ fontWeight: 700 }}>{cond.type}</TableCell>
                          <TableCell>{cond.status}</TableCell>
                          <TableCell>{cond.message || cond.reason || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No Kubernetes node condition telemetry reported.</Alert>
              )}
            </Box>

            {/* Taints */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
                Taints ({node.taints?.length || 0})
              </Typography>
              {node.taints && node.taints.length > 0 ? (
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
                      {node.taints.map((t, idx) => (
                        <TableRow key={`${t.key}-${idx}`}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{t.key || '—'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{t.value || '—'}</TableCell>
                          <TableCell>{t.effect || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No taints have been defined for this node.</Alert>
              )}
            </Box>

            <Divider />

            {/* Labels & Annotations */}
            <Grid container spacing={2.5}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
                  Labels ({labelEntries.length})
                </Typography>
                {labelEntries.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>Key</strong></TableCell>
                          <TableCell><strong>Value</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {labelEntries.map(([k, v]) => (
                          <TableRow key={k}>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>
                              {k}
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>
                              {v}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No labels found.</Alert>
                )}
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
                  Annotations ({annotationEntries.length})
                </Typography>
                {annotationEntries.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>Key</strong></TableCell>
                          <TableCell><strong>Value</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {annotationEntries.map(([k, v]) => (
                          <TableRow key={k}>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>
                              {k}
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>
                              <Tooltip title={v}>
                                <span>{v}</span>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No annotations found.</Alert>
                )}
              </Grid>
            </Grid>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: '#f8fafc' }}>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
