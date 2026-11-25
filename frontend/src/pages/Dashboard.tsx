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
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccountTree as PipelineIcon,
  Add as AddIcon,
  ArrowForward as ArrowForwardIcon,
  Cable as CableIcon,
  CheckCircle as CheckCircleIcon,
  CloudQueue as CloudQueueIcon,
  Error as ErrorIcon,
  GppGood as GuardrailIcon,
  NotificationsActive as AlertBellIcon,
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon,
  Storage as StorageIcon,
  Terminal as TerminalIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
import ClusterHealth from '../components/ClusterHealth';
import ClusterListManager from '../components/ClusterListManager';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { AlertSeverity, OverviewAlert, PlatformOverview, RecentDeployment } from '../types/atmosly';
import { Cluster } from '../types/cluster';
import { API_BASE_URL, buildAuthHeaders } from '../utils/apiClient';

const getAlertBadge = (severity: AlertSeverity) => {
  if (severity === 'critical') {
    return {
      label: 'Critical',
      bg: '#fee2e2',
      color: '#dc2626',
      border: 'rgba(220, 38, 38, 0.25)',
      icon: <ErrorIcon sx={{ fontSize: 18, color: '#dc2626' }} />,
    };
  }
  if (severity === 'approval') {
    return {
      label: 'Approval',
      bg: '#eff6ff',
      color: '#1d4ed8',
      border: 'rgba(37, 99, 235, 0.3)',
      icon: <GuardrailIcon sx={{ fontSize: 18, color: '#2563eb' }} />,
    };
  }
  return {
    label: 'Warning',
    bg: '#fef3c7',
    color: '#b45309',
    border: 'rgba(217, 119, 6, 0.28)',
    icon: <WarningIcon sx={{ fontSize: 18, color: '#d97706' }} />,
  };
};

const getDeploymentBadge = (status: string) => {
  if (status === 'Succeeded') {
    return { bg: '#dcfce7', color: '#16a34a' };
  }
  if (status === 'Failed') {
    return { bg: '#fee2e2', color: '#dc2626' };
  }
  if (status === 'Running') {
    return { bg: '#eff6ff', color: '#2563eb' };
  }
  return { bg: '#f1f5f9', color: '#09090b' };
};

const formatRelativeTime = (iso?: string) => {
  if (!iso) return 'Just now';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Recent';
  const diffSec = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return parsed.toLocaleDateString();
};

