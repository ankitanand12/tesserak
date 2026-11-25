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
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTesserakAuth } from '../../auth/AuthContext';
import { ClusterConfig } from '../../pages/CreateCluster';

interface Props {
  config: ClusterConfig;
  onChange: (config: ClusterConfig) => void;
}

interface EksVersionItem {
  version: string;
  status: string;
  isLatest?: boolean;
  awsDefault?: boolean;
}

const ClusterEnvironment: React.FC<Props> = ({ config, onChange }) => {
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || '';
  const [open, setOpen] = useState(false);
  const [availableZones, setAvailableZones] = useState<string[]>([]);
  const [k8sVersions, setK8sVersions] = useState<EksVersionItem[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [newTag, setNewTag] = useState({ key: '', value: '' });

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
                onChange={(e: SelectChangeEvent<string>) => onChange({
                  ...config,
                  environment: {
                    ...config.environment,
                    kubernetesVersion: e.target.value
                  }
                })}
                label="Kubernetes Version"
                disabled={loadingVersions}
              >
                {k8sVersions.map((item) => (
                  <MenuItem key={item.version} value={item.version}>
                    {item.version}
                    {item.isLatest ? ' (Latest)' : item.status === 'EXTENDED_SUPPORT' ? ' (Extended Support)' : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

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
