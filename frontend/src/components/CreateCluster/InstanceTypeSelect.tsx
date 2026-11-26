import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

export interface Ec2InstanceTypeOption {
  instanceType: string;
  family: string;
  size?: string;
  vcpus: number;
  memoryGiB: number;
  architectures?: string[];
  category?: string;
  accelerator?: string | null;
  currentGeneration?: boolean;
  freeTierEligible?: boolean;
}

const INSTANCE_TYPE_CLIENT_CACHE = new Map<string, Ec2InstanceTypeOption[]>();

const FALLBACK_BY_AMI: Record<string, Ec2InstanceTypeOption[]> = {
  'amazon-linux-2023/x86_64/standard': [
    { instanceType: 't3.small', family: 't3', vcpus: 2, memoryGiB: 2, architectures: ['x86_64'], currentGeneration: true },
    { instanceType: 't3.medium', family: 't3', vcpus: 2, memoryGiB: 4, architectures: ['x86_64'], currentGeneration: true },
    { instanceType: 't3.large', family: 't3', vcpus: 2, memoryGiB: 8, architectures: ['x86_64'], currentGeneration: true },
    { instanceType: 'm6i.large', family: 'm6i', vcpus: 2, memoryGiB: 8, architectures: ['x86_64'], currentGeneration: true },
    { instanceType: 'c6i.large', family: 'c6i', vcpus: 2, memoryGiB: 4, architectures: ['x86_64'], currentGeneration: true },
  ],
  'amazon-linux-2023/arm64/standard': [
    { instanceType: 't4g.small', family: 't4g', vcpus: 2, memoryGiB: 2, architectures: ['arm64'], currentGeneration: true },
    { instanceType: 't4g.medium', family: 't4g', vcpus: 2, memoryGiB: 4, architectures: ['arm64'], currentGeneration: true },
    { instanceType: 't4g.large', family: 't4g', vcpus: 2, memoryGiB: 8, architectures: ['arm64'], currentGeneration: true },
    { instanceType: 'm7g.large', family: 'm7g', vcpus: 2, memoryGiB: 8, architectures: ['arm64'], currentGeneration: true },
    { instanceType: 'c7g.large', family: 'c7g', vcpus: 2, memoryGiB: 4, architectures: ['arm64'], currentGeneration: true },
  ],
  'amazon-linux-2023/x86_64/nvidia': [
    { instanceType: 'g4dn.xlarge', family: 'g4dn', vcpus: 4, memoryGiB: 16, architectures: ['x86_64'], accelerator: '1x NVIDIA T4', currentGeneration: true },
    { instanceType: 'g5.xlarge', family: 'g5', vcpus: 4, memoryGiB: 16, architectures: ['x86_64'], accelerator: '1x NVIDIA A10G', currentGeneration: true },
    { instanceType: 'p4d.24xlarge', family: 'p4d', vcpus: 96, memoryGiB: 1152, architectures: ['x86_64'], accelerator: '8x NVIDIA A100', currentGeneration: true },
  ],
  'amazon-linux-2023/arm64/nvidia': [
    { instanceType: 'g5g.xlarge', family: 'g5g', vcpus: 4, memoryGiB: 8, architectures: ['arm64'], accelerator: '1x NVIDIA T4G', currentGeneration: true },
    { instanceType: 'g5g.2xlarge', family: 'g5g', vcpus: 8, memoryGiB: 16, architectures: ['arm64'], accelerator: '1x NVIDIA T4G', currentGeneration: true },
  ],
  'amazon-linux-2023/x86_64/neuron': [
    { instanceType: 'inf2.xlarge', family: 'inf2', vcpus: 4, memoryGiB: 16, architectures: ['x86_64'], accelerator: '1x AWS Inferentia2', currentGeneration: true },
    { instanceType: 'inf1.xlarge', family: 'inf1', vcpus: 4, memoryGiB: 8, architectures: ['x86_64'], accelerator: '1x AWS Inferentia', currentGeneration: true },
    { instanceType: 'trn1.2xlarge', family: 'trn1', vcpus: 8, memoryGiB: 32, architectures: ['x86_64'], accelerator: '1x AWS Trainium', currentGeneration: true },
  ],
};

export const getDefaultInstanceForAmi = (amiType: string): string => {
  const clean = (amiType || '').toLowerCase();
  if (clean.includes('/arm64/nvidia')) return 'g5g.xlarge';
  if (clean.includes('/arm64/')) return 't4g.medium';
  if (clean.includes('/nvidia')) return 'g5.xlarge';
  if (clean.includes('/neuron')) return 'inf2.xlarge';
  return 't3.medium';
};

interface InstanceTypeSelectProps {
  accountId?: string;
  region?: string;
  userEmail: string;
  amiType: string;
  value: string;
  onChange: (nextType: string) => void;
  size?: 'small' | 'medium';
  required?: boolean;
}

