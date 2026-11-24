import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  CircularProgress,
  Typography,
  Alert,
  Autocomplete,
  InputAdornment
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { ClusterConfig } from '../../pages/CreateCluster';
import { getRegionFullName } from '../../utils/regionMapping';

interface Props {
  config: ClusterConfig;
  onChange: (config: ClusterConfig) => void;
}

interface Account {
  id: string;
  name: string;
  status: string;
}

interface VPC {
  id: string;
  name: string;
  cidr: string;
}

const ClusterBasicDetails: React.FC<Props> = ({ config, onChange }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [vpcs, setVpcs] = useState<VPC[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch connected accounts
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/connections/status', {
          headers: {
            'x-user-email': localStorage.getItem('currentUser') || '',
            'Accept': 'application/json'
          }
        });
        
        if (!response.ok) throw new Error('Failed to fetch accounts');
        
        const data = await response.json();
        const connectedAccounts = data
          .filter((conn: any) => conn.status === 'connected')
          .map((conn: any) => ({
            id: conn.accountId,
            name: conn.name,
            status: conn.status
          }));
        
        setAccounts(connectedAccounts);
      } catch (error) {
        setError('Failed to fetch connected accounts');
        console.error('Error fetching accounts:', error);
      }
    };

    fetchAccounts();
  }, []);

  // Fetch regions when account is selected
  useEffect(() => {
    if (!config.accountId) return;

    const fetchRegions = async () => {
      setLoading(true);
      try {
        const response = await fetch(`http://localhost:8000/api/aws/regions/${config.accountId}`, {
          headers: {
            'x-user-email': localStorage.getItem('currentUser') || '',
            'Accept': 'application/json'
          }
        });
        
        if (!response.ok) throw new Error('Failed to fetch regions');
        
        const data = await response.json();
        setRegions(data);
      } catch (error) {
        setError('Failed to fetch AWS regions');
        console.error('Error fetching regions:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRegions();
  }, [config.accountId]);

  // Fetch VPCs when region is selected
  useEffect(() => {
    if (!config.accountId || !config.region) return;

    const fetchVPCs = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `http://localhost:8000/api/aws/vpcs/${config.accountId}/${config.region}`,
          {
            headers: {
              'x-user-email': localStorage.getItem('currentUser') || '',
              'Accept': 'application/json'
            }
          }
        );
        
        if (!response.ok) throw new Error('Failed to fetch VPCs');
        
        const data = await response.json();
        setVpcs(data);
      } catch (error) {
        setError('Failed to fetch VPCs');
        console.error('Error fetching VPCs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchVPCs();
  }, [config.accountId, config.region]);

  const handleChange = (field: keyof ClusterConfig, value: any) => {
    onChange({
      ...config,
      [field]: value
    });
  };

  const handleVPCChange = (value: string) => {
    if (value === 'create-new') {
      onChange({
        ...config,
        vpc: {
          id: '',
          isNew: true,
          cidr: ''
        }
      });
    } else {
      onChange({
        ...config,
        vpc: {
          id: value,
          isNew: false
        }
      });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TextField
        label="Cluster Name"
        value={config.name}
        onChange={(e) => handleChange('name', e.target.value)}
        fullWidth
        required
      />

      <FormControl fullWidth required>
        <InputLabel>AWS Account</InputLabel>
        <Select
          value={config.accountId}
          onChange={(e) => handleChange('accountId', e.target.value)}
          label="AWS Account"
        >
          {accounts.map((account) => (
            <MenuItem key={account.id} value={account.id}>
              {account.name} ({account.id})
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth required disabled={!config.accountId || loading}>
        <Autocomplete
          disabled={!config.accountId || loading}
          value={config.region ? `${getRegionFullName(config.region)} / ${config.region}` : null}
          onChange={(_, newValue) => {
            if (newValue) {
              const regionCode = newValue.split(' / ')[1];
              handleChange('region', regionCode);
            }
          }}
          options={regions.map(code => `${getRegionFullName(code)} / ${code}`)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Region"
              required
              placeholder="Search regions..."
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <>
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                    {params.InputProps.startAdornment}
                  </>
                )
              }}
            />
          )}
          filterOptions={(options, { inputValue }) => {
            const searchTerm = inputValue.toLowerCase();
            return options.filter(option =>
              option.toLowerCase().includes(searchTerm)
            );
          }}
          renderOption={(props, option) => (
            <li {...props}>
              <Typography>
                {option}
              </Typography>
            </li>
          )}
        />
      </FormControl>

      <FormControl fullWidth required disabled={!config.region || loading}>
        <InputLabel>VPC</InputLabel>
        <Select
          value={config.vpc.isNew ? 'create-new' : config.vpc.id}
          onChange={(e) => handleVPCChange(e.target.value)}
          label="VPC"
        >
          <MenuItem value="create-new">Create New VPC</MenuItem>
          {vpcs.map((vpc) => (
            <MenuItem key={vpc.id} value={vpc.id}>
              {vpc.name} ({vpc.cidr})
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {config.vpc.isNew && (
        <TextField
          label="VPC CIDR"
          value={config.vpc.cidr}
          onChange={(e) => onChange({
            ...config,
            vpc: {
              ...config.vpc,
              cidr: e.target.value
            }
          })}
          placeholder="e.g., 10.0.0.0/16"
          fullWidth
          required
        />
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
};

export default ClusterBasicDetails;
