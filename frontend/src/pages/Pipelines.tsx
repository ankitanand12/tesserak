import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import {
  AccountTree as PipelineIcon,
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon,
  Error as ErrorIcon,
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon,
  Terminal as TerminalIcon,
} from '@mui/icons-material';
import { useLocation } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
import { ConfirmDeleteDialog } from '../components/ConfirmDeleteDialog';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { ClusterTarget, IntegrationItem, PipelineItem } from '../types/platform';
import { fetchWithSwr, invalidateSwrCache, readSwrCache } from '../utils/swrCache';

export const Pipelines: React.FC = () => {
  const location = useLocation();
  const requestedPipelineId = new URLSearchParams(location.search).get('pipelineId');
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';

  const cachedPip = readSwrCache<{
    pipelines: PipelineItem[];
    clusterTargets: ClusterTarget[];
    gitIntegrations: IntegrationItem[];
  }>(userEmail, 'pipelines');

  const [pipelines, setPipelines] = useState<PipelineItem[]>(() => cachedPip?.pipelines ?? []);
  const [clusterTargets, setClusterTargets] = useState<ClusterTarget[]>(
    () => cachedPip?.clusterTargets ?? []
  );
  const [gitIntegrations, setGitIntegrations] = useState<IntegrationItem[]>(
    () => cachedPip?.gitIntegrations ?? []
  );
  const [selectedLogPipelineId, setSelectedLogPipelineId] = useState<string | null>(
    requestedPipelineId || cachedPip?.pipelines?.[0]?.id || null
  );
  const hasAutoSelectedLogRef = useRef<boolean>(
    Boolean(requestedPipelineId || (cachedPip?.pipelines?.length ?? 0) > 0)
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PipelineItem | null>(null);
  const [cleanupClusterOnDelete, setCleanupClusterOnDelete] = useState(true);
  const [deletingPipeline, setDeletingPipeline] = useState(false);

  const [name, setName] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [targetCluster, setTargetCluster] = useState('');
  const [customCluster, setCustomCluster] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [manifestPath, setManifestPath] = useState('.');
  const [dockerfilePath, setDockerfilePath] = useState('');
  const [imageTag, setImageTag] = useState('');
  const [gitIntegrationId, setGitIntegrationId] = useState('');

  const loadPipelines = useCallback(
    async (force: boolean = false) => {
      try {
        const bundle = await fetchWithSwr(
          userEmail,
          'pipelines',
          async () => {
            const [pipRes, tgtRes, intRes] = await Promise.all([
              fetch('http://localhost:8000/api/pipelines', {
                headers: { 'x-user-email': userEmail },
              }),
              fetch('http://localhost:8000/api/cluster-targets', {
                headers: { 'x-user-email': userEmail },
              }),
              fetch('http://localhost:8000/api/integrations', {
                headers: { 'x-user-email': userEmail },
              }),
            ]);
            const nextPip: PipelineItem[] = pipRes.ok ? await pipRes.json() : [];
            const nextTargets: ClusterTarget[] = tgtRes.ok ? await tgtRes.json() : [];
            const ints: IntegrationItem[] = intRes.ok ? await intRes.json() : [];
            return {
              pipelines: nextPip,
              clusterTargets: nextTargets,
              gitIntegrations: ints.filter((i) => i.category === 'scm'),
            };
          },
          { force, dedupeWindowMs: 4000 }
        );

        setPipelines(bundle.pipelines);
        if (bundle.pipelines.length > 0 && !hasAutoSelectedLogRef.current) {
          hasAutoSelectedLogRef.current = true;
          setSelectedLogPipelineId(bundle.pipelines[0].id);
        }
        setClusterTargets(bundle.clusterTargets);
        if (bundle.clusterTargets.length > 0) {
          setTargetCluster((prev) => prev || bundle.clusterTargets[0].id);
        }
        setGitIntegrations(bundle.gitIntegrations);
      } catch {
        setError('Unable to reach backend CI/CD runner');
      }
    },
    [userEmail]
  );

  useEffect(() => {
    if (requestedPipelineId) {
      hasAutoSelectedLogRef.current = true;
      setSelectedLogPipelineId(requestedPipelineId);
    }
  }, [requestedPipelineId]);

  useEffect(() => {
    loadPipelines(false);
  }, [loadPipelines]);

  // Poll automatically while any pipeline is actively running git/docker/kubectl
  useEffect(() => {
    const anyRunning = pipelines.some((p) => p.status === 'Running');
    if (!anyRunning) return;
    const timer = setInterval(() => loadPipelines(true), 1500);
    return () => clearInterval(timer);
  }, [pipelines, loadPipelines]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setSubmitting(true);
    const chosenTarget = targetCluster === '__custom__' ? customCluster.trim() : targetCluster;
    if (!chosenTarget) {
      setModalError('Select a real AWS EKS / kubectl cluster target (or enter context name).');
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('http://localhost:8000/api/pipelines', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail,
        },
        body: JSON.stringify({
          name: name.trim(),
          repositoryUrl: repositoryUrl.trim(),
          branch: branch.trim() || 'main',
          targetCluster: chosenTarget,
          namespace: namespace.trim() || 'default',
          manifestPath: manifestPath.trim() || '.',
          dockerfilePath: dockerfilePath.trim() || undefined,
          imageTag: imageTag.trim() || undefined,
          gitIntegrationId: gitIntegrationId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError(data.detail || 'Git remote verification failed');
        return;
      }
      setCreateOpen(false);
      setName('');
      setRepositoryUrl('');
      setDockerfilePath('');
      setImageTag('');
      hasAutoSelectedLogRef.current = true;
      setSelectedLogPipelineId(data.id);
      setNotice(`Git verified (${data.verifiedRemoteSha}). Pipeline "${data.name}" ready to run.`);
      invalidateSwrCache(userEmail, 'pipelines');
      invalidateSwrCache(userEmail, 'overview');
      await loadPipelines(true);
    } catch (err: any) {
      setModalError(err.message || 'Pipeline creation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrigger = async (pipeline: PipelineItem) => {
    setError('');
    setNotice('');
    try {
      const res = await fetch(`http://localhost:8000/api/pipelines/${pipeline.id}/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail,
        },
        body: JSON.stringify({ branch: pipeline.branch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Failed to trigger pipeline run');
        return;
      }
      hasAutoSelectedLogRef.current = true;
      setSelectedLogPipelineId(pipeline.id);
      setNotice(`Executing "${pipeline.name}" on backend (git clone → scan → kubectl apply)...`);
      invalidateSwrCache(userEmail, 'pipelines');
      invalidateSwrCache(userEmail, 'overview');
      await loadPipelines(true);
    } catch {
      setError('Failed to dispatch pipeline run');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingPipeline(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(
        `http://localhost:8000/api/pipelines/${encodeURIComponent(deleteTarget.id)}?cleanup_cluster=${cleanupClusterOnDelete}`,
        {
          method: 'DELETE',
          headers: { 'x-user-email': userEmail },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || 'Failed to remove pipeline');
        return;
      }
      const deletedRes: string[] = data?.clusterCleanup?.deletedResources || [];
      const cleanupErr: string | undefined = data?.clusterCleanup?.error;
      if (deletedRes.length > 0) {
        setNotice(
          `Pipeline "${deleteTarget.name}" removed and deleted from cluster: ${deletedRes.join(', ')}.`
        );
      } else if (cleanupErr) {
        setNotice(
          `Pipeline "${deleteTarget.name}" removed (cluster cleanup notice: ${cleanupErr}).`
        );
      } else {
        setNotice(`Pipeline "${deleteTarget.name}" removed.`);
      }
      setDeleteTarget(null);
      invalidateSwrCache(userEmail, 'pipelines');
      invalidateSwrCache(userEmail, 'overview');
      await loadPipelines(true);
    } catch {
      setError('Failed to delete pipeline');
    } finally {
      setDeletingPipeline(false);
    }
  };

  const renderStatusChip = (status: string, runNum: number) => {
    const isOk = status === 'Succeeded';
    const isRun = status === 'Running';
    const isFail = status === 'Failed';
    return (
      <Chip
        label={runNum > 0 ? `#${runNum} · ${status}` : status}
        size="small"
        icon={
          isRun ? (
            <CircularProgress size={14} />
          ) : isOk ? (
            <CheckCircleIcon sx={{ color: '#2563eb !important', fontSize: 16 }} />
          ) : isFail ? (
            <ErrorIcon sx={{ color: '#dc2626 !important', fontSize: 16 }} />
          ) : undefined
        }
        sx={{
          fontWeight: 700,
          bgcolor: isOk || isRun ? '#eff6ff' : isFail ? '#fee2e2' : '#f1f5f9',
          color: isOk || isRun ? '#1d4ed8' : isFail ? '#b91c1c' : '#334155',
        }}
      />
    );
  };

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
            <Typography variant="h4" component="h1" sx={{ fontWeight: 800, color: '#09090b', letterSpacing: '-0.02em' }}>
              CI/CD Pipelines
            </Typography>
            <Chip
              icon={<PipelineIcon sx={{ color: '#60a5fa !important', fontSize: 16 }} />}
              label="Real Git · Docker · kubectl Runner"
              size="small"
              sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 600 }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#475569' }}>
            Verifies live Git remotes (`git ls-remote`), clones real repos, builds/scans manifests against Guardrails, and deploys via `kubectl apply`.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => loadPipelines(true)}
            sx={{ borderColor: '#09090b', color: '#09090b' }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setModalError('');
              setCreateOpen(true);
            }}
          >
            New Pipeline
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="info" onClose={() => setNotice('')} sx={{ borderRadius: 2 }}>
          {notice}
        </Alert>
      )}

      {pipelines.length === 0 ? (
        <Perspective3DCard sx={{ p: 4, textAlign: 'center' }}>
          <PipelineIcon sx={{ fontSize: 42, color: '#2563eb', mb: 1 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b', mb: 0.75 }}>
            No CI/CD Pipelines Configured Yet
          </Typography>
          <Typography variant="body2" sx={{ color: '#475569', maxWidth: 540, mx: 'auto', mb: 2.5 }}>
            Create a pipeline targeting a real Git repository & branch plus a Kubernetes context or AWS EKS cluster. Non-existent repos or dummy URLs are rejected by <code>git ls-remote</code>.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            Create Real Pipeline
          </Button>
        </Perspective3DCard>
      ) : (
        <Grid container spacing={3}>
          {pipelines.map((pip) => {
            const isExpanded = selectedLogPipelineId === pip.id;
            const isRunning = pip.status === 'Running';
            return (
              <Grid item xs={12} key={pip.id}>
                <Perspective3DCard sx={{ overflow: 'hidden' }}>
                  <Box sx={{ p: 3 }}>
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
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, flexWrap: 'wrap' }}>
                          <Typography variant="h6" sx={{ fontWeight: 800, color: '#09090b' }}>
                            {pip.name}
                          </Typography>
                          {renderStatusChip(pip.status, pip.lastRunNumber)}
                          <Chip
                            label={`Target: ${pip.targetCluster} (${pip.namespace})`}
                            size="small"
                            sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 600 }}
                          />
                        </Box>
                        <Typography variant="body2" sx={{ color: '#475569', mt: 0.5 }}>
                          Git: <strong>{pip.repositoryUrl}</strong>@{pip.branch} · Manifests:{' '}
                          <code>{pip.manifestPath}</code> · SHA: <code>{pip.verifiedRemoteSha || 'HEAD'}</code>
                          {pip.durationSec > 0 ? ` · ${pip.durationSec}s` : ''}
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          variant="outlined"
                          aria-expanded={isExpanded}
                          startIcon={<TerminalIcon />}
                          onClick={() => {
                            hasAutoSelectedLogRef.current = true;
                            setSelectedLogPipelineId((prev) => (prev === pip.id ? null : pip.id));
                          }}
                          sx={{ borderColor: 'rgba(15,23,42,0.22)', color: '#09090b' }}
                        >
                          {isExpanded ? 'Hide Logs' : 'Execution Logs'}
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={isRunning}
                          startIcon={isRunning ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
                          onClick={() => handleTrigger(pip)}
                        >
                          {isRunning ? 'Running...' : 'Run Pipeline'}
                        </Button>
                        <IconButton
                          size="small"
                          aria-label={`Delete ${pip.name}`}
                          onClick={() => {
                            setCleanupClusterOnDelete(true);
                            setDeleteTarget(pip);
                          }}
                        >
                          <DeleteIcon fontSize="small" sx={{ color: '#64748b' }} />
                        </IconButton>
                      </Box>
                    </Box>

                    {pip.stages.length > 0 && (
                      <Grid container spacing={1.5} sx={{ mt: 2 }}>
                        {pip.stages.map((st, idx) => (
                          <Grid item xs={12} sm={6} md={2.4} key={`${st.name}-${idx}`}>
                            <Box
                              sx={{
                                p: 1.4,
                                borderRadius: 2,
                                border: '1px solid',
                                borderColor:
                                  st.status === 'Failed'
                                    ? 'rgba(220,38,38,0.45)'
                                    : st.status === 'Succeeded'
                                    ? 'rgba(37,99,235,0.32)'
                                    : 'rgba(15,23,42,0.12)',
                                bgcolor:
                                  st.status === 'Failed'
                                    ? '#fef2f2'
                                    : st.status === 'Succeeded'
                                    ? '#f8fafc'
                                    : '#f1f5f9',
                              }}
                            >
                              <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                                {st.status.toUpperCase()} · {st.durationSec}s
                              </Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, color: '#09090b' }}>
                                {st.name}
                              </Typography>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>
                    )}
                  </Box>

                  {isExpanded && (
                    <>
                      <Divider />
                      <Box sx={{ p: 2.5, bgcolor: '#09090b', color: '#e2e8f0' }}>
                        <Typography variant="caption" sx={{ color: '#60a5fa', fontWeight: 700, display: 'block', mb: 1 }}>
                          {pip.lastRunNumber > 0
                            ? `REAL SUBPROCESS STDOUT / STDERR TRACE — RUN #${pip.lastRunNumber}`
                            : 'NO RUNS EXECUTED YET — CLICK RUN PIPELINE TO CLONE & DEPLOY'}
                        </Typography>
                        {pip.stages.map((st, idx) => (
                          <Box key={`${st.name}-log-${idx}`} sx={{ mb: 1.25 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                color: st.status === 'Failed' ? '#f87171' : '#60a5fa',
                                fontWeight: 700,
                                fontFamily: 'monospace',
                              }}
                            >
                              [{st.name}] ({st.status} · {st.durationSec}s)
                            </Typography>
                            <Box
                              component="pre"
                              sx={{
                                m: 0,
                                mt: 0.3,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                fontFamily: 'monospace',
                                fontSize: '0.78rem',
                                color: '#e2e8f0',
                              }}
                            >
                              {st.log}
                            </Box>
                          </Box>
                        ))}

                        {pip.recentRuns.length > 0 && (
                          <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {pip.recentRuns.map((r) => (
                              <Chip
                                key={r.runNumber}
                                label={`#${r.runNumber} · ${r.commitSha} (${r.status})`}
                                size="small"
                                sx={{
                                  bgcolor: '#18181b',
                                  color: r.status === 'Failed' ? '#fca5a5' : '#ffffff',
                                  border: '1px solid rgba(96,165,250,0.35)',
                                }}
                              />
                            ))}
                          </Box>
                        )}
                      </Box>
                    </>
                  )}
                </Perspective3DCard>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCreate}>
          <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
            Create Verified CI/CD Pipeline
          </DialogTitle>
          <DialogContent sx={{ bgcolor: '#ffffff', pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Alert severity="info">
              Backend validates the Git repo & branch immediately via <code>git ls-remote</code>. On Run, it clones, scans YAML manifests, and executes real <code>kubectl apply</code>.
            </Alert>
            {modalError && <Alert severity="error">{modalError}</Alert>}

            <TextField
              label="Pipeline Name"
              placeholder="e.g. demo-k8s-app"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              size="small"
              fullWidth
            />

            {gitIntegrations.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>Private Repo Token (Optional Git Integration)</InputLabel>
                <Select
                  label="Private Repo Token (Optional Git Integration)"
                  value={gitIntegrationId}
                  onChange={(e) => setGitIntegrationId(e.target.value)}
                >
                  <MenuItem value="">Public HTTPS Repo (No Token)</MenuItem>
                  {gitIntegrations.map((g) => (
                    <MenuItem key={g.id} value={g.id}>
                      {g.name} ({g.scope})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <TextField
              label="Git Repository HTTPS URL"
              placeholder="https://github.com/kubernetes/examples.git"
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
              required
              size="small"
              fullWidth
            />

            <Grid container spacing={2}>
              <Grid item xs={4}>
                <TextField
                  label="Branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  required
                  size="small"
                  fullWidth
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  label="K8s Manifest Path"
                  value={manifestPath}
                  onChange={(e) => setManifestPath(e.target.value)}
                  size="small"
                  fullWidth
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  label="Namespace"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  size="small"
                  fullWidth
                />
              </Grid>
            </Grid>

            <FormControl fullWidth size="small">
              <InputLabel>Target Kubernetes / EKS Cluster</InputLabel>
              <Select
                label="Target Kubernetes / EKS Cluster"
                value={targetCluster}
                onChange={(e) => setTargetCluster(e.target.value)}
              >
                {clusterTargets.map((ct) => (
                  <MenuItem key={ct.id} value={ct.id}>
                    {ct.name} ({ct.type === 'aws-eks' ? `EKS · ${ct.region}` : 'kubectl context'})
                  </MenuItem>
                ))}
                <MenuItem value="__custom__">Custom kubeconfig context name...</MenuItem>
              </Select>
            </FormControl>

            {targetCluster === '__custom__' && (
              <TextField
                label="Custom kubectl Context Name"
                placeholder="e.g. docker-desktop or minikube"
                value={customCluster}
                onChange={(e) => setCustomCluster(e.target.value)}
                required
                size="small"
                fullWidth
              />
            )}

            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  label="Dockerfile Path (Optional)"
                  placeholder="Dockerfile"
                  value={dockerfilePath}
                  onChange={(e) => setDockerfilePath(e.target.value)}
                  size="small"
                  fullWidth
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Docker Image Tag (Optional)"
                  placeholder="my-app"
                  value={imageTag}
                  onChange={(e) => setImageTag(e.target.value)}
                  size="small"
                  fullWidth
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5, bgcolor: '#f8fafc' }}>
            <Button onClick={() => setCreateOpen(false)} sx={{ color: '#475569' }}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={submitting || !name.trim() || !repositoryUrl.trim()}>
              {submitting ? 'Verifying git ls-remote...' : 'Verify & Create'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDeleteDialog
        open={Boolean(deleteTarget)}
        title="Delete CI/CD Pipeline?"
        description={
          <>
            Are you sure you want to delete pipeline <strong>{deleteTarget?.name}</strong>?
          </>
        }
        loading={deletingPipeline}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      >
        {deleteTarget && (
          <FormControlLabel
            control={
              <Checkbox
                checked={cleanupClusterOnDelete}
                onChange={(e) => setCleanupClusterOnDelete(e.target.checked)}
              />
            }
            label={`Also delete all deployments/resources created in ${deleteTarget.targetCluster} (${deleteTarget.namespace})`}
          />
        )}
      </ConfirmDeleteDialog>
    </Box>
  );
};
