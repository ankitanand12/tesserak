import React, { useCallback, useEffect, useState } from 'react';
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
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  CloudQueue as CloudQueueIcon,
  Delete as DeleteIcon,
  Lock as LockIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Storage as StorageIcon,
  SyncProblem as SyncProblemIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
import { ConfirmDeleteDialog } from '../components/ConfirmDeleteDialog';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { CloudResource } from '../types/platform';
import { fetchWithSwr, invalidateSwrCache, readSwrCache } from '../utils/swrCache';

const SERVICE_BLUEPRINTS = [
  { label: 'S3 Bucket', defaultCost: 12, nodePlaceholder: 'Standard Object Bucket' },
  { label: 'SQS Standard Queue', defaultCost: 8, nodePlaceholder: 'Managed SSE Queue' },
  { label: 'ElastiCache Redis', defaultCost: 48, nodePlaceholder: 'cache.t4g.micro' },
  { label: 'RDS PostgreSQL', defaultCost: 290, nodePlaceholder: 'db.t3.micro' },
];

export const CloudResources: React.FC = () => {
  const navigate = useNavigate();
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';

  const cachedRes = readSwrCache<{
    resources: CloudResource[];
    awsConnected: boolean;
    accountId: string | null;
    awsRegion: string | null;
    error?: string | null;
  }>(userEmail, 'resources');

  const [resources, setResources] = useState<CloudResource[]>(() => cachedRes?.resources ?? []);
  const [awsConnected, setAwsConnected] = useState(() => cachedRes?.awsConnected ?? false);
  const [accountId, setAccountId] = useState<string | null>(() => cachedRes?.accountId ?? null);
  const [awsRegion, setAwsRegion] = useState<string | null>(() => cachedRes?.awsRegion ?? null);
  const [loading, setLoading] = useState(() => cachedRes === undefined);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [modalError, setModalError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CloudResource | null>(null);
  const [deletingResource, setDeletingResource] = useState(false);

  const [name, setName] = useState('');
  const [serviceType, setServiceType] = useState('S3 Bucket');
  const [region, setRegion] = useState('us-east-1');
  const [environment, setEnvironment] = useState<'dev' | 'staging' | 'prod'>('staging');
  const [nodeType, setNodeType] = useState('');
  const [estimatedMonthlyCost, setEstimatedMonthlyCost] = useState<number>(12);
  const [encrypted, setEncrypted] = useState(true);
  const [publicAccess, setPublicAccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchResources = useCallback(
    async (force: boolean = false) => {
      const existing = readSwrCache<{
        resources: CloudResource[];
        awsConnected: boolean;
        accountId: string | null;
        awsRegion: string | null;
      }>(userEmail, 'resources');
      if (existing) {
        setResources(existing.resources);
        setAwsConnected(existing.awsConnected);
        setAccountId(existing.accountId);
        setAwsRegion(existing.awsRegion);
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError('');

      try {
        const parsed = await fetchWithSwr(
          userEmail,
          'resources',
          async () => {
            const url = force
              ? 'http://localhost:8000/api/resources?refresh=true'
              : 'http://localhost:8000/api/resources';
            const res = await fetch(url, {
              headers: { 'x-user-email': userEmail },
            });
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              const detail = errData?.detail;
              const msg =
                typeof detail === 'string'
                  ? detail
                  : detail?.error_description || detail?.message || 'Failed to load AWS resources';
              throw new Error(msg);
            }
            const data = await res.json();
            return {
              resources: (data.resources || []) as CloudResource[],
              awsConnected: Boolean(data.awsConnected),
              accountId: (data.accountId || null) as string | null,
              awsRegion: (data.region || null) as string | null,
              error: (data.error || null) as string | null,
            };
          },
          { force, dedupeWindowMs: 5000 }
        );
        setResources(parsed.resources);
        setAwsConnected(parsed.awsConnected);
        setAccountId(parsed.accountId);
        setAwsRegion(parsed.awsRegion);
        if (parsed.error && parsed.awsConnected) {
          setError(parsed.error);
        }
      } catch (err: any) {
        if (!existing) {
          setError(err.message || 'Unable to connect to backend API');
        }
      } finally {
        setLoading(false);
      }
    },
    [userEmail]
  );

  useEffect(() => {
    fetchResources(false);
  }, [fetchResources]);

  const openProvisionModal = (blueprintLabel: string) => {
    const bp = SERVICE_BLUEPRINTS.find((b) => b.label === blueprintLabel) || SERVICE_BLUEPRINTS[0];
    setServiceType(bp.label);
    setEstimatedMonthlyCost(bp.defaultCost);
    setNodeType(bp.nodePlaceholder);
    setModalError('');
    setDialogOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setSuccessMsg('');
    setSubmitting(true);
    try {
      const res = await fetch('http://localhost:8000/api/resources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail,
        },
        body: JSON.stringify({
          name: name.trim(),
          provider: 'aws',
          serviceType,
          region: region.trim() || awsRegion || 'us-east-1',
          environment,
          nodeType: nodeType.trim() || undefined,
          encrypted,
          publicAccess,
          estimatedMonthlyCost: Number(estimatedMonthlyCost),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError(data.detail || 'AWS provisioning / Guardrail check failed');
        return;
      }
      setDialogOpen(false);
      setName('');
      setSuccessMsg(
        data.status === 'Pending Approval'
          ? `Resource "${data.name}" queued for Guardrail approval (> threshold). Nothing created in AWS yet.`
          : `Created live AWS resource "${data.name}" (${data.serviceType}).`
      );
      invalidateSwrCache(userEmail, 'resources');
      invalidateSwrCache(userEmail, 'overview');
      invalidateSwrCache(userEmail, 'guardrails');
      await fetchResources(true);
    } catch (err: any) {
      setModalError(err.message || 'Provisioning request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReconcileDrift = async (resourceId: string) => {
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(
        `http://localhost:8000/api/resources/${resourceId}/drift-check`,
        {
          method: 'POST',
          headers: { 'x-user-email': userEmail },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'AWS drift remediation failed');
        return;
      }
      setSuccessMsg(data.message || 'AWS resource remediated.');
      invalidateSwrCache(userEmail, 'resources');
      invalidateSwrCache(userEmail, 'overview');
      invalidateSwrCache(userEmail, 'guardrails');
      await fetchResources(true);
    } catch {
      setError('Failed to remediate AWS drift');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingResource(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(
        `http://localhost:8000/api/resources/${encodeURIComponent(deleteTarget.id)}?environment=${encodeURIComponent(deleteTarget.environment)}`,
        {
          method: 'DELETE',
          headers: { 'x-user-email': userEmail },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Delete failed or blocked by Guardrails');
        return;
      }
      setSuccessMsg(data.message || 'Deleted cleanly.');
      setDeleteTarget(null);
      invalidateSwrCache(userEmail, 'resources');
      invalidateSwrCache(userEmail, 'overview');
      invalidateSwrCache(userEmail, 'guardrails');
      await fetchResources(true);
    } catch {
      setError('Delete request failed');
    } finally {
      setDeletingResource(false);
    }
  };

  const driftedCount = resources.filter((r) => r.driftStatus === 'Drifted').length;
  const pendingCount = resources.filter((r) => r.status === 'Pending Approval').length;
  const searchNeedle = searchQuery.trim().toLowerCase();
  const filteredResources = searchNeedle
    ? resources.filter(
        (r) =>
          r.name.toLowerCase().includes(searchNeedle) ||
          r.serviceType.toLowerCase().includes(searchNeedle) ||
          r.region.toLowerCase().includes(searchNeedle) ||
          r.environment.toLowerCase().includes(searchNeedle) ||
          (r.status || '').toLowerCase().includes(searchNeedle)
      )
    : resources;

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
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', letterSpacing: '-0.02em' }}>
              Cloud Resources
            </Typography>
            <Chip
              label={awsConnected ? `AWS ${accountId} (${awsRegion})` : 'AWS Not Connected'}
              size="small"
              sx={{
                bgcolor: '#09090b',
                color: awsConnected ? '#93c5fd' : '#fca5a5',
                fontWeight: 600,
                border: `1px solid ${awsConnected ? '#2563eb' : '#ef4444'}`,
              }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#475569' }}>
            Live AWS RDS, ElastiCache Redis, S3 Buckets & SQS discovery, real Boto3 provisioning, and encryption/public-access drift remediation.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            disabled={syncing}
            startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
            onClick={async () => {
              setSyncing(true);
              setSuccessMsg('');
              invalidateSwrCache(userEmail, 'resources');
              try {
                await fetchResources(true);
                setSuccessMsg('Live AWS inventory synchronized.');
              } finally {
                setSyncing(false);
              }
            }}
            sx={{ borderColor: '#09090b', color: '#09090b' }}
          >
            {syncing ? 'Syncing...' : 'Sync AWS'}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!awsConnected}
            onClick={() => openProvisionModal('S3 Bucket')}
          >
            Provision AWS Resource
          </Button>
        </Box>
      </Box>

      {!loading && !awsConnected && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/integrations')}>
              Connect AWS IAM
            </Button>
          }
          sx={{ borderRadius: 2 }}
        >
          No active AWS IAM connector found. Connect real AWS IAM credentials in Integrations to discover and provision real AWS services.
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert severity="info" onClose={() => setSuccessMsg('')} sx={{ borderRadius: 2 }}>
          {successMsg}
        </Alert>
      )}

      <Grid container spacing={2.5}>
        <Grid item xs={12} sm={4}>
          <Perspective3DCard sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
              Live Discovered Resources
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mt: 0.5 }}>
              {resources.length}
            </Typography>
            <Typography variant="caption" sx={{ color: '#2563eb', fontWeight: 600 }}>
              {pendingCount} pending guardrail approval
            </Typography>
          </Perspective3DCard>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Perspective3DCard sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
              Provision via Blueprint
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
              {SERVICE_BLUEPRINTS.map((bp) => (
                <Button
                  key={bp.label}
                  size="small"
                  variant="outlined"
                  disabled={!awsConnected}
                  startIcon={<CloudQueueIcon fontSize="small" />}
                  onClick={() => openProvisionModal(bp.label)}
                  sx={{ fontSize: '0.72rem', borderColor: 'rgba(15,23,42,0.2)', color: '#09090b' }}
                >
                  {bp.label}
                </Button>
              ))}
            </Box>
          </Perspective3DCard>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Perspective3DCard
            sx={{
              p: 2.5,
              bgcolor: '#09090b',
              color: '#ffffff',
              border: '1px solid rgba(59, 130, 246, 0.45)',
            }}
          >
            <Typography variant="caption" sx={{ color: '#93c5fd', fontWeight: 700, textTransform: 'uppercase' }}>
              Security & Encryption Drift
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, mt: 0.5 }}>
              {driftedCount === 0 ? 'All Compliant' : `${driftedCount} Drifted`}
            </Typography>
            <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
              Live Boto3 encryption & public-access checks
            </Typography>
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
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1.5,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <StorageIcon sx={{ color: '#60a5fa', fontSize: 20 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Live AWS Cloud Inventory
            </Typography>
            <Chip
              size="small"
              label={
                searchNeedle
                  ? `${filteredResources.length} of ${resources.length}`
                  : `${resources.length}`
              }
              sx={{ bgcolor: 'rgba(59,130,246,0.2)', color: '#93c5fd', fontWeight: 700 }}
            />
          </Box>
          <TextField
            size="small"
            placeholder="Search resources, service, region..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#94a3b8', fontSize: 18 }} />
                </InputAdornment>
              ),
            }}
            sx={{
              minWidth: { xs: '100%', sm: 280 },
              bgcolor: 'rgba(255,255,255,0.08)',
              borderRadius: 1.5,
              '& input': { color: '#ffffff', fontSize: '0.85rem' },
              '& fieldset': { borderColor: 'rgba(148,163,184,0.3)' },
            }}
          />
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f8fafc' }}>
                <TableCell sx={{ fontWeight: 700, color: '#09090b' }}>Resource</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#09090b' }}>Service / Detail</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#09090b' }}>Env</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#09090b' }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#09090b' }}>Compliance</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, color: '#09090b' }}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    Querying live AWS services...
                  </TableCell>
                </TableRow>
              ) : filteredResources.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: '#64748b' }}>
                    {resources.length > 0
                      ? `No resources match "${searchQuery}".`
                      : awsConnected
                      ? 'No RDS, ElastiCache, S3, or SQS resources found in this AWS account yet.'
                      : 'Connect an AWS IAM account in Integrations to discover live resources.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredResources.map((res) => (
                  <TableRow key={res.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#09090b' }}>
                        {res.name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        {res.region} · {res.source === 'pending-approval' ? 'Queued' : 'Live AWS'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#0f172a' }}>
                        {res.serviceType}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        {res.guardrailNotes[0] || res.spec}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={res.environment}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          fontSize: '0.7rem',
                          bgcolor: res.environment === 'prod' ? '#09090b' : '#eff6ff',
                          color: res.environment === 'prod' ? '#ffffff' : '#1d4ed8',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={res.status}
                        size="small"
                        sx={{
                          fontWeight: 600,
                          bgcolor: res.status === 'Pending Approval' ? '#fef3c7' : '#eff6ff',
                          color: res.status === 'Pending Approval' ? '#92400e' : '#1d4ed8',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {res.driftStatus === 'In Sync' ? (
                        <Chip
                          icon={<CheckCircleIcon sx={{ fontSize: 15, color: '#2563eb !important' }} />}
                          label="In Sync"
                          size="small"
                          variant="outlined"
                          sx={{ borderColor: 'rgba(37,99,235,0.3)', color: '#1d4ed8' }}
                        />
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          startIcon={<SyncProblemIcon />}
                          onClick={() => handleReconcileDrift(res.id)}
                          sx={{ fontSize: '0.72rem', py: 0.25 }}
                        >
                          Remediate
                        </Button>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        {res.encrypted && (
                          <Tooltip title="At-Rest Encryption Enabled">
                            <LockIcon sx={{ fontSize: 16, color: '#2563eb' }} />
                          </Tooltip>
                        )}
                        <Tooltip title="Delete Resource (checked by Guardrails)">
                          <IconButton
                            size="small"
                            aria-label={`Delete ${res.name}`}
                            onClick={() => setDeleteTarget(res)}
                          >
                            <DeleteIcon fontSize="small" sx={{ color: '#475569' }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Perspective3DCard>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCreate}>
          <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
            Provision Real AWS Resource
          </DialogTitle>
          <DialogContent sx={{ bgcolor: '#ffffff', pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {modalError && <Alert severity="error">{modalError}</Alert>}
            <TextField
              label="AWS Resource Identifier / Bucket Name"
              placeholder="e.g. tesserak-app-artifacts-2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              size="small"
              fullWidth
            />
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>AWS Service</InputLabel>
                  <Select
                    label="AWS Service"
                    value={serviceType}
                    onChange={(e) => {
                      const val = e.target.value;
                      setServiceType(val);
                      const bp = SERVICE_BLUEPRINTS.find((b) => b.label === val);
                      if (bp) {
                        setEstimatedMonthlyCost(bp.defaultCost);
                        setNodeType(bp.nodePlaceholder);
                      }
                    }}
                  >
                    {SERVICE_BLUEPRINTS.map((p) => (
                      <MenuItem key={p.label} value={p.label}>
                        {p.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Environment</InputLabel>
                  <Select
                    label="Environment"
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as any)}
                  >
                    <MenuItem value="dev">dev</MenuItem>
                    <MenuItem value="staging">staging</MenuItem>
                    <MenuItem value="prod">prod</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="AWS Region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  size="small"
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Est. Monthly Cost ($ USD)"
                  type="number"
                  value={estimatedMonthlyCost}
                  onChange={(e) => setEstimatedMonthlyCost(Number(e.target.value))}
                  helperText="Above $250 triggers Guardrail Approval"
                  size="small"
                  fullWidth
                />
              </Grid>
            </Grid>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <FormControlLabel
                control={
                  <Switch checked={encrypted} onChange={(e) => setEncrypted(e.target.checked)} />
                }
                label="KMS / SSE Encryption"
              />
              <FormControlLabel
                control={
                  <Switch checked={publicAccess} onChange={(e) => setPublicAccess(e.target.checked)} />
                }
                label="Allow Public Access"
              />
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5, bgcolor: '#f8fafc' }}>
            <Button onClick={() => setDialogOpen(false)} sx={{ color: '#475569' }}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={submitting || !name.trim()}>
              {submitting ? 'Calling AWS API...' : 'Create in AWS'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDeleteDialog
        open={Boolean(deleteTarget)}
        title="Delete AWS Resource?"
        description={
          <>
            This will permanently delete <strong>{deleteTarget?.name}</strong> ({deleteTarget?.serviceType} in{' '}
            {deleteTarget?.region}). Active Guardrail deletion protections will be evaluated.
          </>
        }
        loading={deletingResource}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </Box>
  );
};
