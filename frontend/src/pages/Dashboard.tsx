import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Typography,
} from '@mui/material';
import {
  AccountTree as PipelineIcon,
  Add as AddIcon,
  ArrowForward as ArrowForwardIcon,
  Cable as CableIcon,
  CloudQueue as CloudQueueIcon,
  GppGood as GuardrailIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import ClusterHealth from '../components/ClusterHealth';
import ClusterListManager from '../components/ClusterListManager';
import ClusterTable from '../components/ClusterTable';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { PlatformOverview } from '../types/atmosly';
import { Cluster } from '../types/cluster';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const userEmail = localStorage.getItem('currentUser') || 'demo@tesserak.dev';

  useEffect(() => {
    fetch('http://localhost:8000/api/atmosly/overview', {
      headers: { 'x-user-email': userEmail },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setOverview(data);
      })
      .catch(() => null);
  }, [userEmail]);

  const handleDeleteCluster = async (clusterName: string) => {
    try {
      const response = await fetch(`http://localhost:8000/clusters/${clusterName}`, {
        method: 'DELETE',
        headers: {
          'x-user-email': userEmail,
        },
      });
      if (response.ok) {
        setActionMsg(`Deletion initiated for cluster "${clusterName}".`);
      } else {
        setActionMsg(`Unable to delete cluster "${clusterName}" right now.`);
      }
    } catch {
      setActionMsg(`Failed to reach backend to delete "${clusterName}".`);
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
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
          </Box>
          <Typography variant="body2" sx={{ color: '#cbd5e1' }}>
            Real AWS EKS clusters, live Boto3 cloud resource discovery, verified Git/Registry integrations, and real Git + kubectl pipelines.
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/create-cluster')}
          sx={{
            px: 2.5,
            py: 1.15,
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

      {actionMsg && (
        <Alert severity="info" onClose={() => setActionMsg('')} sx={{ borderRadius: 2 }}>
          {actionMsg}
        </Alert>
      )}

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

      <ClusterListManager>
        {(clusters: Cluster[]) => {
          const syncedCount = clusters.filter((c) => c.stateStatus === 'synced').length;
          const diffCount = clusters.filter((c) => c.stateStatus === 'differences_found').length;
          const missingCount = clusters.filter(
            (c) => c.stateStatus === 'missing_local' || c.stateStatus === 'deleted'
          ).length;

          const healthData = [
            { name: 'Synced', value: syncedCount },
            { name: 'Needs Sync', value: diffCount },
            { name: 'Missing / Deleted', value: missingCount },
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
                <Perspective3DCard sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <StorageIcon sx={{ color: '#2563eb' }} />
                      <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b' }}>
                        AWS EKS Fleet Status
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: '#475569', mb: 2 }}>
                      {clusters.length === 0
                        ? 'No active EKS clusters found yet. Connect an AWS IAM account in Integrations or launch a new EKS cluster.'
                        : `Tracking ${clusters.length} live EKS cluster(s) with 60s automated AWS state reconciliation.`}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
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
                      variant="outlined"
                      onClick={() => navigate('/integrations')}
                      sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
                    >
                      Manage Cloud Connectors
                    </Button>
                  </Box>
                </Perspective3DCard>
              </Grid>

              <Grid item xs={12}>
                <Perspective3DCard sx={{ p: 2.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b', mb: 1.5 }}>
                    Kubernetes Clusters
                  </Typography>
                  <ClusterTable clusters={clusters} onDeleteCluster={handleDeleteCluster} />
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
