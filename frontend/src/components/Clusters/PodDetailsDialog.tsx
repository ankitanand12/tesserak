import React, { useCallback, useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  DeleteOutline as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Refresh as RefreshIcon,
  RestartAlt as RestartIcon,
} from '@mui/icons-material';
import {
  ClusterPod,
  ClusterPodContainer,
  formatClusterDateTime,
  getPodStatusChipColor,
} from './NodeDetailsDialog';

export interface PodEventItem {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  source?: string;
  firstSeen?: string;
  lastSeen?: string;
}

interface PodDetailsDialogProps {
  pod: ClusterPod | null;
  clusterName?: string;
  accountId?: string;
  userEmail?: string;
  readOnly?: boolean;
  actionPending?: boolean;
  onClose: () => void;
  onRestart?: (pod: ClusterPod) => void;
  onDelete?: (pod: ClusterPod) => void;
  onSelectNode?: (nodeName: string) => void;
}

const KeyVal: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <Box
    sx={{
      py: 1,
      borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
      display: 'flex',
      flexDirection: 'column',
      gap: 0.25,
    }}
  >
    <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
      {label}
    </Typography>
    <Typography variant="body2" component="div" sx={{ color: '#09090b', fontWeight: 600, wordBreak: 'break-all' }}>
      {value ?? '—'}
    </Typography>
  </Box>
);

