import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Typography,
} from '@mui/material';
import {
  AccountTree as PipelineIcon,
  Add as AddIcon,
  ArrowForward as ArrowForwardIcon,
  Cable as CableIcon,
  CheckCircle as CheckCircleIcon,
  CloudQueue as CloudQueueIcon,
  ErrorOutline as ErrorOutlineIcon,
  GppGood as GuardrailIcon,
  InfoOutlined as InfoOutlinedIcon,
  NotificationsActive as AlertIcon,
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon,
  RocketLaunch as RocketLaunchIcon,
  Storage as StorageIcon,
  Terminal as TerminalIcon,
  WarningAmber as WarningAmberIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
import ClusterHealth from '../components/ClusterHealth';
import ClusterListManager from '../components/ClusterListManager';
import type { ClusterListHelpers } from '../components/ClusterListManager';
import { Perspective3DCard } from '../components/Perspective3DCard';
import type {
  PlatformAlert,
  PlatformAlertSeverity,
  PlatformOverview,
  RecentDeploymentItem,
} from '../types/platform';
import type { Cluster } from '../types/cluster';
import { formatRelativeTime } from '../utils/dateUtils';
import { fetchWithSwr, invalidateSwrCache, readSwrCache } from '../utils/swrCache';

type AlertFilter = 'all' | PlatformAlertSeverity;

const SEVERITY_STYLES: Record<
  PlatformAlertSeverity,
  { label: string; bg: string; color: string; border: string; icon: React.ReactNode }
> = {
  error: {
    label: 'CRITICAL',
    bg: '#fee2e2',
    color: '#b91c1c',
    border: 'rgba(220, 38, 38, 0.35)',
    icon: <ErrorOutlineIcon sx={{ fontSize: 17, color: '#dc2626' }} />,
  },
  warning: {
    label: 'WARNING',
    bg: '#fef3c7',
    color: '#92400e',
    border: 'rgba(217, 119, 6, 0.35)',
    icon: <WarningAmberIcon sx={{ fontSize: 17, color: '#d97706' }} />,
  },
  info: {
    label: 'INFO',
    bg: '#eff6ff',
    color: '#1d4ed8',
    border: 'rgba(37, 99, 235, 0.3)',
    icon: <InfoOutlinedIcon sx={{ fontSize: 17, color: '#2563eb' }} />,
  },
};

const isClusterSynced = (c: Cluster) =>
  c.stateStatus === 'synced' || c.stateStatus === 'in_sync';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';

  const cachedOverview = readSwrCache<PlatformOverview>(userEmail, 'overview');
  const [overview, setOverview] = useState<PlatformOverview | null>(
    () => cachedOverview ?? null
  );
  const [loadingOverview, setLoadingOverview] = useState<boolean>(
    () => cachedOverview === undefined
  );
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const [actionMsg, setActionMsg] = useState('');
  const [actionSeverity, setActionSeverity] = useState<'info' | 'error'>('info');
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  const loadOverview = useCallback(
    async (force: boolean = false) => {
      const existing = readSwrCache<PlatformOverview>(userEmail, 'overview');
      if (existing) {
        setOverview(existing);
        setLoadingOverview(false);
      }

      try {
        const data = await fetchWithSwr<PlatformOverview>(
          userEmail,
          'overview',
          async () => {
            const url = force
              ? 'http://localhost:8000/api/overview?refresh=true'
              : 'http://localhost:8000/api/overview';
            const res = await fetch(url, {
              headers: { 'x-user-email': userEmail },
            });
            if (!res.ok) {
              throw new Error(`Overview request failed (${res.status})`);
            }
            return (await res.json()) as PlatformOverview;
          },
          { force, dedupeWindowMs: 4000 }
        );
        setOverview(data);
      } catch {
        // Non-fatal: keep existing cached view if backend temporarily unavailable
      } finally {
        setLoadingOverview(false);
      }
    },
    [userEmail]
  );

  useEffect(() => {
    loadOverview(false);
  }, [loadOverview]);

  // Poll automatically while any pipeline deployment is actively running
  useEffect(() => {
    if (!overview?.activeRunningPipelines) return;
    const timer = setInterval(() => loadOverview(true), 2000);
    return () => clearInterval(timer);
  }, [overview?.activeRunningPipelines, loadOverview]);

  const handleTriggerDeployment = async (dep: RecentDeploymentItem) => {
    setTriggeringId(dep.pipelineId);
    setActionMsg('');
    try {
      const res = await fetch(
        `http://localhost:8000/api/pipelines/${encodeURIComponent(dep.pipelineId)}/trigger`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-email': userEmail,
          },
          body: JSON.stringify({ branch: dep.branch }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionSeverity('error');
        setActionMsg(data.detail || `Failed to trigger "${dep.pipelineName}".`);
        return;
      }
      setActionSeverity('info');
      setActionMsg(`Triggered "${dep.pipelineName}" (${dep.branch}) on backend runner.`);
      invalidateSwrCache(userEmail, 'overview');
      invalidateSwrCache(userEmail, 'pipelines');
      await loadOverview(true);
    } catch {
      setActionSeverity('error');
      setActionMsg(`Unable to reach backend CI/CD runner for "${dep.pipelineName}".`);
    } finally {
      setTriggeringId(null);
    }
  };

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
        ? overview.activeRunningPipelines
          ? `${overview.activeRunningPipelines} running · ${overview.healthyPipelines} succeeded`
          : `${overview.healthyPipelines} succeeded · Git & kubectl`
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

  const recentDeployments = overview?.recentDeployments || [];
  const runningCount = recentDeployments.filter((d) => d.status === 'Running').length;
  const succeededCount = recentDeployments.filter((d) => d.status === 'Succeeded').length;
  const failedCount = recentDeployments.filter((d) => d.status === 'Failed').length;

  return (
    <ClusterListManager>
      {(clusters: Cluster[], helpers: ClusterListHelpers) => (
        <OverviewContent
          overview={overview}
          loadingOverview={loadingOverview}
          clusters={clusters}
          clusterHelpers={helpers}
          kpiCards={kpiCards}
          alertFilter={alertFilter}
          setAlertFilter={setAlertFilter}
          actionMsg={actionMsg}
          actionSeverity={actionSeverity}
          clearActionMsg={() => setActionMsg('')}
          recentDeployments={recentDeployments}
          runningCount={runningCount}
          succeededCount={succeededCount}
          failedCount={failedCount}
          triggeringId={triggeringId}
          onTriggerDeployment={handleTriggerDeployment}
          onRefreshAll={async () => {
            setLoadingOverview(true);
            await Promise.all([loadOverview(true), helpers.refreshClusters(true)]);
          }}
          onNavigate={navigate}
        />
      )}
    </ClusterListManager>
  );
};

