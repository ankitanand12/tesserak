import React, { useState, useEffect, ChangeEvent } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Autocomplete,
  Chip,
  Typography,
  Alert,
  IconButton,
  SelectChangeEvent,
  AutocompleteRenderInputParams,
  FormControlLabel,
  Switch,
  CircularProgress,
  Grid,
  InputAdornment,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTesserakAuth } from '../../auth/AuthContext';
import { ClusterConfig } from '../../pages/CreateCluster';

export const EKS_AMI_TYPES = [
  {
    value: 'amazon-linux-2023/x86_64/standard',
    label: 'Standard x86_64 (amazon-linux-2023/x86_64/standard)',
  },
  {
    value: 'amazon-linux-2023/arm64/standard',
    label: 'Standard ARM64 (Graviton) (amazon-linux-2023/arm64/standard)',
  },
  {
    value: 'amazon-linux-2023/x86_64/nvidia',
    label: 'NVIDIA GPU (x86_64) (amazon-linux-2023/x86_64/nvidia)',
  },
  {
    value: 'amazon-linux-2023/arm64/nvidia',
    label: 'NVIDIA GPU (ARM64) (amazon-linux-2023/arm64/nvidia)',
  },
  {
    value: 'amazon-linux-2023/x86_64/neuron',
    label: 'AWS Neuron / Inferentia / Trainium (x86_64) (amazon-linux-2023/x86_64/neuron)',
  },
];

interface Props {
  config: ClusterConfig;
  onChange: (config: ClusterConfig) => void;
}

interface EksVersionItem {
  version: string;
  status: string;
  isLatest?: boolean;
  awsDefault?: boolean;
  endOfStandardSupport?: string | null;
  endOfExtendedSupport?: string | null;
}

interface VpcSubnetItem {
  id: string;
  name: string;
  cidr: string;
  availabilityZone: string;
  isPublic: boolean;
}