const ContainerAccordion: React.FC<{ container: ClusterPodContainer }> = ({ container }) => {
  const stateLabel = container.state?.reason || container.state?.status || (container.ready ? 'Running' : 'Unknown');
  const reqEntries = Object.entries(container.requests || {});
  const limEntries = Object.entries(container.limits || {});
  const ports = container.ports || [];
  const mounts = container.volumeMounts || [];
  const envNames = container.envNames || [];

  return (
    <Accordion defaultExpanded={container.state?.status !== 'Running'} variant="outlined" sx={{ mb: 1 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', width: '100%', pr: 1 }}>
          <Typography variant="subtitle2" sx={{ fontFamily: 'monospace', fontWeight: 800, color: '#09090b' }}>
            {container.name || 'container'}
          </Typography>
          {container.isInit && (
            <Chip size="small" label="Init container" variant="outlined" sx={{ fontWeight: 700 }} />
          )}
          <Chip
            size="small"
            label={stateLabel}
            color={getPodStatusChipColor(stateLabel)}
            sx={{ fontWeight: 700 }}
          />
          <Chip
            size="small"
            label={container.ready ? 'Ready' : 'Not Ready'}
            color={container.ready ? 'success' : 'warning'}
            variant="outlined"
          />
          <Typography variant="caption" sx={{ color: '#64748b', ml: 'auto', fontFamily: 'monospace' }}>
            Restarts: {container.restartCount ?? 0}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ bgcolor: '#f8fafc', pt: 1.5 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <KeyVal label="Image" value={<Box component="span" sx={{ fontFamily: 'monospace' }}>{container.image || '—'}</Box>} />
            <KeyVal label="Image Pull Policy" value={container.imagePullPolicy || '—'} />
            <KeyVal
              label="Container ID"
              value={<Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{container.containerId || '—'}</Box>}
            />
            <KeyVal
              label="Resource Requests"
              value={reqEntries.length > 0 ? reqEntries.map(([k, v]) => `${k}: ${v}`).join(' · ') : 'None'}
            />
            <KeyVal
              label="Resource Limits"
              value={limEntries.length > 0 ? limEntries.map(([k, v]) => `${k}: ${v}`).join(' · ') : 'None'}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <KeyVal
              label="Current State"
              value={
                container.state ? (
                  <Box>
                    <strong>{container.state.status}</strong>
                    {container.state.reason ? ` (${container.state.reason})` : ''}
                    {container.state.startedAt ? ` · Started ${formatClusterDateTime(container.state.startedAt)}` : ''}
                    {container.state.message && (
                      <Typography variant="caption" display="block" sx={{ color: '#b91c1c', mt: 0.25 }}>
                        {container.state.message}
                      </Typography>
                    )}
                  </Box>
                ) : (
                  '—'
                )
              }
            />
            {container.lastState && (
              <KeyVal
                label="Last Termination State"
                value={
                  <Box>
                    <strong>{container.lastState.status}</strong>
                    {container.lastState.reason ? ` (${container.lastState.reason})` : ''}
                    {container.lastState.exitCode !== undefined ? ` · exit ${container.lastState.exitCode}` : ''}
                    {container.lastState.finishedAt ? ` · ${formatClusterDateTime(container.lastState.finishedAt)}` : ''}
                  </Box>
                }
              />
            )}
            <KeyVal
              label="Ports"
              value={
                ports.length > 0
                  ? ports
                      .map((p) => `${p.containerPort}/${p.protocol || 'TCP'}${p.name ? ` (${p.name})` : ''}`)
                      .join(', ')
                  : 'None'
              }
            />
            <KeyVal
              label="Environment Variables"
              value={envNames.length > 0 ? envNames.join(', ') : 'None'}
            />
          </Grid>
        </Grid>

        {mounts.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
              Volume Mounts
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 0.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#ffffff' }}>
                    <TableCell><strong>Volume</strong></TableCell>
                    <TableCell><strong>Mount Path</strong></TableCell>
                    <TableCell><strong>Mode</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mounts.map((m, idx) => (
                    <TableRow key={`${m.name || 'mnt'}-${idx}`}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{m.name || '—'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{m.mountPath || '—'}</TableCell>
                      <TableCell>{m.readOnly ? 'Read-Only' : 'Read/Write'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
};

export const PodDetailsDialog: React.FC<PodDetailsDialogProps> = ({
  pod,
  clusterName,
  accountId,
  userEmail,
  readOnly = false,
  actionPending = false,
  onClose,
  onRestart,
  onDelete,
  onSelectNode,
}) => {
  const [viewMode, setViewMode] = useState<'structured' | 'raw'>('structured');
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [events, setEvents] = useState<PodEventItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsWarning, setEventsWarning] = useState('');

  const fetchEvents = useCallback(
    async (silent: boolean = false) => {
      if (!clusterName || !pod?.namespace || !pod?.name) return;
      if (!silent) {
        setEventsLoading(true);
      }
      try {
        const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
        const res = await fetch(
          `http://localhost:8000/clusters/${encodeURIComponent(clusterName)}/pods/${encodeURIComponent(
            pod.namespace
          )}/${encodeURIComponent(pod.name)}/events${qs}`,
          {
            headers: userEmail ? { 'x-user-email': userEmail } : {},
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.detail || 'Unable to fetch pod events');
        }
        setEvents(Array.isArray(data.events) ? data.events : []);
        setEventsWarning(data.warning || '');
      } catch (err: any) {
        setEventsWarning(err?.message || 'Unable to fetch live pod events');
      } finally {
        if (!silent) {
          setEventsLoading(false);
        }
      }
    },
    [clusterName, pod?.namespace, pod?.name, accountId, userEmail]
  );

  useEffect(() => {
    if (!pod || !clusterName) {
      setEvents([]);
      setEventsWarning('');
      return;
    }
    fetchEvents(false);
    const intervalId = window.setInterval(() => {
      fetchEvents(true);
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [pod, clusterName, fetchEvents]);

  if (!pod) return null;

  const containers = pod.containers || [];
  const initContainers = pod.initContainers || [];
  const conditions = pod.conditions || [];
  const volumes = pod.volumes || [];
  const labels = Object.entries(pod.labels || {});
  const owners = pod.controlledBy || [];
  const rawJsonString = JSON.stringify(pod.raw || pod, null, 2);

  return (
    <Dialog open={Boolean(pod)} onClose={onClose} maxWidth="lg" fullWidth>
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
            {pod.name}
          </Typography>
          <Chip size="small" label={pod.namespace} sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#ffffff', fontWeight: 700 }} />
          <Chip
            size="small"
            label={pod.status}
            color={getPodStatusChipColor(pod.status)}
            sx={{ fontWeight: 700 }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_, v) => v && setViewMode(v)}
            sx={{
              bgcolor: 'rgba(255,255,255,0.08)',
              '& .MuiToggleButton-root': {
                color: '#cbd5e1',
                borderColor: 'rgba(255,255,255,0.2)',
                textTransform: 'none',
                px: 1.5,
                py: 0.4,
                fontWeight: 600,
              },
              '& .MuiToggleButton-root.Mui-selected': {
                color: '#ffffff',
                bgcolor: '#2563eb',
              },
            }}
          >
            <ToggleButton value="structured">Structured view</ToggleButton>
            <ToggleButton value="raw">Raw view</ToggleButton>
          </ToggleButtonGroup>

          {!readOnly && onRestart && (
            <Button
              size="small"
              variant="outlined"
              disabled={actionPending}
              startIcon={<RestartIcon fontSize="small" />}
              onClick={() => onRestart(pod)}
              sx={{ color: '#93c5fd', borderColor: 'rgba(147, 197, 253, 0.5)' }}
            >
              Restart Pod
            </Button>
          )}
          {!readOnly && onDelete && (
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={actionPending}
              startIcon={<DeleteIcon fontSize="small" />}
              onClick={() => onDelete(pod)}
            >
              Delete Pod
            </Button>
          )}
          <IconButton aria-label="Close pod details" onClick={onClose} sx={{ color: '#cbd5e1' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5, pb: 3 }}>
        {viewMode === 'raw' ? (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.25 }}>
              <Typography variant="caption" sx={{ fontWeight: 800, color: '#475569' }}>
                RAW KUBERNETES POD MANIFEST &amp; STATUS
              </Typography>
              <Button
                size="small"
                startIcon={<CopyIcon fontSize="small" />}
                onClick={() => {
                  navigator.clipboard?.writeText(rawJsonString);
                  setCopiedRaw(true);
                  setTimeout(() => setCopiedRaw(false), 1200);
                }}
              >
                {copiedRaw ? 'Copied JSON' : 'Copy JSON'}
              </Button>
            </Box>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: '#09090b',
                color: '#e2e8f0',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                maxHeight: 520,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {rawJsonString}
            </Paper>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Details summary card matching AWS Pod Details */}
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                Details
              </Typography>
              <Grid container spacing={2.5}>
                <Grid item xs={12} sm={6} md={4}>
                  <KeyVal
                    label="Status"
                    value={
                      <Chip
                        size="small"
                        label={pod.status}
                        color={getPodStatusChipColor(pod.status)}
                        sx={{ fontWeight: 700 }}
                      />
                    }
                  />
                  <KeyVal
                    label="Controlled by"
                    value={
                      owners.length > 0
                        ? owners.map((o) => `${o.kind || 'Owner'}/${o.name || ''}`).join(', ')
                        : 'Standalone Pod (No Controller)'
                    }
                  />
                  <KeyVal
                    label="Pod IP"
                    value={<Box component="span" sx={{ fontFamily: 'monospace' }}>{pod.podIp || '—'}</Box>}
                  />
                  <KeyVal label="QoS Class" value={pod.qosClass || '—'} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <KeyVal label="Created" value={formatClusterDateTime(pod.createdAt)} />
                  <KeyVal
                    label="Last transition time"
                    value={formatClusterDateTime(pod.lastTransitionTime)}
                  />
                  <KeyVal
                    label="Host IP"
                    value={<Box component="span" sx={{ fontFamily: 'monospace' }}>{pod.hostIp || '—'}</Box>}
                  />
                  <KeyVal label="Service Account" value={pod.serviceAccountName || 'default'} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <KeyVal label="Namespace" value={pod.namespace} />
                  <KeyVal
                    label="Node"
                    value={
                      pod.nodeName && onSelectNode ? (
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => onSelectNode(pod.nodeName!)}
                          sx={{ p: 0, textTransform: 'none', fontFamily: 'monospace', fontWeight: 700, color: '#2563eb' }}
                        >
                          {pod.nodeName}
                        </Button>
                      ) : (
                        <Box component="span" sx={{ fontFamily: 'monospace' }}>{pod.nodeName || 'Unscheduled'}</Box>
                      )
                    }
                  />
                  <KeyVal
                    label="Ready / Restarts"
                    value={`${pod.ready || '0/0'} containers · ${pod.restarts ?? 0} restarts`}
                  />
                  <KeyVal label="Restart Policy" value={pod.restartPolicy || 'Always'} />
                </Grid>
              </Grid>
            </Paper>

            {/* Containers & Init Containers */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#09090b', mb: 1.25 }}>
                Containers ({containers.length})
              </Typography>
              {containers.length > 0 ? (
                containers.map((c, idx) => (
                  <ContainerAccordion key={`${c.name || 'c'}-${idx}`} container={c} />
                ))
              ) : (
                <Alert severity="info">No container specs reported for this pod.</Alert>
              )}

              {initContainers.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#475569', mb: 1 }}>
                    Init Containers ({initContainers.length})
                  </Typography>
                  {initContainers.map((c, idx) => (
                    <ContainerAccordion key={`init-${c.name || 'c'}-${idx}`} container={c} />
                  ))}
                </Box>
              )}
            </Box>

            <Divider />

            {/* Pod Conditions */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#09090b', mb: 1.25 }}>
                Conditions ({conditions.length})
              </Typography>
              {conditions.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell><strong>Type</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                        <TableCell><strong>Last Transition</strong></TableCell>
                        <TableCell><strong>Reason</strong></TableCell>
                        <TableCell><strong>Message</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {conditions.map((cond, idx) => (
                        <TableRow key={`${cond.type || 'cond'}-${idx}`}>
                          <TableCell sx={{ fontWeight: 700 }}>{cond.type || '—'}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={cond.status || 'Unknown'}
                              color={cond.status === 'True' ? 'success' : 'warning'}
                            />
                          </TableCell>
                          <TableCell>{formatClusterDateTime(cond.lastTransitionTime)}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{cond.reason || '—'}</TableCell>
                          <TableCell>{cond.message || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No pod conditions reported.</Alert>
              )}
            </Box>

            {/* Live Kubernetes Pod Events */}
            <Box>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1,
                  mb: 1,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b' }}>
                    Events ({events.length})
                  </Typography>
                  {clusterName && (
                    <Chip
                      size="small"
                      label="Live · Auto-refresh 5s"
                      color="primary"
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  )}
                </Box>
                {clusterName && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={eventsLoading ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
                    onClick={() => fetchEvents(false)}
                    disabled={eventsLoading}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    Refresh Events
                  </Button>
                )}
              </Box>
              {eventsWarning && (
                <Alert severity="warning" sx={{ mb: 1.25 }}>
                  {eventsWarning}
                </Alert>
              )}
              {eventsLoading && events.length === 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 2 }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">
                    Fetching live Kubernetes pod events...
                  </Typography>
                </Box>
              ) : events.length > 0 ? (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell><strong>Type</strong></TableCell>
                        <TableCell><strong>Reason</strong></TableCell>
                        <TableCell><strong>Count</strong></TableCell>
                        <TableCell><strong>Source</strong></TableCell>
                        <TableCell><strong>Message</strong></TableCell>
                        <TableCell><strong>Last Seen</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {events.map((ev, idx) => (
                        <TableRow key={`${ev.reason || 'event'}-${ev.lastSeen || idx}-${idx}`}>
                          <TableCell>
                            <Chip
                              size="small"
                              label={ev.type || 'Normal'}
                              color={ev.type === 'Warning' ? 'warning' : 'default'}
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                            {ev.reason || '—'}
                          </TableCell>
                          <TableCell>{ev.count ?? 1}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                            {ev.source || '—'}
                          </TableCell>
                          <TableCell sx={{ minWidth: 260 }}>{ev.message || '—'}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {formatClusterDateTime(ev.lastSeen || ev.firstSeen)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">
                  {clusterName
                    ? 'No recent Kubernetes events found for this pod yet (auto-refreshing every 5s).'
                    : 'Live events require cluster context.'}
                </Alert>
              )}
            </Box>

            {/* Volumes & Labels */}
            {(volumes.length > 0 || labels.length > 0) && (
              <Grid container spacing={2.5}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                    Volumes ({volumes.length})
                  </Typography>
                  {volumes.length > 0 ? (
                    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      {volumes.map((v, i) => (
                        <Chip
                          key={`${v.name || 'vol'}-${i}`}
                          size="small"
                          label={`${v.name || 'volume'} (${v.source || 'volume'})`}
                          variant="outlined"
                          sx={{ fontFamily: 'monospace' }}
                        />
                      ))}
                    </Paper>
                  ) : (
                    <Typography variant="body2" sx={{ color: '#64748b' }}>None</Typography>
                  )}
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b', mb: 1 }}>
                    Labels ({labels.length})
                  </Typography>
                  {labels.length > 0 ? (
                    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      {labels.map(([k, v]) => (
                        <Chip
                          key={k}
                          size="small"
                          label={`${k}=${v}`}
                          variant="outlined"
                          sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                        />
                      ))}
                    </Paper>
                  ) : (
                    <Typography variant="body2" sx={{ color: '#64748b' }}>None</Typography>
                  )}
                </Grid>
              </Grid>
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