interface OverviewContentProps {
  overview: PlatformOverview | null;
  loadingOverview: boolean;
  clusters: Cluster[];
  clusterHelpers: ClusterListHelpers;
  kpiCards: Array<{
    title: string;
    value: string;
    subtitle: string;
    path: string;
    icon: React.ReactNode;
    dark?: boolean;
  }>;
  alertFilter: AlertFilter;
  setAlertFilter: (f: AlertFilter) => void;
  actionMsg: string;
  actionSeverity: 'info' | 'error';
  clearActionMsg: () => void;
  recentDeployments: RecentDeploymentItem[];
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  triggeringId: string | null;
  onTriggerDeployment: (dep: RecentDeploymentItem) => void;
  onRefreshAll: () => void;
  onNavigate: (path: string) => void;
}

const OverviewContent: React.FC<OverviewContentProps> = ({
  overview,
  loadingOverview,
  clusters,
  clusterHelpers,
  kpiCards,
  alertFilter,
  setAlertFilter,
  actionMsg,
  actionSeverity,
  clearActionMsg,
  recentDeployments,
  runningCount,
  succeededCount,
  failedCount,
  triggeringId,
  onTriggerDeployment,
  onRefreshAll,
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

  const healthData = [
    { name: 'Synced', value: syncedCount },
    { name: 'Needs Sync', value: diffCount },
    { name: 'Missing / Deleted', value: missingCount },
  ];

  // Merge backend platform alerts with live EKS cluster state alerts
  const allAlerts = useMemo<PlatformAlert[]>(() => {
    const clusterAlerts: PlatformAlert[] = [];
    for (const c of clusters) {
      if (c.status === 'FAILED' || c.stateStatus === 'deleted') {
        clusterAlerts.push({
          id: `alert-eks-del-${c.name}`,
          severity: 'error',
          category: 'EKS Cluster',
          title:
            c.status === 'FAILED'
              ? `Cluster Failed: ${c.name}`
              : `Cluster Deleted: ${c.name}`,
          detail: c.deletedAt
            ? `Cluster removed (${c.deletedBy || 'aws'}) in ${c.region}.`
            : `Cluster reports FAILED state in ${c.region}.`,
          timestamp: c.deletedAt || c.createdAt,
          actionPath: '/clusters',
          actionLabel: 'Inspect Clusters',
        });
      } else if (c.stateStatus === 'differences_found') {
        clusterAlerts.push({
          id: `alert-eks-diff-${c.name}`,
          severity: 'warning',
          category: 'EKS State Drift',
          title: `EKS Drift Detected: ${c.name}`,
          detail: `Local control-plane state differs from live AWS EKS in ${c.region}.`,
          timestamp: c.createdAt,
          actionPath: '/clusters',
          actionLabel: 'Sync Cluster',
        });
      } else if (c.stateStatus === 'missing_local') {
        clusterAlerts.push({
          id: `alert-eks-missing-${c.name}`,
          severity: 'info',
          category: 'EKS Discovery',
          title: `Unsynced AWS EKS Cluster: ${c.name}`,
          detail: `Discovered live in AWS (${c.region}) without local baseline state.`,
          timestamp: c.createdAt,
          actionPath: '/clusters',
          actionLabel: 'Sync Cluster',
        });
      }
    }

    const combined = [...(overview?.alerts || []), ...clusterAlerts];
    const rank: Record<PlatformAlertSeverity, number> = { error: 0, warning: 1, info: 2 };
    return combined.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [overview?.alerts, clusters]);

  const filteredAlerts = useMemo(
    () =>
      alertFilter === 'all'
        ? allAlerts
        : allAlerts.filter((a) => a.severity === alertFilter),
    [allAlerts, alertFilter]
  );

  const criticalAlertCount = allAlerts.filter((a) => a.severity === 'error').length;
  const warningAlertCount = allAlerts.filter((a) => a.severity === 'warning').length;
  const infoAlertCount = allAlerts.filter((a) => a.severity === 'info').length;

  const renderDeploymentStatusChip = (dep: RecentDeploymentItem) => {
    const isOk = dep.status === 'Succeeded';
    const isRun = dep.status === 'Running';
    const isFail = dep.status === 'Failed';
    return (
      <Chip
        size="small"
        icon={
          isRun ? (
            <CircularProgress size={13} />
          ) : isOk ? (
            <CheckCircleIcon sx={{ color: '#2563eb !important', fontSize: 15 }} />
          ) : isFail ? (
            <ErrorOutlineIcon sx={{ color: '#dc2626 !important', fontSize: 15 }} />
          ) : undefined
        }
        label={dep.runNumber > 0 ? `#${dep.runNumber} · ${dep.status}` : dep.status}
        sx={{
          fontWeight: 700,
          fontSize: '0.73rem',
          bgcolor: isOk || isRun ? '#eff6ff' : isFail ? '#fee2e2' : '#f1f5f9',
          color: isOk || isRun ? '#1d4ed8' : isFail ? '#b91c1c' : '#334155',
        }}
      />
    );
  };

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
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', mb: 0.5 }}>
            <Typography
              variant="h4"
              component="h1"
              sx={{ fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}
            >
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
          </Box>
          <Typography variant="body2" sx={{ color: '#cbd5e1' }}>
            Real-time control plane visibility across active platform alerts, recent GitOps pipeline deployments, AWS resources, and EKS fleet health.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', flexShrink: 0 }}>
          <Button
            variant="outlined"
            startIcon={
              loadingOverview || clusterHelpers.loading ? (
                <CircularProgress size={15} color="inherit" />
              ) : (
                <RefreshIcon />
              )
            }
            onClick={onRefreshAll}
            sx={{
              color: '#ffffff',
              borderColor: 'rgba(148, 163, 184, 0.45)',
              '&:hover': { borderColor: '#60a5fa', bgcolor: 'rgba(37, 99, 235, 0.16)' },
            }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => onNavigate('/create-cluster')}
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
        <Alert severity={actionSeverity} onClose={clearActionMsg} sx={{ borderRadius: 2 }}>
          {actionMsg}
        </Alert>
      )}

      {/* Top KPI Cards (keyboard-accessible via ButtonBase) */}
      <Grid container spacing={2.5}>
        {kpiCards.map((card) => (
          <Grid item xs={12} sm={6} lg={3} key={card.title}>
            <Perspective3DCard
              sx={{
                height: '100%',
                overflow: 'hidden',
                bgcolor: card.dark ? '#09090b' : 'rgba(255,255,255,0.96)',
                color: card.dark ? '#ffffff' : '#09090b',
                border: card.dark ? '1px solid rgba(59,130,246,0.45)' : undefined,
              }}
            >
              <ButtonBase
                onClick={() => onNavigate(card.path)}
                aria-label={`${card.title}: ${card.value}. Open ${card.title}`}
                sx={{
                  width: '100%',
                  height: '100%',
                  p: 2.5,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  textAlign: 'left',
                  borderRadius: '18px',
                  '&:focus-visible': {
                    outline: '3px solid #2563eb',
                    outlineOffset: '-3px',
                  },
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
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: card.dark ? '#cbd5e1' : '#475569' }}>
                    {card.subtitle}
                  </Typography>
                  <ArrowForwardIcon sx={{ fontSize: 16, color: card.dark ? '#60a5fa' : '#2563eb', flexShrink: 0 }} />
                </Box>
              </ButtonBase>
            </Perspective3DCard>
          </Grid>
        ))}
      </Grid>

      {/* High-Visibility Operational Row: Alerts + Recent Deployments */}
      <Grid container spacing={3} alignItems="stretch">
        {/* Left: Platform Alerts & Attention Required */}
        <Grid item xs={12} lg={5}>
          <Perspective3DCard
            sx={{
              p: 2.5,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 1.25,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AlertIcon sx={{ color: criticalAlertCount > 0 ? '#dc2626' : '#2563eb' }} />
                  <Typography variant="h6" component="h2" sx={{ fontWeight: 800, color: '#09090b' }}>
                    Alerts &amp; Attention
                  </Typography>
                  <Chip
                    size="small"
                    label={allAlerts.length === 0 ? 'All Clear' : `${allAlerts.length} Active`}
                    sx={{
                      fontWeight: 700,
                      bgcolor:
                        criticalAlertCount > 0
                          ? '#fee2e2'
                          : warningAlertCount > 0
                          ? '#fef3c7'
                          : '#eff6ff',
                      color:
                        criticalAlertCount > 0
                          ? '#b91c1c'
                          : warningAlertCount > 0
                          ? '#92400e'
                          : '#1d4ed8',
                    }}
                  />
                </Box>
                <Typography variant="caption" sx={{ color: '#64748b' }}>
                  Live drift, guardrail approvals, pipeline failures, and cluster state checks
                </Typography>
              </Box>

              <Button
                size="small"
                variant="outlined"
                onClick={() => onNavigate('/guardrails')}
                sx={{ borderColor: 'rgba(15,23,42,0.22)', color: '#09090b', fontWeight: 700 }}
              >
                Guardrails
              </Button>
            </Box>

            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {[
                { id: 'all' as const, label: `All (${allAlerts.length})` },
                { id: 'error' as const, label: `Critical (${criticalAlertCount})` },
                { id: 'warning' as const, label: `Warnings (${warningAlertCount})` },
                { id: 'info' as const, label: `Info (${infoAlertCount})` },
              ].map((pill) => {
                const selected = alertFilter === pill.id;
                return (
                  <Chip
                    key={pill.id}
                    size="small"
                    clickable
                    label={pill.label}
                    onClick={() => setAlertFilter(pill.id)}
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.73rem',
                      bgcolor: selected ? '#09090b' : '#f1f5f9',
                      color: selected ? '#ffffff' : '#334155',
                    }}
                  />
                );
              })}
            </Box>

            <Divider />

            {filteredAlerts.length === 0 ? (
              <Box
                sx={{
                  py: 4,
                  px: 2,
                  textAlign: 'center',
                  bgcolor: '#f8fafc',
                  borderRadius: 2.5,
                  border: '1px dashed rgba(37, 99, 235, 0.25)',
                  my: 'auto',
                }}
              >
                <CheckCircleIcon sx={{ fontSize: 34, color: '#2563eb', mb: 0.75 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#09090b' }}>
                  {allAlerts.length === 0
                    ? 'No Active Platform Alerts'
                    : `No ${alertFilter} alerts right now`}
                </Typography>
                <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                  {allAlerts.length === 0
                    ? 'Connected AWS accounts, guardrails, and CI/CD pipelines report no unresolved incidents.'
                    : 'Switch filter above to view other platform notices.'}
                </Typography>
              </Box>
            ) : (
              <Box
                component="ul"
                aria-label="Platform alerts"
                sx={{
                  listStyle: 'none',
                  p: 0,
                  m: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.25,
                  maxBlockSize: 390,
                  overflowY: 'auto',
                  scrollbarGutter: 'stable',
                  overscrollBehavior: 'contain',
                }}
              >
                {filteredAlerts.map((alert) => {
                  const meta = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info;
                  return (
                    <Box
                      component="li"
                      key={alert.id}
                      sx={{
                        p: 1.5,
                        borderRadius: 2.5,
                        border: `1px solid ${meta.border}`,
                        bgcolor: '#ffffff',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.8,
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 1,
                          flexWrap: 'wrap',
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                          {meta.icon}
                          <Chip
                            size="small"
                            label={meta.label}
                            sx={{
                              height: 20,
                              fontSize: '0.66rem',
                              fontWeight: 800,
                              bgcolor: meta.bg,
                              color: meta.color,
                            }}
                          />
                          <Chip
                            size="small"
                            label={alert.category}
                            variant="outlined"
                            sx={{
                              height: 20,
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              borderColor: 'rgba(15,23,42,0.16)',
                              color: '#334155',
                            }}
                          />
                        </Box>
                        <Typography
                          variant="caption"
                          title={alert.timestamp}
                          sx={{ color: '#64748b', fontSize: '0.72rem' }}
                        >
                          {formatRelativeTime(alert.timestamp)}
                        </Typography>
                      </Box>

                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: '#09090b' }}>
                          {alert.title}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: '#475569', display: 'block', mt: 0.25, wordBreak: 'break-word' }}
                        >
                          {alert.detail}
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
                          onClick={() => onNavigate(alert.actionPath)}
                          sx={{ fontSize: '0.76rem', py: 0.25, color: '#2563eb' }}
                        >
                          {alert.actionLabel}
                        </Button>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Perspective3DCard>
        </Grid>

        {/* Right: Recent Deployments / Recent Pipelines */}
        <Grid item xs={12} lg={7}>
          <Perspective3DCard
            sx={{
              p: 2.5,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 1.5,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <RocketLaunchIcon sx={{ color: '#2563eb' }} />
                  <Typography variant="h6" component="h2" sx={{ fontWeight: 800, color: '#09090b' }}>
                    Recent Deployments
                  </Typography>
                  <Chip
                    size="small"
                    label={`${overview?.pipelinesCount ?? 0} Pipelines`}
                    sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}
                  />
                </Box>
                <Typography variant="caption" sx={{ color: '#64748b' }}>
                  Latest CI/CD pipeline runs across Git repositories, Guardrail scans, and kubectl / EKS deploys
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<ArrowForwardIcon />}
                  onClick={() => onNavigate('/pipelines')}
                  sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
                >
                  All Pipelines
                </Button>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                size="small"
                label={`Running: ${runningCount}`}
                sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: '0.73rem' }}
              />
              <Chip
                size="small"
                label={`Succeeded: ${succeededCount}`}
                sx={{ bgcolor: '#dcfce7', color: '#16a34a', fontWeight: 700, fontSize: '0.73rem' }}
              />
              <Chip
                size="small"
                label={`Failed: ${failedCount}`}
                sx={{
                  bgcolor: failedCount > 0 ? '#fee2e2' : '#f1f5f9',
                  color: failedCount > 0 ? '#b91c1c' : '#475569',
                  fontWeight: 700,
                  fontSize: '0.73rem',
                }}
              />
            </Box>

            <Divider />

            {recentDeployments.length === 0 ? (
              <Box
                sx={{
                  py: 4.5,
                  px: 2.5,
                  textAlign: 'center',
                  bgcolor: '#f8fafc',
                  borderRadius: 2.5,
                  border: '1px dashed rgba(15, 23, 42, 0.18)',
                  my: 'auto',
                }}
              >
                <PipelineIcon sx={{ fontSize: 38, color: '#2563eb', mb: 1 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b' }}>
                  No Recent Pipeline Deployments Yet
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: '#475569', maxWidth: 460, mx: 'auto', mt: 0.5, mb: 2 }}
                >
                  Configure a verified GitOps pipeline (`git ls-remote`, Guardrail manifest scan, and `kubectl apply`) to track every rollout here.
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => onNavigate('/pipelines')}
                >
                  Configure Pipeline
                </Button>
              </Box>
            ) : (
              <Box
                component="ul"
                aria-label="Recent pipeline deployments"
                sx={{
                  listStyle: 'none',
                  p: 0,
                  m: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.25,
                  maxBlockSize: 390,
                  overflowY: 'auto',
                  scrollbarGutter: 'stable',
                  overscrollBehavior: 'contain',
                }}
              >
                {recentDeployments.slice(0, 6).map((dep) => {
                  const isRunning = dep.status === 'Running';
                  const isTriggering = triggeringId === dep.pipelineId;
                  return (
                    <Box
                      component="li"
                      key={dep.id}
                      sx={{
                        p: 1.75,
                        borderRadius: 2.5,
                        border: '1px solid rgba(15, 23, 42, 0.1)',
                        bgcolor: '#ffffff',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        '&:hover': {
                          borderColor: 'rgba(37, 99, 235, 0.38)',
                          bgcolor: '#fafcff',
                        },
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: { xs: 'flex-start', sm: 'center' },
                          flexDirection: { xs: 'column', sm: 'row' },
                          gap: 1,
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#09090b' }}>
                            {dep.pipelineName}
                          </Typography>
                          {renderDeploymentStatusChip(dep)}
                          <Chip
                            size="small"
                            label={`${dep.targetCluster} (${dep.namespace})`}
                            sx={{
                              bgcolor: '#09090b',
                              color: '#ffffff',
                              fontWeight: 600,
                              fontSize: '0.71rem',
                              maxWidth: 230,
                            }}
                          />
                        </Box>

                        <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<TerminalIcon sx={{ fontSize: 15 }} />}
                            onClick={() =>
                              onNavigate(`/pipelines?pipelineId=${encodeURIComponent(dep.pipelineId)}`)
                            }
                            sx={{
                              borderColor: 'rgba(15,23,42,0.2)',
                              color: '#09090b',
                              fontSize: '0.74rem',
                              py: 0.3,
                            }}
                          >
                            Logs
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={isRunning || isTriggering}
                            startIcon={
                              isRunning || isTriggering ? (
                                <CircularProgress size={13} color="inherit" />
                              ) : (
                                <PlayArrowIcon sx={{ fontSize: 15 }} />
                              )
                            }
                            onClick={() => onTriggerDeployment(dep)}
                            sx={{ fontSize: '0.74rem', py: 0.3 }}
                          >
                            {isRunning ? 'Running' : 'Run'}
                          </Button>
                        </Box>
                      </Box>

                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 1,
                          minWidth: 0,
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            color: '#475569',
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={`${dep.repositoryUrl}@${dep.branch}`}
                        >
                          Branch: <strong>{dep.branch}</strong> · SHA: <code>{dep.commitSha}</code>
                          {dep.durationSec > 0 ? ` · ${dep.durationSec}s` : ''}
                        </Typography>
                        <Typography
                          variant="caption"
                          title={dep.triggeredAt}
                          sx={{ color: '#64748b', flexShrink: 0 }}
                        >
                          {formatRelativeTime(dep.triggeredAt)}
                        </Typography>
                      </Box>

                      {dep.stagesSummary.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                          {dep.stagesSummary.map((st, idx) => (
                            <Chip
                              key={`${dep.id}-${st.name}-${idx}`}
                              size="small"
                              label={`${st.name}: ${st.status}`}
                              sx={{
                                height: 21,
                                fontSize: '0.68rem',
                                fontWeight: 600,
                                bgcolor:
                                  st.status === 'Failed'
                                    ? '#fef2f2'
                                    : st.status === 'Succeeded'
                                    ? '#eff6ff'
                                    : '#f1f5f9',
                                color:
                                  st.status === 'Failed'
                                    ? '#b91c1c'
                                    : st.status === 'Succeeded'
                                    ? '#1d4ed8'
                                    : '#475569',
                              }}
                            />
                          ))}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Perspective3DCard>
        </Grid>
      </Grid>

      {/* Fleet & Compliance Snapshot Row (distinct from dedicated /clusters inventory table) */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
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
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <StorageIcon sx={{ color: '#2563eb' }} />
                  <Typography variant="h6" component="h2" sx={{ fontWeight: 700, color: '#09090b' }}>
                    EKS Fleet Health
                  </Typography>
                </Box>
                <Button
                  size="small"
                  endIcon={<ArrowForwardIcon />}
                  onClick={() => onNavigate('/clusters')}
                  sx={{ color: '#2563eb', fontWeight: 700 }}
                >
                  Open Clusters
                </Button>
              </Box>

              <ClusterHealth data={healthData} />

              {clusters.length > 0 && (
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 2 }}>
                  {clusters.slice(0, 4).map((c) => (
                    <Chip
                      key={c.name}
                      size="small"
                      label={`${c.name} · ${c.status}`}
                      onClick={() => onNavigate('/clusters')}
                      clickable
                      sx={{
                        fontWeight: 600,
                        bgcolor: c.status === 'ACTIVE' ? '#eff6ff' : '#fef3c7',
                        color: c.status === 'ACTIVE' ? '#1d4ed8' : '#92400e',
                      }}
                    />
                  ))}
                </Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
              <Chip
                label={`Total Clusters: ${clusters.length}`}
                sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => onNavigate('/clusters')}
                sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
              >
                Manage All EKS Clusters
              </Button>
            </Box>
          </Perspective3DCard>
        </Grid>

        <Grid item xs={12} md={6}>
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
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <GuardrailIcon sx={{ color: '#2563eb' }} />
                  <Typography variant="h6" component="h2" sx={{ fontWeight: 700, color: '#09090b' }}>
                    Cloud &amp; Guardrail Posture
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={overview?.awsConnected ? 'AWS IAM Connected' : 'AWS Not Connected'}
                  sx={{
                    fontWeight: 700,
                    bgcolor: overview?.awsConnected ? '#eff6ff' : '#fee2e2',
                    color: overview?.awsConnected ? '#1d4ed8' : '#b91c1c',
                  }}
                />
              </Box>

              <Typography variant="body2" sx={{ color: '#475569', mb: 2 }}>
                {overview?.awsConnected
                  ? `Monitoring ${overview.resourcesCount} live AWS resource(s) (${overview.driftedResources} drifted) against ${overview.enabledGuardrails} active policy rule(s).`
                  : 'Connect an AWS IAM account in Integrations to discover live RDS, ElastiCache, S3, SQS, and EKS resources.'}
              </Typography>

              <Grid container spacing={1.5}>
                <Grid item xs={6}>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc', border: '1px solid rgba(15,23,42,0.08)' }}>
                    <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                      DRIFTED RESOURCES
                    </Typography>
                    <Typography
                      variant="h5"
                      sx={{
                        fontWeight: 800,
                        color: (overview?.driftedResources ?? 0) > 0 ? '#d97706' : '#09090b',
                      }}
                    >
                      {overview ? overview.driftedResources : '—'}
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc', border: '1px solid rgba(15,23,42,0.08)' }}>
                    <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                      PENDING APPROVALS
                    </Typography>
                    <Typography
                      variant="h5"
                      sx={{
                        fontWeight: 800,
                        color: (overview?.pendingApprovals ?? 0) > 0 ? '#2563eb' : '#09090b',
                      }}
                    >
                      {overview ? overview.pendingApprovals : '—'}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </Box>

            <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => onNavigate('/resources')}
                sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
              >
                Cloud Resources
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => onNavigate('/guardrails')}
                sx={{ borderColor: 'rgba(15,23,42,0.22)', color: '#09090b', fontWeight: 700 }}
              >
                Audit &amp; Approvals
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => onNavigate('/integrations')}
                sx={{ borderColor: 'rgba(15,23,42,0.22)', color: '#09090b', fontWeight: 700 }}
              >
                Connectors
              </Button>
            </Box>
          </Perspective3DCard>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
