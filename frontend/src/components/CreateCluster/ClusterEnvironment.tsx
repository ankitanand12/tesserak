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
import { ClusterConfig } from '../../pages/CreateCluster';

interface Props {
  config: ClusterConfig;
  onChange: (config: ClusterConfig) => void;
}

const K8S_VERSIONS = ['1.31', '1.32', '1.33'];

const ClusterEnvironment: React.FC<Props> = ({ config, onChange }) => {
  const [open, setOpen] = useState(false);
  const [availableZones, setAvailableZones] = useState<string[]>([]);
  const [loading] = useState(false);
  const [error] = useState<string | null>(null);
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

  useEffect(() => {
    if (!config.accountId || !config.region) return;

    // For testing, create mock availability zones based on the selected region
    // Later this will be replaced with actual API call
    const mockZones = [];
    if (config.region) {
      // Create 3 availability zones for the region (a, b, c)
      for (let letter of ['a', 'b', 'c']) {
        mockZones.push(`${config.region}${letter}`);
      }
    }
    setAvailableZones(mockZones);
  }, [config.accountId, config.region]);

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
              >
                {K8S_VERSIONS.map((version) => (
                  <MenuItem key={version} value={version}>
                    {version}
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
                    helperText={config.environment.availabilityZones.length === 0 ? "Select at least one availability zone" : ""}
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
                loading={loading}
                disabled={loading || !config.region}
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