const ClusterEnvironment: React.FC<Props> = ({ config, onChange }) => {
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || '';
  const [open, setOpen] = useState(false);
  const [availableZones, setAvailableZones] = useState<string[]>([]);
  const [vpcSubnets, setVpcSubnets] = useState<VpcSubnetItem[]>([]);
  const [k8sVersions, setK8sVersions] = useState<EksVersionItem[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingSubnets, setLoadingSubnets] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingAmi, setLoadingAmi] = useState(false);
  const [amiMeta, setAmiMeta] = useState<{ k8sVersion?: string; parameterName?: string } | null>(null);
  const [amiError, setAmiError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [newTag, setNewTag] = useState({ key: '', value: '' });
  const configRef = React.useRef(config);
  configRef.current = config;

  const validateEnvironmentConfig = () => {
    const isValidConfig = Boolean(
      config.environment.endpoint &&
      config.environment.kubernetesVersion &&
      config.environment.availabilityZones.length > 0
    );
    setIsValid(isValidConfig);
    return isValidConfig;
  };

  // Update validation whenever config changes
  useEffect(() => {
    const isValidConfig = Boolean(
      config.environment.endpoint &&
      config.environment.kubernetesVersion &&
      config.environment.availabilityZones.length > 0
    );
    setIsValid(isValidConfig);
  }, [config.environment.endpoint, config.environment.kubernetesVersion, config.environment.availabilityZones]);

  // Fetch live AWS EKS Kubernetes versions (latest first) and auto-default to latest
  useEffect(() => {
    if (!config.accountId || !userEmail) return;
    let active = true;

    const fetchEksVersions = async () => {
      setLoadingVersions(true);
      try {
        const regionQuery = config.region ? `?region=${encodeURIComponent(config.region)}` : '';
        const res = await fetch(`http://localhost:8000/api/aws/eks-versions${regionQuery}`, {
          headers: { 'x-user-email': userEmail },
        });
        if (!res.ok) throw new Error('Failed to fetch AWS EKS Kubernetes versions');
        const data = await res.json();
        if (!active) return;
        const versions: EksVersionItem[] = Array.isArray(data.versions) ? data.versions : [];
        setK8sVersions(versions);
        setError(null);

        const latest = data.latest || versions[0]?.version;
        if (latest && (!config.environment.kubernetesVersion || !versions.some((v) => v.version === config.environment.kubernetesVersion))) {
          onChange({
            ...config,
            environment: {
              ...config.environment,
              kubernetesVersion: latest,
            },
          });
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Unable to fetch supported AWS Kubernetes versions');
      } finally {
        if (active) setLoadingVersions(false);
      }
    };

    fetchEksVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.accountId, config.region, userEmail]);

  // Fetch real Availability Zones for selected account & region
  useEffect(() => {
    if (!config.accountId || !config.region || !userEmail) return;
    let active = true;

    const fetchZones = async () => {
      setLoadingZones(true);
      try {
        const res = await fetch(
          `http://localhost:8000/api/aws/zones/${config.accountId}/${config.region}`,
          { headers: { 'x-user-email': userEmail } }
        );
        if (!res.ok) throw new Error('Failed to fetch availability zones');
        const data = await res.json();
        if (!active) return;
        const zoneNames = Array.isArray(data) ? data.map((z: any) => z.name).filter(Boolean) : [];
        setAvailableZones(zoneNames);
      } catch {
        if (active) {
          setAvailableZones(['a', 'b', 'c'].map((l) => `${config.region}${l}`));
        }
      } finally {
        if (active) setLoadingZones(false);
      }
    };

    fetchZones();
    return () => {
      active = false;
    };
  }, [config.accountId, config.region, userEmail]);

  // Fetch subnets when an existing VPC is selected
  useEffect(() => {
    if (!config.accountId || !config.region || !config.vpc.id || config.vpc.isNew || !userEmail) {
      setVpcSubnets([]);
      return;
    }
    let active = true;

    const fetchSubnets = async () => {
      setLoadingSubnets(true);
      try {
        const res = await fetch(
          `http://localhost:8000/api/aws/subnets/${config.accountId}/${config.region}/${config.vpc.id}`,
          { headers: { 'x-user-email': userEmail } }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data)) {
          setVpcSubnets(data);
        }
      } catch {
        // Optional helper; fallback to AZ selection directly
      } finally {
        if (active) setLoadingSubnets(false);
      }
    };

    fetchSubnets();
    return () => {
      active = false;
    };
  }, [config.accountId, config.region, config.vpc.id, config.vpc.isNew, userEmail]);

  const activeAmiType = config.amiType || 'amazon-linux-2023/x86_64/standard';
  const fetchRecommendedAmi = React.useCallback(
    async (amiTypeVal: string, k8sVerVal: string, forceOverwrite: boolean = false) => {
      if (!config.accountId || !config.region || !k8sVerVal || !userEmail) return;
      setLoadingAmi(true);
      setAmiError(null);
      try {
        const params = new URLSearchParams({
          ami_type: amiTypeVal,
          kubernetes_version: k8sVerVal,
        });
        const response = await fetch(
          `http://localhost:8000/api/aws/eks-ami/${config.accountId}/${config.region}?${params.toString()}`,
          {
            headers: {
              'x-user-email': userEmail,
              Accept: 'application/json',
            },
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.detail || 'Unable to fetch recommended EKS AMI');
        }
        setAmiMeta({
          k8sVersion: data.kubernetesVersion,
          parameterName: data.parameterName,
        });
        const latestConfig = configRef.current;
        if (forceOverwrite || !latestConfig.amiManual) {
          onChange({
            ...latestConfig,
            amiType: amiTypeVal,
            amiId: data.amiId || '',
            amiManual: false,
            environment: {
              ...latestConfig.environment,
              kubernetesVersion: latestConfig.environment.kubernetesVersion || k8sVerVal,
            },
          });
        }
      } catch (err: any) {
        setAmiError(err?.message || 'Unable to resolve AWS SSM AMI ID');
      } finally {
        setLoadingAmi(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.accountId, config.region, userEmail]
  );

  // Auto-fetch recommended AMI ID whenever region, K8s version, or AMI type changes (unless manually customized)
  useEffect(() => {
    if (!config.accountId || !config.region || !config.environment.kubernetesVersion || !userEmail) return;
    if (config.amiManual) return;
    fetchRecommendedAmi(activeAmiType, config.environment.kubernetesVersion, false);
  }, [config.accountId, config.region, activeAmiType, config.environment.kubernetesVersion, config.amiManual, userEmail, fetchRecommendedAmi]);

  const updateSubnetsAndZones = (nextPublic: string[], nextPrivate: string[]) => {
    const selectedSet = new Set([...nextPublic, ...nextPrivate]);
    const derivedZones = Array.from(
      new Set(
        vpcSubnets
          .filter((s) => selectedSet.has(s.id) && s.availabilityZone)
          .map((s) => s.availabilityZone)
      )
    );
    const mergedZones =
      derivedZones.length > 0
        ? Array.from(new Set([...config.environment.availabilityZones, ...derivedZones]))
        : config.environment.availabilityZones;

    onChange({
      ...config,
      publicSubnets: nextPublic,
      privateSubnets: nextPrivate,
      environment: {
        ...config.environment,
        availabilityZones: mergedZones,
      },
    });
  };

  const handleEnvironmentTypeChange = (value: 'Non-Prod' | 'Prod') => {
    onChange({
      ...config,
      environment: {
        ...config.environment,
        type: value
      }
    });
    setOpen(true);
  };

  const handleEndpointTypeChange = (value: 'public' | 'public-private' | 'private') => {
    onChange({
      ...config,
      environment: {
        ...config.environment,
        endpoint: value
      }
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <FormControl fullWidth required>
        <InputLabel>Environment Type</InputLabel>
        <Select<'Non-Prod' | 'Prod'>
          value={config.environment.type}
          onChange={(e: SelectChangeEvent<'Non-Prod' | 'Prod'>) => 
            handleEnvironmentTypeChange(e.target.value as 'Non-Prod' | 'Prod')}
          label="Environment Type"
          error={!config.environment.type}
        >
          <MenuItem value="Non-Prod">Non-Production</MenuItem>
          <MenuItem value="Prod">Production</MenuItem>
        </Select>
      </FormControl>

      <Dialog 
        open={open} 
        onClose={() => {
          setOpen(false);
        }}
        maxWidth="sm" 
        fullWidth
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center' 
        }}>
          <span>Configure {config.environment.type} Environment</span>
          <IconButton
            aria-label="close"
            onClick={() => {
              onChange({
                ...config,
                environment: {
                  ...config.environment,
                  type: 'Non-Prod'
                }
              });
              setOpen(false);
            }}
            sx={{ ml: 2 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
            <FormControl fullWidth required error={!config.environment.endpoint}>
              <InputLabel>Cluster Endpoint</InputLabel>
              <Select<'public' | 'public-private' | 'private'>
                value={config.environment.endpoint}
                onChange={(e) => 
                  handleEndpointTypeChange(e.target.value as 'public' | 'public-private' | 'private')}
                label="Cluster Endpoint"
              >
                <MenuItem value="public">Public</MenuItem>
                <MenuItem value="public-private">Public + Private</MenuItem>
                <MenuItem value="private">Private</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth required error={!config.environment.kubernetesVersion}>
              <InputLabel>Kubernetes Version</InputLabel>
              <Select
                value={config.environment.kubernetesVersion}
                onChange={(e: SelectChangeEvent<string>) => {
                  const nextVer = e.target.value;
                  onChange({
                    ...config,
                    amiManual: false,
                    environment: {
                      ...config.environment,
                      kubernetesVersion: nextVer
                    }
                  });
                  fetchRecommendedAmi(activeAmiType, nextVer, true);
                }}
                label="Kubernetes Version"
                disabled={loadingVersions}
              >
                {k8sVersions.map((item) => {
                  const stdDate = item.endOfStandardSupport ? item.endOfStandardSupport.slice(0, 10) : null;
                  const extDate = item.endOfExtendedSupport ? item.endOfExtendedSupport.slice(0, 10) : null;
                  return (
                    <MenuItem key={item.version} value={item.version}>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: item.isLatest ? 700 : 500 }}>
                          {item.version}
                          {item.isLatest ? ' (Latest)' : item.status === 'EXTENDED_SUPPORT' ? ' (Extended Support)' : ''}
                        </Typography>
                        {(stdDate || extDate) && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {stdDate ? `Standard until ${stdDate}` : ''}
                            {stdDate && extDate ? ' · ' : ''}
                            {extDate ? `Extended until ${extDate}` : ''}
                          </Typography>
                        )}
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth disabled={!config.region || !config.environment.kubernetesVersion}>
                  <InputLabel>AMI Type</InputLabel>
                  <Select
                    value={activeAmiType}
                    label="AMI Type"
                    onChange={(e) => {
                      const nextAmiType = e.target.value;
                      onChange({
                        ...config,
                        amiType: nextAmiType,
                        amiManual: false,
                      });
                      fetchRecommendedAmi(nextAmiType, config.environment.kubernetesVersion, true);
                    }}
                  >
                    {EKS_AMI_TYPES.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  label="AMI ID"
                  value={config.amiId || ''}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      amiId: e.target.value,
                      amiManual: true,
                    })
                  }
                  placeholder={
                    config.environment.kubernetesVersion
                      ? 'Fetching recommended AWS SSM AMI...'
                      : 'Select Kubernetes version first'
                  }
                  disabled={!config.region}
                  fullWidth
                  helperText={
                    amiError
                      ? amiError
                      : amiMeta?.k8sVersion
                      ? `AWS SSM (${amiMeta.k8sVersion}) · Editable for custom AMI`
                      : 'Pre-filled from AWS SSM /aws/service/eks/optimized-ami; editable anytime'
                  }
                  error={Boolean(amiError)}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        {loadingAmi ? (
                          <CircularProgress size={18} />
                        ) : config.amiManual ? (
                          <Button
                            size="small"
                            onClick={() =>
                              fetchRecommendedAmi(activeAmiType, config.environment.kubernetesVersion, true)
                            }
                            sx={{ textTransform: 'none', minWidth: 0, fontWeight: 600 }}
                          >
                            Use Recommended
                          </Button>
                        ) : null}
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>
            </Grid>

            <Box sx={{ p: 2, borderRadius: 2, border: '1px solid rgba(15, 23, 42, 0.12)', bgcolor: '#f8fafc' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.createNodeGroup !== false}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        createNodeGroup: e.target.checked,
                      })
                    }
                  />
                }
                label="Provision Initial Managed Node Group (Recommended for add-ons & workloads)"
              />
              {config.createNodeGroup !== false && (
                <Grid container spacing={1.75} sx={{ mt: 0.5 }}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Node Group Name"
                      size="small"
                      value={config.nodeGroupName ?? ''}
                      placeholder={`${config.name || 'eks'}-ng`}
                      onChange={(e) => onChange({ ...config, nodeGroupName: e.target.value })}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <TextField
                      label="Instance Type"
                      size="small"
                      value={config.instanceType || 't3.medium'}
                      onChange={(e) => onChange({ ...config, instanceType: e.target.value })}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Capacity</InputLabel>
                      <Select
                        value={config.capacityType || 'ON_DEMAND'}
                        label="Capacity"
                        onChange={(e) =>
                          onChange({ ...config, capacityType: e.target.value as 'ON_DEMAND' | 'SPOT' })
                        }
                      >
                        <MenuItem value="ON_DEMAND">On-Demand</MenuItem>
                        <MenuItem value="SPOT">Spot</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={4} sm={4}>
                    <TextField
                      label="Min Nodes"
                      type="number"
                      size="small"
                      value={config.minNodes ?? 1}
                      onChange={(e) => onChange({ ...config, minNodes: Math.max(0, Number(e.target.value)) })}
                      inputProps={{ min: 0 }}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={4} sm={4}>
                    <TextField
                      label="Desired Nodes"
                      type="number"
                      size="small"
                      value={config.desiredNodes ?? 2}
                      onChange={(e) => onChange({ ...config, desiredNodes: Math.max(1, Number(e.target.value)) })}
                      inputProps={{ min: 1 }}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={4} sm={4}>
                    <TextField
                      label="Max Nodes"
                      type="number"
                      size="small"
                      value={config.maxNodes ?? 4}
                      onChange={(e) => onChange({ ...config, maxNodes: Math.max(1, Number(e.target.value)) })}
                      inputProps={{ min: 1 }}
                      fullWidth
                    />
                  </Grid>
                </Grid>
              )}
            </Box>

            {!config.vpc.isNew && vpcSubnets.length > 0 && (
              <>
                <Autocomplete
                  multiple
                  loading={loadingSubnets}
                  options={vpcSubnets}
                  getOptionLabel={(s) => `${s.name} (${s.id}) · ${s.cidr} · ${s.availabilityZone}`}
                  value={vpcSubnets.filter((s) => (config.publicSubnets || []).includes(s.id))}
                  onChange={(_, selected) =>
                    updateSubnetsAndZones(
                      selected.map((s) => s.id),
                      config.privateSubnets || []
                    )
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Public Subnets (Optional)"
                      placeholder="Select public subnets..."
                    />
                  )}
                />
                <Autocomplete
                  multiple
                  loading={loadingSubnets}
                  options={vpcSubnets}
                  getOptionLabel={(s) => `${s.name} (${s.id}) · ${s.cidr} · ${s.availabilityZone}`}
                  value={vpcSubnets.filter((s) => (config.privateSubnets || []).includes(s.id))}
                  onChange={(_, selected) =>
                    updateSubnetsAndZones(
                      config.publicSubnets || [],
                      selected.map((s) => s.id)
                    )
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Private Subnets (Optional)"
                      placeholder="Select private subnets..."
                    />
                  )}
                />
              </>
            )}

            <FormControl fullWidth required>
              <Autocomplete
                multiple
                options={availableZones}
                value={config.environment.availabilityZones}
                onChange={(_: any, newValue: string[]) => {
                  onChange({
                    ...config,
                    environment: {
                      ...config.environment,
                      availabilityZones: newValue
                    }
                  });
                }}
                renderInput={(params: AutocompleteRenderInputParams) => (
                  <TextField
                    {...params}
                    label="Availability Zones"
                    required
                    error={config.environment.availabilityZones.length === 0}
                    helperText={
                      config.environment.availabilityZones.length < 2
                        ? 'Select at least 2 availability zones for AWS EKS'
                        : ''
                    }
                    placeholder={config.region ? `Select availability zones for ${config.region}` : "Select a region first"}
                  />
                )}
                renderOption={(props, option) => (
                  <li {...props}>
                    <Typography variant="body2">
                      {option}
                    </Typography>
                  </li>
                )}
                loading={loadingZones}
                disabled={loadingZones || !config.region}
                noOptionsText={config.region ? "No availability zones found" : "Select a region first"}
              />
            </FormControl>

            <Box sx={{ mt: 4 }}>
              <Typography variant="subtitle1" gutterBottom>
                Tags (Optional)
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2 }}>
                <TextField
                  label="Tag Name"
                  value={newTag.key}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => 
                    setNewTag(prev => ({ ...prev, key: e.target.value }))}
                  size="small"
                  placeholder="e.g., Environment"
                />
                <TextField
                  label="Tag Value"
                  value={newTag.value}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => 
                    setNewTag(prev => ({ ...prev, value: e.target.value }))}
                  size="small"
                  placeholder="e.g., Production"
                />
                <Button
                  variant="contained"
                  color="primary"
                  sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                  onClick={() => {
                    if (newTag.key && newTag.value) {
                      onChange({
                        ...config,
                        tags: [...(config.tags || []), newTag]
                      });
                      setNewTag({ key: '', value: '' });
                    }
                  }}
                  disabled={!newTag.key || !newTag.value}
                >
                  Add Tag
                </Button>
              </Box>
              
              {config.tags && config.tags.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {config.tags.map((tag, index) => (
                    <Chip
                      key={`${tag.key}-${index}`}
                      label={`${tag.key}: ${tag.value}`}
                      onDelete={() => {
                        onChange({
                          ...config,
                          tags: config.tags.filter((_, i) => i !== index)
                        });
                      }}
                      color="primary"
                      variant="outlined"
                    />
                  ))}
                </Box>
              )}

              <Box sx={{ mt: 2.5 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(config.enableClusterLogs)}
                      onChange={(e) =>
                        onChange({
                          ...config,
                          enableClusterLogs: e.target.checked,
                        })
                      }
                    />
                  }
                  label="Enable Control Plane & VPC Flow Logs"
                />
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setOpen(false)}
            color="inherit"
          >
            Cancel
          </Button>
          <Button 
            onClick={() => {
              if (validateEnvironmentConfig()) {
                setOpen(false);
              }
            }}
            variant="contained"
            disabled={!isValid}
            color="primary"
          >
            Save Configuration
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ClusterEnvironment;
