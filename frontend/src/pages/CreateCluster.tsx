import React, { useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Button,
  Typography,
  Grid,
  Chip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';
import { useTesserakAuth } from '../auth/AuthContext';
import { invalidateSwrCache } from '../utils/swrCache';
import ClusterBasicDetails from '../components/CreateCluster/ClusterBasicDetails';
import ClusterEnvironment from '../components/CreateCluster/ClusterEnvironment';
import ClusterAddons from '../components/CreateCluster/ClusterAddons';
import ClusterPreview from '../components/CreateCluster/ClusterPreview';
import Perspective3DCard from '../components/Perspective3DCard';

const steps = ['Basic Details', 'Environment Setup', 'Add-ons', 'Preview'];

export interface ClusterConfig {
  name: string;
  accountId: string;
  accountName?: string;
  region: string;
  vpc: {
    id: string;
    isNew: boolean;
    cidr?: string;
  };
  amiType: string;
  amiId: string;
  amiManual?: boolean;
  createNodeGroup?: boolean;
  nodeGroupName?: string;
  instanceType?: string;
  capacityType?: 'ON_DEMAND' | 'SPOT';
  minNodes?: number;
  desiredNodes?: number;
  maxNodes?: number;
  diskSize?: number;
  publicSubnets?: string[];
  privateSubnets?: string[];
  enableClusterLogs?: boolean;
  environment: {
    type: 'Non-Prod' | 'Prod';
    endpoint: 'public' | 'public-private' | 'private';
    availabilityZones: string[];
    kubernetesVersion: string;
  };
  tags: Array<{ key: string; value: string }>;
  addons: Array<{
    id: string;
    name: string;
    type: 'aws' | 'community';
    version: string;
    configuration?: any;
  }>;
}

const CreateCluster: React.FC = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || '';
  const [config, setConfig] = useState<ClusterConfig>({
    name: '',
    accountId: '',
    accountName: '',
    region: '',
    vpc: {
      id: '',
      isNew: false,
    },
    amiType: 'amazon-linux-2023/x86_64/standard',
    amiId: '',
    amiManual: false,
    createNodeGroup: true,
    nodeGroupName: '',
    instanceType: 't3.medium',
    capacityType: 'ON_DEMAND',
    minNodes: 1,
    desiredNodes: 2,
    maxNodes: 4,
    diskSize: 20,
    publicSubnets: [],
    privateSubnets: [],
    enableClusterLogs: false,
    environment: {
      type: '' as 'Non-Prod' | 'Prod',
      endpoint: '' as 'public' | 'public-private' | 'private',
      availabilityZones: [],
      kubernetesVersion: '',
    },
    tags: [],
    addons: [],
  });

  const handleNext = () => {
    setSubmitError(null);
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setSubmitError(null);
    setActiveStep((prevStep) => prevStep - 1);
  };

  const extractApiError = (detail: any, fallback: string): string => {
    if (!detail) return fallback;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => `${(d.loc || []).join('.')}: ${d.msg}`).join('; ') || fallback;
    }
    return detail.error_description || detail.message || fallback;
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    let payloadConfig = { ...config, vpc: { ...config.vpc } };

    try {
      if (payloadConfig.vpc.isNew) {
        const vpcResponse = await fetch('http://localhost:8000/api/vpc', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-email': userEmail,
          },
          body: JSON.stringify({
            name: `${payloadConfig.name}-vpc`,
            cidr: payloadConfig.vpc.cidr || '10.0.0.0/16',
            region: payloadConfig.region,
            accountId: payloadConfig.accountId,
            availabilityZones: payloadConfig.environment.availabilityZones,
          }),
        });

        const vpcData = await vpcResponse.json().catch(() => ({}));
        if (!vpcResponse.ok) {
          throw new Error(extractApiError(vpcData.detail, 'Failed to create VPC'));
        }
        payloadConfig.vpc.id = vpcData.vpcId;
      }

      const response = await fetch('http://localhost:8000/clusters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail,
        },
        body: JSON.stringify(payloadConfig),
      });

      const resData = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiError(resData.detail, 'Failed to create cluster'));
      }

      invalidateSwrCache(userEmail, 'clusters');
      invalidateSwrCache(userEmail, 'overview');
      invalidateSwrCache(userEmail, 'guardrails');
      navigate('/clusters');
    } catch (error: any) {
      setSubmitError(error?.message || 'Failed to create EKS cluster');
    } finally {
      setSubmitting(false);
    }
  };

  const stackLayers = [
    {
      title: 'Layer 3 · Active Add-ons',
      subtitle:
        config.addons.length > 0
          ? config.addons.map((a) => a.name).join(' · ')
          : 'VPC CNI · kube-proxy · CoreDNS (pending)',
      borderColor: activeStep >= 2 ? '#2563eb' : '#e2e8f0',
      bg: '#ffffff',
      tz: 42,
    },
    {
      title: 'Layer 2 · EKS Control Plane & AMI',
      subtitle: `${config.name || 'Unnamed Cluster'} · K8s ${
        config.environment.kubernetesVersion || 'Latest'
      } · ${config.amiId || config.amiType}${
        config.createNodeGroup !== false
          ? ` · ${config.desiredNodes ?? 2}× ${config.instanceType || 't3.medium'}`
          : ''
      }`,
      borderColor: activeStep >= 1 ? '#60a5fa' : '#e2e8f0',
      bg: '#eff6ff',
      tz: 20,
    },
    {
      title: 'Layer 1 · Network Foundation',
      subtitle: `${
        config.vpc.isNew
          ? `New VPC (${config.vpc.cidr || 'CIDR TBD'})`
          : config.vpc.id || 'VPC pending'
      } · ${config.region || 'region TBD'}`,
      borderColor: activeStep >= 0 ? '#2563eb' : '#e2e8f0',
      bg: '#ffffff',
      tz: 0,
    },
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 1 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ color: 'text.primary' }}>
          Create New Cluster
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Provision an AWS EKS control plane with verified add-ons and live 3D stack preview
        </Typography>
      </Box>

      {/* 3D Perspective Stepper Pill Track */}
      <Grid container spacing={2} sx={{ mb: 4, perspective: '1200px' }}>
        {steps.map((label, idx) => {
          const isDone = idx < activeStep;
          const isCurr = idx === activeStep;
          return (
            <Grid item xs={12} sm={6} md={3} key={label}>
              <Box
                onClick={() => idx <= activeStep && setActiveStep(idx)}
                sx={{
                  px: 2.25,
                  py: 1.5,
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: idx <= activeStep ? 'pointer' : 'default',
                  background: isCurr
                    ? 'linear-gradient(45deg, #09090b, #2563eb)'
                    : isDone
                    ? '#dcfce7'
                    : '#ffffff',
                  color: isCurr ? '#ffffff' : isDone ? '#16a34a' : 'text.secondary',
                  border: '1px solid',
                  borderColor: isCurr ? 'transparent' : isDone ? '#86efac' : '#e2e8f0',
                  boxShadow: isCurr
                    ? '0 14px 28px -4px rgba(37, 99, 235, 0.32)'
                    : '0 4px 12px rgba(15, 23, 42, 0.05)',
                  transform: isCurr
                    ? 'translateZ(18px) rotateX(3deg)'
                    : 'translateZ(2px)',
                  transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {idx + 1}. {label}
                </Typography>
                {isDone && <CheckCircleIcon fontSize="small" />}
              </Box>
            </Grid>
          );
        })}
      </Grid>

      <Grid container spacing={3} alignItems="flex-start">
        {/* Left Main Wizard Panel */}
        <Grid item xs={12} md={8}>
          <Perspective3DCard
            perspective={1300}
            baseRotateX={1.2}
            baseRotateY={1.5}
            hoverLiftZ={6}
            flattenOnFocus
            sx={{ p: 3 }}
          >
            {submitError && (
              <Alert severity="error" sx={{ mb: 2.5 }} onClose={() => setSubmitError(null)}>
                {submitError}
              </Alert>
            )}

            {activeStep === 0 && <ClusterBasicDetails config={config} onChange={setConfig} />}
            {activeStep === 1 && <ClusterEnvironment config={config} onChange={setConfig} />}
            {activeStep === 2 && <ClusterAddons config={config} onChange={setConfig} />}
            {activeStep === 3 && <ClusterPreview config={config} />}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 4 }}>
              <Button variant="outlined" onClick={handleBack} disabled={activeStep === 0 || submitting}>
                Back
              </Button>
              {activeStep === steps.length - 1 ? (
                <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? (
                    <>
                      <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} />
                      Creating Cluster...
                    </>
                  ) : (
                    'Create Cluster'
                  )}
                </Button>
              ) : (
                <Button variant="contained" onClick={handleNext}>
                  Next
                </Button>
              )}
            </Box>
          </Perspective3DCard>
        </Grid>

        {/* Right Live 3D Cluster Stack Architecture Preview */}
        <Grid item xs={12} md={4}>
          <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary' }}>
              Live 3D Stack Blueprint
            </Typography>
            <Chip
              label={config.environment.type || 'Draft'}
              size="small"
              color="primary"
              variant="outlined"
            />
          </Box>
          <Box
            sx={{
              perspective: '1100px',
              transformStyle: 'preserve-3d',
              display: 'flex',
              flexDirection: 'column',
              gap: 2.25,
              transform: { md: 'rotateX(6deg) rotateY(-8deg)' },
              transition: 'transform 0.35s ease',
            }}
          >
            {stackLayers.map((layer) => (
              <Box
                key={layer.title}
                sx={{
                  p: 2.25,
                  borderRadius: '14px',
                  bgcolor: layer.bg,
                  border: '1.5px solid',
                  borderColor: layer.borderColor,
                  boxShadow:
                    '0 18px 34px -8px rgba(30, 64, 175, 0.16), 0 6px 14px rgba(15, 23, 42, 0.06)',
                  transform: `translateZ(${layer.tz}px)`,
                  transition: 'transform 0.25s ease, border-color 0.25s ease',
                  '&:hover': {
                    transform: `translateZ(${layer.tz + 14}px) translateY(-2px)`,
                  },
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main', mb: 0.75 }}>
                  {layer.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {layer.subtitle}
                </Typography>
              </Box>
            ))}
          </Box>
        </Grid>
      </Grid>
    </Container>
  );
};

export default CreateCluster;