export const InstanceTypeSelect: React.FC<InstanceTypeSelectProps> = ({
  accountId,
  region,
  userEmail,
  amiType,
  value,
  onChange,
  size = 'small',
  required = false,
}) => {
  const activeAmi = amiType || 'amazon-linux-2023/x86_64/standard';
  const fallbackOptions = useMemo(
    () => FALLBACK_BY_AMI[activeAmi] || FALLBACK_BY_AMI['amazon-linux-2023/x86_64/standard'],
    [activeAmi]
  );

  const [options, setOptions] = useState<Ec2InstanceTypeOption[]>(fallbackOptions);
  const [loading, setLoading] = useState(false);
  const [catalogSource, setCatalogSource] = useState<string>('');
  const latestAmiRef = useRef(activeAmi);
  latestAmiRef.current = activeAmi;
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  const loadInstanceTypes = useCallback(
    async (forceRefresh: boolean = false) => {
      if (!accountId || !region || !userEmail) {
        setOptions(fallbackOptions);
        return;
      }
      const cacheKey = `${region}::${activeAmi}`;
      if (!forceRefresh) {
        const cached = INSTANCE_TYPE_CLIENT_CACHE.get(cacheKey);
        if (cached && cached.length > 0) {
          setOptions(cached);
          setCatalogSource('cached');
          return;
        }
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({ ami_type: activeAmi });
        if (forceRefresh) params.set('refresh', 'true');
        const res = await fetch(
          `http://localhost:8000/api/aws/eks-instance-types/${encodeURIComponent(accountId)}/${encodeURIComponent(region)}?${params.toString()}`,
          { headers: { 'x-user-email': userEmail } }
        );
        if (!res.ok) {
          setOptions(fallbackOptions);
          return;
        }
        const data = await res.json().catch(() => null);
        if (latestAmiRef.current !== activeAmi) return;
        const list: Ec2InstanceTypeOption[] = Array.isArray(data?.instanceTypes)
          ? data.instanceTypes
          : [];
        if (list.length > 0) {
          INSTANCE_TYPE_CLIENT_CACHE.set(cacheKey, list);
          setOptions(list);
          setCatalogSource(data?.source || 'aws');

          // Auto-align selected value if incompatible with newly chosen AMI architecture/hardware
          const currentVal = latestValueRef.current;
          if (currentVal && !list.some((opt) => opt.instanceType === currentVal)) {
            const preferred = getDefaultInstanceForAmi(activeAmi);
            const fallbackMatch = list.some((opt) => opt.instanceType === preferred)
              ? preferred
              : list[0].instanceType;
            onChange(fallbackMatch);
          }
        } else {
          setOptions(fallbackOptions);
        }
      } catch {
        setOptions(fallbackOptions);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId, region, userEmail, activeAmi, fallbackOptions]
  );

  useEffect(() => {
    loadInstanceTypes(false);
  }, [loadInstanceTypes]);

  const selectedOption = useMemo(() => {
    return (
      options.find((opt) => opt.instanceType === value) ||
      (value ? { instanceType: value, family: value.split('.')[0] || '', vcpus: 0, memoryGiB: 0 } : null)
    );
  }, [options, value]);

  return (
    <Autocomplete<Ec2InstanceTypeOption, false, false, true>
      freeSolo
      size={size}
      loading={loading}
      options={options}
      value={selectedOption}
      filterOptions={(opts, state) => {
        const q = state.inputValue.trim().toLowerCase();
        const filtered = q
          ? opts.filter(
              (o) =>
                o.instanceType.toLowerCase().includes(q) ||
                o.family.toLowerCase().includes(q) ||
                `${o.vcpus} vcpu`.includes(q) ||
                `${o.memoryGiB} gib`.includes(q) ||
                (o.accelerator || '').toLowerCase().includes(q)
            )
          : opts;
        return filtered.slice(0, 120);
      }}
      getOptionLabel={(opt) => (typeof opt === 'string' ? opt : opt.instanceType)}
      isOptionEqualToValue={(opt, val) =>
        opt.instanceType === (typeof val === 'string' ? val : val.instanceType)
      }
      onChange={(_, newVal) => {
        if (!newVal) {
          onChange('');
        } else if (typeof newVal === 'string') {
          onChange(newVal.trim());
        } else {
          onChange(newVal.instanceType);
        }
      }}
      onInputChange={(_, newInput, reason) => {
        if (reason === 'input') {
          onChange(newInput.trim());
        }
      }}
      renderOption={(props, opt) => (
        <Box
          component="li"
          {...props}
          key={opt.instanceType}
          sx={{
            display: 'flex !important',
            flexDirection: 'column',
            alignItems: 'flex-start !important',
            py: 0.9,
            borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace', color: '#09090b' }}>
              {opt.instanceType}
            </Typography>
            {opt.freeTierEligible && (
              <Chip size="small" label="Free tier eligible" color="success" sx={{ height: 18, fontSize: '0.68rem' }} />
            )}
            {opt.accelerator && (
              <Chip size="small" label={opt.accelerator} color="primary" variant="outlined" sx={{ height: 18, fontSize: '0.68rem' }} />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: '#475569' }}>
            Family: {opt.family} · {opt.vcpus} vCPU · {opt.memoryGiB} GiB Memory ·{' '}
            {opt.currentGeneration === false ? 'Previous gen' : 'Current generation'}
          </Typography>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Instance Type"
          required={required}
          placeholder="Search type, vCPU, or GiB..."
          helperText={
            selectedOption && selectedOption.vcpus > 0
              ? `${selectedOption.vcpus} vCPU · ${selectedOption.memoryGiB} GiB Memory (${options.length} compatible)`
              : `${options.length} AWS types for AMI`
          }
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? (
                  <CircularProgress size={16} sx={{ mr: 0.5 }} />
                ) : (
                  accountId &&
                  region && (
                    <Tooltip title={`Refresh EC2 instance types from AWS (${catalogSource || 'live'})`}>
                      <IconButton
                        size="small"
                        aria-label="Refresh instance types"
                        onClick={(e) => {
                          e.stopPropagation();
                          loadInstanceTypes(true);
                        }}
                        sx={{ p: 0.4 }}
                      >
                        <RefreshIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )
                )}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
};
