import React from 'react';
import {
  Box,
  Typography,
  FormControlLabel,
  Checkbox,
  Tooltip,
  IconButton,
  Card,
  CardContent,
  Grid,
  Select,
  MenuItem,
  FormControl,
  SelectChangeEvent
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import { useTesserakAuth } from '../../auth/AuthContext';
import { ClusterConfig } from '../../pages/CreateCluster';

interface Props {
  config: ClusterConfig;
  onChange: (config: ClusterConfig) => void;
}

interface AddonVersion {
  version: string;
  defaultVersion: boolean;
  isLatest?: boolean;
}

interface AddonVersions {
  [key: string]: AddonVersion[];
}

interface Addon {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  type: 'aws' | 'community';
  defaultVersion?: string;
}


const AWS_ADDONS: Addon[] = [
  {
    id: 'vpc-cni',
    name: 'Amazon VPC CNI',
    description: 'Amazon VPC Container Network Interface (CNI) plugin for pod networking',
    recommended: true,
    type: 'aws',
  },
  {
    id: 'kube-proxy',
    name: 'kube-proxy',
    description: 'Kubernetes network proxy that runs on each node',
    recommended: true,
    type: 'aws',
  },
  {
    id: 'coredns',
    name: 'CoreDNS',
    description: 'DNS server/forwarder that chains plugins for Kubernetes service discovery',
    recommended: true,
    type: 'aws',
  },
  {
    id: 'eks-pod-identity-agent',
    name: 'Amazon EKS Pod Identity Agent',
    description: 'Enables fine-grained IAM permissions for pods',
    recommended: true,
    type: 'aws',
  },
  {
    id: 'aws-ebs-csi-driver',
    name: 'Amazon EBS CSI Driver',
    description: 'CSI interface for managing EBS volumes',
    recommended: false,
    type: 'aws',
  },
  {
    id: 'aws-efs-csi-driver',
    name: 'Amazon EFS CSI Driver',
    description: 'CSI interface for managing EFS volumes',
    recommended: false,
    type: 'aws',
  },
  {
    id: 'aws-fsx-csi-driver',
    name: 'Amazon FSx CSI Driver',
    description: 'CSI interface for managing Amazon FSx for Lustre storage',
    recommended: false,
    type: 'aws',
  },
  {
    id: 'snapshot-controller',
    name: 'CSI Snapshot Controller',
    description: 'Manages VolumeSnapshot CRDs for CSI volume backups',
    recommended: false,
    type: 'aws',
  },
];

const COMMUNITY_ADDONS: Addon[] = [
  {
    id: 'ingress-nginx',
    name: 'Ingress NGINX',
    description: 'Handles routing of external HTTP/S traffic to Kubernetes services.',
    type: 'community',
    defaultVersion: '4.12.1',
  },
  {
    id: 'cert-manager',
    name: 'Cert Manager',
    description: 'Automates management and issuance of TLS certificates within your cluster.',
    type: 'community',
    defaultVersion: '1.19.1',
  },
  {
    id: 'external-dns',
    name: 'External DNS',
    description: 'Synchronizes exposed Kubernetes Services and Ingresses with DNS providers.',
    type: 'community',
    defaultVersion: '0.20.0',
  },
  {
    id: 'argo-cd',
    name: 'Argo CD',
    description: 'Declarative GitOps continuous delivery controller for Kubernetes.',
    type: 'community',
    defaultVersion: '2.14.8',
  },
  {
    id: 'argo-workflow',
    name: 'Argo Workflows',
    description: 'Orchestrates parallel jobs and complex Kubernetes workflows.',
    type: 'community',
    defaultVersion: '3.6.5',
  },
  {
    id: 'metrics-server',
    name: 'Metrics Server',
    description: 'Collects resource metrics from Kubelets for HPA and VPA.',
    type: 'community',
    defaultVersion: '0.8.0',
  },
  {
    id: 'reloader',
    name: 'Reloader',
    description: 'Hot-reloads Kubernetes deployments on ConfigMap or Secret changes.',
    type: 'community',
    defaultVersion: '1.4.1',
  },
  {
    id: 'cluster-proportional-autoscaler',
    name: 'Cluster Proportional Autoscaler',
    description: 'Auto-scales cluster components like CoreDNS based on cluster size.',
    type: 'community',
    defaultVersion: '1.9.0',
  },
  {
    id: 'cluster-autoscaler',
    name: 'Cluster Autoscaler',
    description: 'Automatically adjusts the size of Kubernetes node groups based on pod demand.',
    type: 'community',
    defaultVersion: '1.32.1',
  },
  {
    id: 'karpenter',
    name: 'Karpenter',
    description: 'High-performance node autoscaler for dynamic EC2 provisioning.',
    type: 'community',
    defaultVersion: '1.3.3',
  },
  {
    id: 'aws-load-balancer-controller',
    name: 'AWS Load Balancer Controller',
    description: 'Manages AWS ALB and NLB instances for routing external traffic to services.',
    type: 'community',
    defaultVersion: '2.12.0',
  },
  {
    id: 'ops-agent',
    name: 'Ops Agent',
    description: 'Cluster operations telemetry agent for health and incident diagnostics.',
    type: 'community',
    defaultVersion: '1.4.2',
  },
  {
    id: 'grafana-stack',
    name: 'Grafana Stack',
    description: 'Bundles Prometheus monitoring, Grafana dashboards, and Loki log aggregation.',
    type: 'community',
    defaultVersion: '70.4.2',
  },
  {
    id: 'debug-agent',
    name: 'Debug Agent',
    description: 'Provides ephemeral node and pod diagnostics for cluster troubleshooting.',
    type: 'community',
    defaultVersion: '1.2.0',
  },
];


// Always select the latest version as default
const getAppropriateVersion = (versions: AddonVersion[]): string | undefined => {
  const latestVersion = versions.find((v) => v.isLatest);
  if (latestVersion) {
    return latestVersion.version;
  }

  if (versions.length > 0) {
    return versions[0].version;
  }

  const defaultVersion = versions.find((v) => v.defaultVersion);
  if (defaultVersion) {
    return defaultVersion.version;
  }

  return undefined;
};

const COMMUNITY_FALLBACK_VERSIONS: AddonVersions = COMMUNITY_ADDONS.reduce((acc, addon) => {
  if (addon.defaultVersion) {
    acc[addon.id] = [
      {
        version: addon.defaultVersion,
        defaultVersion: true,
        isLatest: true,
      },
    ];
  }
  return acc;
}, {} as AddonVersions);

const ClusterAddons: React.FC<Props> = ({ config, onChange }) => {
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || '';
  const [addonVersions, setAddonVersions] = React.useState<AddonVersions>(COMMUNITY_FALLBACK_VERSIONS);
  const selectedIds = config.addons.map((a) => a.id);

  React.useEffect(() => {
    const fetchAddonVersions = async () => {
      try {
        if (!userEmail || !config.environment.kubernetesVersion) {
          return;
        }

        const regionQuery = config.region ? `?region=${encodeURIComponent(config.region)}` : '';
        const response = await fetch(
          `http://localhost:8000/api/aws/addon-versions/${config.environment.kubernetesVersion}${regionQuery}`,
          {
            headers: {
              'X-User-Email': userEmail,
            },
          }
        );

        if (!response.ok) {
          setAddonVersions(COMMUNITY_FALLBACK_VERSIONS);
          return;
        }

        const rawVersions: AddonVersions = await response.json();
        const mergedVersions: AddonVersions = {
          ...COMMUNITY_FALLBACK_VERSIONS,
          ...rawVersions,
        };
        setAddonVersions(mergedVersions);

        // Automatically select recommended addons with their LATEST versions
        if (config.addons.length === 0) {
          const requiredAddons = ['vpc-cni', 'kube-proxy', 'coredns'];
          const newAddons = requiredAddons
            .map((addonId) => {
              const addonInfo = AWS_ADDONS.find((a) => a.id === addonId);
              const versionsList = mergedVersions[addonId] || [];
              const latestVer = getAppropriateVersion(versionsList);

              if (addonInfo && latestVer) {
                return {
                  id: addonId,
                  name: addonInfo.name,
                  type: 'aws' as const,
                  version: latestVer,
                };
              }
              return null;
            })
            .filter(
              (addon): addon is { id: string; name: string; type: 'aws'; version: string } =>
                addon !== null
            );

          if (newAddons.length > 0) {
            onChange({ ...config, addons: newAddons });
          }
        }
      } catch (error) {
        console.error('Error fetching addon versions:', error);
      }
    };

    if (config.environment.kubernetesVersion) {
      fetchAddonVersions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.environment.kubernetesVersion, config.region, userEmail]);

  const getAvailableVersions = (addon: Addon): AddonVersion[] => {
    const versions = addonVersions[addon.id] || [];
    if (versions.length > 0) return versions;
    if (addon.type === 'community' && addon.defaultVersion) {
      return [{ version: addon.defaultVersion, defaultVersion: true, isLatest: true }];
    }
    return [];
  };

  const handleAddonToggle = (addon: Addon) => {
    const exists = selectedIds.includes(addon.id);
    let newAddons;

    if (exists) {
      newAddons = config.addons.filter((a) => a.id !== addon.id);
    } else {
      const versions = getAvailableVersions(addon);
      const version = getAppropriateVersion(versions) || addon.defaultVersion;

      if (!version) {
        return;
      }

      newAddons = [
        ...config.addons,
        {
          id: addon.id,
          name: addon.name,
          type: addon.type,
          version,
        },
      ];
    }

    onChange({ ...config, addons: newAddons });
  };

  const handleVersionChange = (addonId: string, version: string) => {
    const newAddons = config.addons.map(addon => 
      addon.id === addonId ? { ...addon, version } : addon
    );
    onChange({ ...config, addons: newAddons });
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        AWS Add-ons
      </Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {AWS_ADDONS.map((addon) => (
          <Grid item xs={12} md={6} key={addon.id}>
          <Card variant="outlined" sx={{ height: '100%', transition: 'border-color 0.2s ease, box-shadow 0.2s ease', '&:hover': { borderColor: '#2563eb', boxShadow: '0 6px 16px rgba(37, 99, 235, 0.08)' } }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={selectedIds.includes(addon.id)}
                        onChange={() => handleAddonToggle(addon)}
                      />
                    }
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
                        <Typography sx={{ fontWeight: 600 }}>{addon.name}</Typography>
                        {addon.recommended && (
                          <Typography
                            variant="caption"
                            sx={{ bgcolor: 'primary.main', color: 'white', px: 1, py: 0.25, borderRadius: 1 }}
                          >
                            Recommended
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                  <Tooltip title={addon.description}>
                    <IconButton size="small">
                      <InfoIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {addon.description}
                </Typography>
              </Box>
              {selectedIds.includes(addon.id) && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                    Version:
                  </Typography>
                  <FormControl size="small" sx={{ minWidth: 185 }}>
                    <Select
                      value={config.addons.find(a => a.id === addon.id)?.version || ''}
                      onChange={(e: SelectChangeEvent<string>) => handleVersionChange(addon.id, e.target.value)}
                      displayEmpty
                      sx={{ height: 32 }}
                    >
                      {getAvailableVersions(addon).map(version => (
                        <MenuItem
                          key={version.version}
                          value={version.version}
                          sx={{
                            fontWeight: version.defaultVersion || version.isLatest ? 'bold' : 'normal',
                            color: version.defaultVersion ? 'primary.main' : 'inherit'
                          }}
                        >
                          {version.version}
                          {version.defaultVersion && ' (Default)'}
                          {version.isLatest && !version.defaultVersion && ' (Latest)'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              )}
            </CardContent>
          </Card>
          </Grid>
        ))}
      </Grid>

      <Typography variant="h6" sx={{ mb: 2 }}>
        Cluster &amp; Community Add-ons
      </Typography>
      <Grid container spacing={2}>
        {COMMUNITY_ADDONS.map((addon) => (
          <Grid item xs={12} md={6} key={addon.id}>
          <Card variant="outlined" sx={{ height: '100%', transition: 'border-color 0.2s ease, box-shadow 0.2s ease', '&:hover': { borderColor: '#2563eb', boxShadow: '0 6px 16px rgba(37, 99, 235, 0.08)' } }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={selectedIds.includes(addon.id)}
                        onChange={() => handleAddonToggle(addon)}
                      />
                    }
                    label={
                      <Typography sx={{ fontWeight: 600 }}>{addon.name}</Typography>
                    }
                  />
                  <Tooltip title={addon.description}>
                    <IconButton size="small">
                      <InfoIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {addon.description}
                </Typography>
              </Box>
              {selectedIds.includes(addon.id) && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                    Version:
                  </Typography>
                  <FormControl size="small" sx={{ minWidth: 145 }}>
                    <Select
                      value={config.addons.find(a => a.id === addon.id)?.version || ''}
                      onChange={(e: SelectChangeEvent<string>) => handleVersionChange(addon.id, e.target.value)}
                      displayEmpty
                      sx={{ height: 32 }}
                    >
                      {getAvailableVersions(addon).map(version => (
                        <MenuItem
                          key={version.version}
                          value={version.version}
                          sx={{
                            fontWeight: version.defaultVersion || version.isLatest ? 'bold' : 'normal',
                            color: version.defaultVersion ? 'primary.main' : 'inherit'
                          }}
                        >
                          {version.version}
                          {version.defaultVersion && ' (Default)'}
                          {version.isLatest && !version.defaultVersion && ' (Latest)'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              )}
            </CardContent>
          </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default ClusterAddons;
