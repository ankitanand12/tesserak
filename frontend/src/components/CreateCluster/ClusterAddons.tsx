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
  Stack,
  Select,
  MenuItem,
  FormControl,
  SelectChangeEvent
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
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
];

const COMMUNITY_ADDONS: Addon[] = [
  {
    id: 'external-dns',
    name: 'External DNS',
    description: 'Synchronizes exposed Kubernetes Services and Ingresses with DNS providers.',
    type: 'community',
    defaultVersion: '0.13.5'
  },
  {
    id: 'cert-manager',
    name: 'Cert Manager',
    description: 'Automates management and issuance of TLS certificates.',
    type: 'community',
    defaultVersion: '0.13.5'
  },
  {
    id: 'metrics-server',
    name: 'Metrics Server',
    description: 'Collects resource metrics from Kubelets and exposes them to the metrics API for use by HPA and VPA.',
    type: 'community',
    defaultVersion: '1.12.3'
  }
];


// Helper function to get appropriate version for an addon
const getAppropriateVersion = (versions: AddonVersion[]): string | undefined => {
  // First try to get the default version
  const defaultVersion = versions.find(v => v.defaultVersion);
  if (defaultVersion) {
    return defaultVersion.version;
  }

  // If no default version, try to get the latest version
  const latestVersion = versions.find(v => v.isLatest);
  if (latestVersion) {
    return latestVersion.version;
  }

  // If neither default nor latest, get the first version
  if (versions.length > 0) {
    return versions[0].version;
  }

  return undefined;
};

const ClusterAddons: React.FC<Props> = ({ config, onChange }) => {
  const [addonVersions, setAddonVersions] = React.useState<AddonVersions>({});
  const selectedIds = config.addons.map(a => a.id);

  React.useEffect(() => {
    const fetchAddonVersions = async () => {
      try {
        const currentUser = localStorage.getItem('currentUser');
        if (!currentUser) {
          console.warn('User not logged in');
          return;
        }

        if (!config.environment.kubernetesVersion) {
          console.warn('Kubernetes version not set');
          return;
        }

        console.log('Fetching addon versions for K8s version:', config.environment.kubernetesVersion);

        const response = await fetch(`http://localhost:8000/api/aws/addon-versions/${config.environment.kubernetesVersion}`, {
          headers: {
            'X-User-Email': currentUser,
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Failed to fetch versions:', errorText);
          // For community addons, use default version as fallback
          setAddonVersions(COMMUNITY_ADDONS.reduce((acc, addon) => {
            if (addon.defaultVersion) {
              acc[addon.id] = [{
                version: addon.defaultVersion,
                defaultVersion: true,
                isLatest: true
              }];
            }
            return acc;
          }, {} as AddonVersions));
          return;
        }

        const versions: AddonVersions = await response.json();
        console.log('Received addon versions:', versions);

        setAddonVersions(versions);

        // Automatically select required addons with their latest versions
        if (config.addons.length === 0) {
          const requiredAddons = ['vpc-cni', 'kube-proxy', 'coredns'];
          const newAddons = requiredAddons
            .map(addonId => {
              const addonInfo = AWS_ADDONS.find(a => a.id === addonId);
              const addonVersions = versions[addonId] || [];
              const defaultVersion = addonVersions.find(v => v.defaultVersion)?.version ||
                                   addonVersions.find(v => v.isLatest)?.version ||
                                   addonVersions[0]?.version;
              
              if (addonInfo && defaultVersion) {
                return {
                  id: addonId,
                  name: addonInfo.name,
                  type: 'aws' as const,
                  version: defaultVersion
                };
              }
              return null;
            })
            .filter((addon): addon is { id: string; name: string; type: 'aws'; version: string } => 
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
  }, [config.environment.kubernetesVersion, config.addons.length, onChange]);

  const getAvailableVersions = (addon: Addon) => {
    const versions = addonVersions[addon.id] || [];
    console.log(`Getting versions for ${addon.id}:`, versions);
    
    if (versions.length === 0) {
      console.log(`No versions found for ${addon.id}`);
    }
    
    return versions;
  };

  const handleAddonToggle = (addon: Addon) => {
    const exists = selectedIds.includes(addon.id);
    let newAddons;
    
    if (exists) {
      newAddons = config.addons.filter(a => a.id !== addon.id);
    } else {
      let version;
      
      if (addon.type === 'community' && addon.defaultVersion) {
        // For community addons, use default version if no API version available
        version = addon.defaultVersion;
      } else {
        const versions = getAvailableVersions(addon);
        console.log(`Available versions for ${addon.id}:`, versions); // Debug log
        version = getAppropriateVersion(versions);
      }
      
      if (!version) {
        console.warn(`No version available for addon ${addon.id}`);
        return;
      }

      newAddons = [...config.addons, {
        id: addon.id,
        name: addon.name,
        type: addon.type,
        version
      }];
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
      <Stack spacing={2} sx={{ mb: 4 }}>
        {AWS_ADDONS.map((addon) => (
          <Card key={addon.id} variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={selectedIds.includes(addon.id)}
                      onChange={() => handleAddonToggle(addon)}
                    />
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography>{addon.name}</Typography>
                      {addon.recommended && (
                        <Typography
                          variant="caption"
                          sx={{ ml: 1, bgcolor: 'primary.main', color: 'white', px: 1, py: 0.5, borderRadius: 1 }}
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
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {addon.description}
                </Typography>
                {selectedIds.includes(addon.id) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                      Version:
                    </Typography>
                    <FormControl size="small" sx={{ minWidth: 200 }}>
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
              </Box>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Typography variant="h6" sx={{ mb: 2 }}>
        Community Add-ons
      </Typography>
      <Stack spacing={2}>
        {COMMUNITY_ADDONS.map((addon) => (
          <Card key={addon.id} variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={selectedIds.includes(addon.id)}
                      onChange={() => handleAddonToggle(addon)}
                    />
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography>{addon.name}</Typography>
                    </Box>
                  }
                />
                <Tooltip title={addon.description}>
                  <IconButton size="small">
                    <InfoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {addon.description}
                </Typography>
                {selectedIds.includes(addon.id) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                      Version:
                    </Typography>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
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
              </Box>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
};

export default ClusterAddons;