const formatClusterTarget = (raw: string) => {
  if (!raw) return 'default';
  if (raw.startsWith('eks:')) return `EKS · ${raw.slice(4)}`;
  if (raw.startsWith('ctx:')) {
    const ctx = raw.slice(4);
    const parts = ctx.split('/');
    return parts.length > 1 ? `ctx · ${parts[parts.length - 1]}` : `ctx · ${ctx}`;
  }
  return raw;
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { userEmail: ctxEmail, getAccessToken } = useTesserakAuth();
  const userEmail = ctxEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';

  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState<boolean>(true);
  const [alertFilter, setAlertFilter] = useState<'all' | AlertSeverity>('all');
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');

  const loadOverview = useCallback(async () => {
    try {
      const headers = await buildAuthHeaders(userEmail, getAccessToken);
      const res = await fetch(`${API_BASE_URL}/api/atmosly/overview`, { headers });
      if (res.ok) {
        const data: PlatformOverview = await res.json();
        setOverview(data);
      }
    } catch {
      // Handled gracefully by fallback states
    } finally {
      setLoadingOverview(false);
    }
  }, [userEmail, getAccessToken]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Auto-poll overview while any deployment run is actively executing
  useEffect(() => {
    const hasRunning = overview?.recentDeployments?.some((d) => d.status === 'Running');
    if (!hasRunning) return;
    const timer = setInterval(loadOverview, 2500);
    return () => clearInterval(timer);
  }, [overview, loadOverview]);

  const handleQuickTriggerPipeline = async (dep: RecentDeployment) => {
    setTriggeringId(dep.pipelineId);
    try {
      const headers = await buildAuthHeaders(userEmail, getAccessToken, {
        'Content-Type': 'application/json',
      });
      const res = await fetch(`${API_BASE_URL}/api/atmosly/pipelines/${dep.pipelineId}/trigger`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ branch: dep.branch }),
      });
      if (res.ok) {
        setActionMsg(`Triggered pipeline "${dep.pipelineName}" (${dep.branch} → ${formatClusterTarget(dep.targetCluster)}).`);
        await loadOverview();
      } else {
        const err = await res.json().catch(() => ({}));
        setActionMsg(err.detail || `Unable to trigger pipeline "${dep.pipelineName}".`);
      }
    } catch {
      setActionMsg(`Failed to reach CI/CD runner for "${dep.pipelineName}".`);
    } finally {
      setTriggeringId(null);
    }
  };

  const alerts: OverviewAlert[] = overview?.alerts || [];
  const filteredAlerts =
    alertFilter === 'all' ? alerts : alerts.filter((a) => a.severity === alertFilter);
  const recentDeployments: RecentDeployment[] = overview?.recentDeployments || [];

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const approvalAlertCount = alerts.filter((a) => a.severity === 'approval').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  const kpiCards = [
    {
      title: 'Verified Integrations',
      value: overview ? `${overview.connectedIntegrations}/${overview.integrationsCount}` : '—',
      subtitle: 'Live AWS STS, Git, ECR & DNS',
      path: '/integrations',
      icon: <CableIcon sx={{ color: '#2563eb' }} />,
    },
    {
      title: 'Live AWS Resources',
      value: overview ? `${overview.resourcesCount}` : '—',
      subtitle: overview
        ? overview.awsConnected
          ? `${overview.driftedResources} drifted · Boto3 synced`
          : 'Connect AWS IAM to sync'
        : 'RDS · Redis · S3 · SQS',
      path: '/resources',
      icon: <CloudQueueIcon sx={{ color: '#2563eb' }} />,
    },
    {
      title: 'CI/CD Pipelines',
      value: overview ? `${overview.pipelinesCount}` : '—',
      subtitle: overview
        ? `${overview.healthyPipelines} succeeded · Git & kubectl`
        : 'Verified GitOps workflows',
      path: '/pipelines',
      icon: <PipelineIcon sx={{ color: '#2563eb' }} />,
    },
    {
      title: 'Policy Guardrails',
      value: overview ? `${overview.enabledGuardrails}/${overview.totalGuardrails}` : '—',
      subtitle: overview ? `${overview.pendingApprovals} pending approvals` : 'Policy engine & approvals',
      path: '/guardrails',
      icon: <GuardrailIcon sx={{ color: '#60a5fa' }} />,
      dark: true,
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Executive Header */}
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
              Platform Overview
            </Typography>
            <Chip
              label="Tesserak | EKS & Cloud IDP"
              size="small"
              sx={{
                bgcolor: 'rgba(37, 99, 235, 0.2)',
                color: '#93c5fd',
                border: '1px solid rgba(96, 165, 250, 0.4)',
                fontWeight: 700,
              }}
            />
            {overview && (
              <Chip
                label={`Compliance: ${overview.complianceScore}%`}
                size="small"
                sx={{
                  bgcolor: '#18181b',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  fontWeight: 700,
                }}
              />
            )}
          </Box>
          <Typography variant="body2" sx={{ color: '#cbd5e1' }}>
            Unified visibility across live policy alerts, recent Git + kubectl pipeline deployments, cloud drift, and AWS EKS clusters.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
          <Tooltip title="Refresh live telemetry">
            <IconButton
              onClick={() => {
                setLoadingOverview(true);
                loadOverview();
              }}
              sx={{
                color: '#93c5fd',
                border: '1px solid rgba(96, 165, 250, 0.35)',
                '&:hover': { bgcolor: 'rgba(37, 99, 235, 0.16)' },
              }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<PipelineIcon />}
            onClick={() => navigate('/pipelines')}
            sx={{
              borderColor: 'rgba(96, 165, 250, 0.45)',
              color: '#ffffff',
              fontWeight: 700,
              '&:hover': { borderColor: '#60a5fa', bgcolor: 'rgba(37, 99, 235, 0.14)' },
            }}
          >
            New Pipeline
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
        <Alert severity="info" onClose={() => setActionMsg('')} sx={{ borderRadius: 2 }}>
          {actionMsg}
        </Alert>
      )}

      {/* KPI Cards */}
      <Grid container spacing={2.5}>
        {kpiCards.map((card) => (
          <Grid item xs={12} sm={6} lg={3} key={card.title}>
            <Box onClick={() => navigate(card.path)} sx={{ cursor: 'pointer', height: '100%' }}>
              <Perspective3DCard
                sx={{
                  p: 2.5,
                  height: '100%',
                  bgcolor: card.dark ? '#09090b' : 'rgba(255,255,255,0.96)',
                  color: card.dark ? '#ffffff' : '#09090b',
                  border: card.dark ? '1px solid rgba(59,130,246,0.45)' : undefined,
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: card.dark ? '#93c5fd' : '#64748b',
                    }}
                  >
                    {card.title}
                  </Typography>
                  {card.icon}
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 800, mb: 0.5 }}>
                  {card.value}
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="caption" sx={{ color: card.dark ? '#cbd5e1' : '#475569' }}>
                    {card.subtitle}
                  </Typography>
                  <ArrowForwardIcon sx={{ fontSize: 16, color: card.dark ? '#60a5fa' : '#2563eb' }} />
                </Box>
              </Perspective3DCard>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* High-Visibility Alerts + Recent Pipeline Deployments */}
      <Grid container spacing={3}>
        {/* Live Alerts & Policy Signals */}
        <Grid item xs={12} lg={6}>
          <Perspective3DCard sx={{ p: 2.75, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'center' },
                flexDirection: { xs: 'column', sm: 'row' },
                gap: 1.25,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AlertBellIcon sx={{ color: criticalCount > 0 ? '#dc2626' : '#2563eb' }} />
                <Typography variant="h6" sx={{ fontWeight: 800, color: '#09090b' }}>
                  Live Alerts &amp; Policy Signals
                </Typography>
                <Chip
                  size="small"
                  label={alerts.length === 0 ? 'All Clear' : `${alerts.length} Active`}
                  sx={{
                    bgcolor:
                      alerts.length === 0
                        ? '#dcfce7'
                        : criticalCount > 0
                        ? '#fee2e2'
                        : '#eff6ff',
                    color:
                      alerts.length === 0
                        ? '#16a34a'
                        : criticalCount > 0
                        ? '#dc2626'
                        : '#1d4ed8',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                  }}
                />
              </Box>

              <Button
                size="small"
                endIcon={<ArrowForwardIcon fontSize="small" />}
                onClick={() => navigate('/guardrails')}
                sx={{ color: '#2563eb', fontWeight: 700 }}
              >
                Policy Center
              </Button>
            </Box>

            {/* Severity Filter Strip */}
            <Box sx={{ display: 'flex', gap: 0.85, flexWrap: 'wrap' }}>
              {[
                { key: 'all' as const, label: `All (${alerts.length})` },
                { key: 'critical' as const, label: `Critical (${criticalCount})` },
                { key: 'approval' as const, label: `Approvals (${approvalAlertCount})` },
                { key: 'warning' as const, label: `Warnings (${warningCount})` },
              ].map((item) => {
                const selected = alertFilter === item.key;
                return (
                  <Chip
                    key={item.key}
                    label={item.label}
                    size="small"
                    clickable
                    onClick={() => setAlertFilter(item.key)}
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.73rem',
                      bgcolor: selected ? '#09090b' : '#f1f5f9',
                      color: selected ? '#ffffff' : '#475569',
                      border: selected ? '1px solid #2563eb' : '1px solid transparent',
                      '&:hover': {
                        bgcolor: selected ? '#09090b' : '#e2e8f0',
                      },
                    }}
                  />
                );
              })}
            </Box>

            <Divider />

            {loadingOverview && !overview ? (
              <Box sx={{ py: 5, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1.5 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">
                  Scanning live AWS resources, guardrails, and pipelines...
                </Typography>
              </Box>
            ) : filteredAlerts.length === 0 ? (
              <Box
                sx={{
                  py: 4.5,
                  px: 2.5,
                  borderRadius: 2.5,
                  bgcolor: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  textAlign: 'center',
                }}
              >
                <CheckCircleIcon sx={{ color: '#16a34a', fontSize: 30, mb: 0.75 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#09090b' }}>
                  Zero Active Alerts in Selected Filter
                </Typography>
                <Typography variant="caption" sx={{ color: '#475569', display: 'block', mt: 0.5 }}>
                  All connected cloud resources, guardrail audits, approvals, and CI/CD runs are clean.
                </Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.35, maxHeight: 370, overflowY: 'auto', pr: 0.5 }}>
                {filteredAlerts.map((alertItem) => {
                  const badge = getAlertBadge(alertItem.severity);
                  return (
                    <Box
                      key={alertItem.id}
                      sx={{
                        p: 1.75,
                        borderRadius: 2.5,
                        bgcolor: '#f8fafc',
                        border: `1px solid ${badge.border}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: { xs: 'flex-start', sm: 'center' },
                        flexDirection: { xs: 'column', sm: 'row' },
                        gap: 1.5,
                        transition: 'background-color 0.15s ease',
                        '&:hover': { bgcolor: '#ffffff' },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, minWidth: 0 }}>
                        <Box sx={{ mt: 0.25 }}>{badge.icon}</Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.85, flexWrap: 'wrap', mb: 0.35 }}>
                            <Chip
                              size="small"
                              label={alertItem.category}
                              sx={{
                                height: 20,
                                bgcolor: badge.bg,
                                color: badge.color,
                                fontWeight: 700,
                                fontSize: '0.68rem',
                              }}
                            />
                            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                              {formatRelativeTime(alertItem.timestamp)}
                            </Typography>
                          </Box>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#09090b', lineHeight: 1.3 }}>
                            {alertItem.title}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#475569', display: 'block', mt: 0.25 }}>
                            {alertItem.detail}
                          </Typography>
                        </Box>
                      </Box>

                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate(alertItem.actionPath)}
                        sx={{
                          flexShrink: 0,
                          borderColor: '#09090b',
                          color: '#09090b',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          '&:hover': {
                            borderColor: '#2563eb',
                            color: '#2563eb',
                            bgcolor: '#eff6ff',
                          },
                        }}
                      >
                        {alertItem.actionLabel}
                      </Button>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Perspective3DCard>
        </Grid>

        {/* Recent Pipeline Deployments */}
        <Grid item xs={12} lg={6}>
          <Perspective3DCard sx={{ p: 2.75, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'center' },
                flexDirection: { xs: 'column', sm: 'row' },
                gap: 1.25,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PipelineIcon sx={{ color: '#2563eb' }} />
                <Typography variant="h6" sx={{ fontWeight: 800, color: '#09090b' }}>
                  Recent Pipeline Deployments
                </Typography>
                <Chip
                  size="small"
                  label={`${recentDeployments.length} Listed`}
                  sx={{
                    bgcolor: '#eff6ff',
                    color: '#1d4ed8',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                  }}
                />
              </Box>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => navigate('/pipelines')}
                  sx={{ borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 }}
                >
                  Create
                </Button>
                <Button
                  size="small"
                  endIcon={<ArrowForwardIcon fontSize="small" />}
                  onClick={() => navigate('/pipelines')}
                  sx={{ color: '#09090b', fontWeight: 700 }}
                >
                  All Pipelines
                </Button>
              </Box>
            </Box>

            <Typography variant="caption" sx={{ color: '#475569' }}>
              Live Git clone, Docker build, manifest Guardrail scan, and kubectl deployment runs across your clusters.
            </Typography>

            <Divider />

            {loadingOverview && !overview ? (
              <Box sx={{ py: 5, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1.5 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">
                  Loading recent CI/CD pipeline runs...
                </Typography>
              </Box>
            ) : recentDeployments.length === 0 ? (
              <Box
                sx={{
                  py: 4.5,
                  px: 2.5,
                  borderRadius: 2.5,
                  bgcolor: '#09090b',
                  color: '#ffffff',
                  border: '1px solid rgba(59, 130, 246, 0.32)',
                  textAlign: 'center',
                }}
              >
                <TerminalIcon sx={{ color: '#60a5fa', fontSize: 30, mb: 0.75 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#ffffff' }}>
                  No Pipeline Deployments Yet
                </Typography>
                <Typography variant="caption" sx={{ color: '#cbd5e1', display: 'block', mt: 0.5, mb: 2 }}>
                  Connect any real Git repository to verify HEAD via git ls-remote and deploy Kubernetes manifests.
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => navigate('/pipelines')}
                  sx={{
                    bgcolor: '#2563eb !important',
                    background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%) !important',
                    color: '#ffffff',
                    fontWeight: 700,
                  }}
                >
                  Create First Pipeline
                </Button>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.35, maxHeight: 370, overflowY: 'auto', pr: 0.5 }}>
                {recentDeployments.map((dep) => {
                  const statusStyle = getDeploymentBadge(dep.status);
                  const isRunning = dep.status === 'Running';
                  return (
                    <Box
                      key={dep.id}
                      sx={{
                        p: 1.75,
                        borderRadius: 2.5,
                        bgcolor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: { xs: 'flex-start', sm: 'center' },
                        flexDirection: { xs: 'column', sm: 'row' },
                        gap: 1.5,
                        '&:hover': { bgcolor: '#ffffff', borderColor: 'rgba(37, 99, 235, 0.35)' },
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.4 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b' }}>
                            {dep.pipelineName}
                          </Typography>
                          <Chip
                            size="small"
                            icon={isRunning ? <CircularProgress size={12} /> : undefined}
                            label={dep.runNumber > 0 ? `#${dep.runNumber} · ${dep.status}` : dep.status}
                            sx={{
                              height: 22,
                              bgcolor: statusStyle.bg,
                              color: statusStyle.color,
                              fontWeight: 700,
                              fontSize: '0.7rem',
                            }}
                          />
                          <Chip
                            size="small"
                            label={dep.commitSha}
                            sx={{
                              height: 20,
                              bgcolor: '#09090b',
                              color: '#93c5fd',
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              fontSize: '0.68rem',
                            }}
                          />
                        </Box>

                        <Typography variant="caption" sx={{ color: '#475569', display: 'block' }}>
                          Branch <strong>{dep.branch}</strong> → <strong>{formatClusterTarget(dep.targetCluster)}</strong> ({dep.namespace})
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#64748b' }}>
                          {dep.durationSec > 0 ? `${dep.durationSec}s · ` : ''}
                          {formatRelativeTime(dep.timestamp)}
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', gap: 0.85, flexShrink: 0 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={
                            triggeringId === dep.pipelineId ? (
                              <CircularProgress size={12} />
                            ) : (
                              <PlayArrowIcon fontSize="small" />
                            )
                          }
                          disabled={isRunning || triggeringId === dep.pipelineId}
                          onClick={() => handleQuickTriggerPipeline(dep)}
                          sx={{ borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 }}
                        >
                          Run
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<TerminalIcon fontSize="small" />}
                          onClick={() => navigate('/pipelines')}
                          sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
                        >
                          Logs
                        </Button>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Perspective3DCard>
        </Grid>
      </Grid>

      {/* Compact EKS Fleet Summary (Full cluster table & lifecycle actions live on /#/clusters) */}
      <ClusterListManager>
        {(clusters: Cluster[]) => {
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
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <StorageIcon sx={{ color: '#2563eb' }} />
                        <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b' }}>
                          AWS EKS Fleet Summary
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        endIcon={<ArrowForwardIcon fontSize="small" />}
                        onClick={() => navigate('/clusters')}
                        sx={{ color: '#2563eb', fontWeight: 700 }}
                      >
                        Open Clusters View
                      </Button>
                    </Box>
                    <Typography variant="body2" sx={{ color: '#475569', mb: 2 }}>
                      {clusters.length === 0
                        ? 'No active EKS clusters found yet. Open the dedicated Clusters (EKS) view to launch or sync clusters.'
                        : `Tracking ${clusters.length} live EKS cluster(s). Open Clusters (EKS) for per-cluster sync and lifecycle controls.`}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
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
                      variant="contained"
                      onClick={() => navigate('/clusters')}
                      sx={{
                        bgcolor: '#09090b !important',
                        background: '#09090b !important',
                        color: '#ffffff',
                        fontWeight: 700,
                      }}
                    >
                      Manage EKS Clusters
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate('/integrations')}
                      sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
                    >
                      Cloud Connectors
                    </Button>
                  </Box>
                </Perspective3DCard>
              </Grid>
            </Grid>
          );
        }}
      </ClusterListManager>
    </Box>
  );
};

export default Dashboard;
