import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Cable as CableIcon,
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon,
  Dns as DnsIcon,
  Error as ErrorIcon,
  GitHub as GitHubIcon,
  Layers as LayersIcon,
  Lock as LockIcon,
  Refresh as RefreshIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import { useTesserakAuth } from '../auth/AuthContext';
import ConnectorForm from '../components/Connectors/ConnectorForm';
import ConnectorList, { Connector } from '../components/Connectors/ConnectorList';
import { Perspective3DCard } from '../components/Perspective3DCard';
import { IntegrationCategory, IntegrationItem, IntegrationProvider } from '../types/platform';
import { fetchWithSwr, invalidateSwrCache, readSwrCache } from '../utils/swrCache';

const extractErrorMessage = (detail: any, fallback: string): string => {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  return detail.error_description || detail.message || detail.error || fallback;
};

const CATEGORY_META: Record<IntegrationCategory, { label: string; icon: React.ReactNode }> = {
  cloud: { label: 'Cloud Providers', icon: <StorageIcon fontSize="small" /> },
  scm: { label: 'Source Control (SCM)', icon: <GitHubIcon fontSize="small" /> },
  registry: { label: 'Container Registries', icon: <LayersIcon fontSize="small" /> },
  secrets: { label: 'Secrets & KMS', icon: <LockIcon fontSize="small" /> },
  dns: { label: 'DNS & Edge', icon: <DnsIcon fontSize="small" /> },
};

const PROVIDER_CONFIGS: Array<{
  provider: Exclude<IntegrationProvider, 'aws'>;
  label: string;
  category: IntegrationCategory;
  secretLabel: string;
  scopePlaceholder: string;
  hint: string;
}> = [
  {
    provider: 'github',
    label: 'GitHub',
    category: 'scm',
    secretLabel: 'GitHub Personal Access Token (PAT)',
    scopePlaceholder: 'Optional: owner/repo (leave blank to verify user)',
    hint: 'Verified live via GET https://api.github.com/user (and /repos when specified).',
  },
  {
    provider: 'gitlab',
    label: 'GitLab',
    category: 'scm',
    secretLabel: 'GitLab Personal / Project Token',
    scopePlaceholder: 'Optional group/project scope',
    hint: 'Verified live via GET /api/v4/user on gitlab.com or self-hosted URL.',
  },
  {
    provider: 'aws-ecr',
    label: 'Amazon ECR',
    category: 'registry',
    secretLabel: '',
    scopePlaceholder: 'Region (e.g. us-east-1)',
    hint: 'Verified live via AWS STS + ECR describe_repositories.',
  },
  {
    provider: 'aws-secrets',
    label: 'AWS Secrets Manager',
    category: 'secrets',
    secretLabel: '',
    scopePlaceholder: 'Region (e.g. us-east-1)',
    hint: 'Verified live via AWS STS + SecretsManager list_secrets.',
  },
  {
    provider: 'dockerhub',
    label: 'Docker Hub',
    category: 'registry',
    secretLabel: 'Docker Hub PAT / Password',
    scopePlaceholder: 'Docker Hub username',
    hint: 'Verified live via POST https://hub.docker.com/v2/users/login.',
  },
  {
    provider: 'cloudflare',
    label: 'Cloudflare DNS',
    category: 'dns',
    secretLabel: 'Cloudflare API Token',
    scopePlaceholder: 'Optional zone domain filter',
    hint: 'Verified live via Cloudflare /user/tokens/verify & /zones.',
  },
  {
    provider: 'gcp',
    label: 'GCP Service Account',
    category: 'cloud',
    secretLabel: 'Service Account JSON',
    scopePlaceholder: '',
    hint: 'Signs an RS256 JWT with private_key and exchanges a real token at oauth2.googleapis.com.',
  },
];

export const Integrations: React.FC = () => {
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';

  const cachedBundle = readSwrCache<{ integrations: IntegrationItem[]; awsConnectors: Connector[] }>(
    userEmail,
    'integrations'
  );
  const [integrations, setIntegrations] = useState<IntegrationItem[]>(
    () => cachedBundle?.integrations ?? []
  );
  const [awsConnectors, setAwsConnectors] = useState<Connector[]>(
    () => cachedBundle?.awsConnectors ?? []
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | IntegrationCategory | 'aws-iam'>('all');

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [awsModalOpen, setAwsModalOpen] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [formProvider, setFormProvider] = useState<Exclude<IntegrationProvider, 'aws'>>('github');
  const [formName, setFormName] = useState('');
  const [formScope, setFormScope] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formEndpoint, setFormEndpoint] = useState('https://gitlab.com');
  const [formUsername, setFormUsername] = useState('');
  const [useActiveAws, setUseActiveAws] = useState(true);
  const [awsAccessKey, setAwsAccessKey] = useState('');
  const [awsSecretKey, setAwsSecretKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');

  const currentCfg = PROVIDER_CONFIGS.find((p) => p.provider === formProvider) || PROVIDER_CONFIGS[0];

  const loadAll = useCallback(
    async (force: boolean = false) => {
      try {
        const data = await fetchWithSwr(
          userEmail,
          'integrations',
          async () => {
            const [intRes, connRes] = await Promise.all([
              fetch('http://localhost:8000/api/integrations', {
                headers: { 'x-user-email': userEmail },
              }),
              fetch('http://localhost:8000/api/connections', {
                headers: { 'x-user-email': userEmail },
              }),
            ]);
            if (!intRes.ok) {
              const errData = await intRes.json().catch(() => ({}));
              throw new Error(
                extractErrorMessage(errData.detail, `Failed to load integrations (HTTP ${intRes.status})`)
              );
            }
            if (!connRes.ok) {
              const errData = await connRes.json().catch(() => ({}));
              throw new Error(
                extractErrorMessage(errData.detail, `Failed to load AWS connections (HTTP ${connRes.status})`)
              );
            }
            return {
              integrations: (await intRes.json()) as IntegrationItem[],
              awsConnectors: (await connRes.json()) as Connector[],
            };
          },
          { force, dedupeWindowMs: 4000 }
        );
        setIntegrations(data.integrations);
        setAwsConnectors(data.awsConnectors);
        setError('');
      } catch (err: any) {
        setError(err?.message || 'Unable to reach backend integrations API');
      }
    },
    [userEmail]
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openProviderModal = (provider: Exclude<IntegrationProvider, 'aws'>) => {
    const cfg = PROVIDER_CONFIGS.find((p) => p.provider === provider) || PROVIDER_CONFIGS[0];
    setFormProvider(provider);
    setFormName('');
    setFormScope('');
    setFormSecret('');
    setFormUsername('');
    setAwsAccessKey('');
    setAwsSecretKey('');
    setModalError('');
    setAddModalOpen(true);
    return cfg;
  };

  const handleCreateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('http://localhost:8000/api/integrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail,
        },
        body: JSON.stringify({
          name: formName.trim(),
          provider: formProvider,
          category: currentCfg.category,
          scope: formScope.trim(),
          secret: formSecret,
          endpoint: formProvider === 'gitlab' ? formEndpoint.trim() : undefined,
          username: formProvider === 'dockerhub' ? formUsername.trim() : undefined,
          accessKey: (formProvider === 'aws-ecr' || formProvider === 'aws-secrets') && !useActiveAws ? awsAccessKey : undefined,
          secretKey: (formProvider === 'aws-ecr' || formProvider === 'aws-secrets') && !useActiveAws ? awsSecretKey : undefined,
          region: formProvider === 'aws-ecr' || formProvider === 'aws-secrets' ? awsRegion : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError(extractErrorMessage(data.detail, 'Live credential verification failed'));
        return;
      }
      setAddModalOpen(false);
      setNotice(`Verified & connected "${data.name}" (${data.latencyMs}ms).`);
      invalidateSwrCache(userEmail, 'integrations');
      invalidateSwrCache(userEmail, 'overview');
      await loadAll(true);
    } catch (err: any) {
      setModalError(err.message || 'Network failure connecting to backend');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (item: IntegrationItem) => {
    setError('');
    setNotice('');
    if (item.managedBy === 'connector') {
      const res = await fetch('http://localhost:8000/api/connections/status', {
        headers: { 'x-user-email': userEmail },
      });
      if (res.ok) {
        setNotice(`AWS Connector "${item.name}" verified via live STS check.`);
        await loadAll(true);
      }
      return;
    }

    setTestingId(item.id);
    try {
      const res = await fetch(`http://localhost:8000/api/integrations/${item.id}/test`, {
        method: 'POST',
        headers: { 'x-user-email': userEmail },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(extractErrorMessage(data.detail, `Verification failed for "${item.name}"`));
        await loadAll(true);
        return;
      }
      setNotice(`Live ping succeeded for "${data.name}" (${data.latencyMs}ms).`);
      await loadAll(true);
    } catch {
      setError('Health check request failed');
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (item: IntegrationItem) => {
    setError('');
    if (item.managedBy === 'connector') {
      await handleDeleteAwsConnector(item.id);
      return;
    }
    try {
      const res = await fetch(`http://localhost:8000/api/integrations/${item.id}`, {
        method: 'DELETE',
        headers: { 'x-user-email': userEmail },
      });
      if (res.ok) {
        setNotice(`Disconnected "${item.name}".`);
        invalidateSwrCache(userEmail, 'integrations');
        invalidateSwrCache(userEmail, 'overview');
        await loadAll(true);
      }
    } catch {
      setError('Failed to disconnect integration');
    }
  };

  const handleAwsSubmit = async (credentials: {
    accessKey: string;
    secretKey: string;
    region: string;
    accountName: string;
  }) => {
    setError('');
    const response = await fetch('http://localhost:8000/api/connections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': userEmail,
      },
      body: JSON.stringify({ ...credentials, type: 'aws' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = extractErrorMessage(data.detail, 'AWS credential validation failed');
      setError(msg);
      throw new Error(msg);
    }
    setAwsModalOpen(false);
    setNotice(`AWS IAM account "${credentials.accountName}" verified via STS and connected.`);
    invalidateSwrCache(userEmail);
    await loadAll(true);
  };

  const handleDeleteAwsConnector = async (id: string) => {
    const res = await fetch(`http://localhost:8000/api/connections/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-email': userEmail },
    });
    if (res.ok) {
      setNotice('AWS IAM connection removed.');
      invalidateSwrCache(userEmail);
      await loadAll(true);
    }
  };

  const filtered =
    categoryFilter === 'all'
      ? integrations
      : categoryFilter === 'aws-iam'
      ? []
      : integrations.filter((i) => i.category === categoryFilter);

  const isAwsSubtype = formProvider === 'aws-ecr' || formProvider === 'aws-secrets';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 2,
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', letterSpacing: '-0.02em' }}>
              Integrations
            </Typography>
            <Chip
              icon={<CableIcon sx={{ color: '#60a5fa !important', fontSize: 16 }} />}
              label={`${integrations.length} Verified`}
              size="small"
              sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 600 }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#475569' }}>
            Every provider validates real API tokens, AWS IAM STS credentials, or GCP Service Accounts directly in FastAPI before saving.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            onClick={() => setAwsModalOpen(true)}
            sx={{ borderColor: '#09090b', color: '#09090b', fontWeight: 700 }}
          >
            + AWS IAM Connector
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openProviderModal('github')}
          >
            Connect Provider
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="info" onClose={() => setNotice('')} sx={{ borderRadius: 2 }}>
          {notice}
        </Alert>
      )}

      <Perspective3DCard sx={{ p: 2.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#09090b', mb: 1.25 }}>
          Add Live Verified Integration
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {PROVIDER_CONFIGS.map((cfg) => (
            <Button
              key={cfg.provider}
              size="small"
              variant="outlined"
              onClick={() => openProviderModal(cfg.provider)}
              sx={{
                borderColor: 'rgba(15, 23, 42, 0.2)',
                color: '#09090b',
                fontWeight: 600,
                '&:hover': { borderColor: '#2563eb', bgcolor: '#eff6ff', color: '#1d4ed8' },
              }}
            >
              + {cfg.label}
            </Button>
          ))}
        </Box>
      </Perspective3DCard>

      <Tabs
        value={categoryFilter}
        onChange={(_, v) => setCategoryFilter(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: '1px solid rgba(15, 23, 42, 0.1)',
          '& .MuiTab-root': { fontWeight: 700, textTransform: 'none' },
        }}
      >
        <Tab label={`All (${integrations.length})`} value="all" />
        <Tab label="Cloud Providers" value="cloud" />
        <Tab label="Source Control (SCM)" value="scm" />
        <Tab label="Registries" value="registry" />
        <Tab label="Secrets & KMS" value="secrets" />
        <Tab label="DNS & Edge" value="dns" />
        <Tab label={`AWS IAM Raw (${awsConnectors.length})`} value="aws-iam" />
      </Tabs>

      {categoryFilter === 'aws-iam' ? (
        <Perspective3DCard sx={{ p: 3 }}>
          <ConnectorList
            connectors={awsConnectors}
            onDelete={handleDeleteAwsConnector}
            onStatusUpdate={setAwsConnectors}
          />
        </Perspective3DCard>
      ) : filtered.length === 0 ? (
        <Perspective3DCard sx={{ p: 4, textAlign: 'center' }}>
          <CableIcon sx={{ fontSize: 42, color: '#2563eb', mb: 1 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b', mb: 0.75 }}>
            No Verified Integrations Connected
          </Typography>
          <Typography variant="body2" sx={{ color: '#475569', maxWidth: 520, mx: 'auto', mb: 2.5 }}>
            Click <strong>+ AWS IAM Connector</strong> to connect your AWS account or select GitHub, GitLab, ECR, Docker Hub, Cloudflare, or GCP above. Invalid or dummy tokens are rejected by live verification.
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={() => setAwsModalOpen(true)} sx={{ borderColor: '#09090b', color: '#09090b' }}>
              + AWS IAM Connector
            </Button>
            <Button variant="contained" onClick={() => openProviderModal('github')}>
              Connect GitHub Token
            </Button>
          </Box>
        </Perspective3DCard>
      ) : (
        <Grid container spacing={2.5}>
          {filtered.map((item) => {
            const cat = CATEGORY_META[item.category];
            const isHealthy = item.status === 'connected';
            return (
              <Grid item xs={12} md={6} lg={4} key={item.id}>
                <Perspective3DCard
                  sx={{
                    p: 2.5,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.25 }}>
                      <Chip
                        icon={cat?.icon as any}
                        label={cat?.label || item.category}
                        size="small"
                        sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 600 }}
                      />
                      <Chip
                        icon={
                          isHealthy ? (
                            <CheckCircleIcon sx={{ color: '#2563eb !important', fontSize: 15 }} />
                          ) : (
                            <ErrorIcon sx={{ color: '#dc2626 !important', fontSize: 15 }} />
                          )
                        }
                        label={
                          isHealthy
                            ? item.latencyMs > 0
                              ? `Verified · ${item.latencyMs}ms`
                              : 'Connected'
                            : 'Verification Error'
                        }
                        size="small"
                        sx={{
                          bgcolor: isHealthy ? '#eff6ff' : '#fee2e2',
                          color: isHealthy ? '#1d4ed8' : '#b91c1c',
                          fontWeight: 700,
                        }}
                      />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#09090b' }}>
                      {item.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#475569', mt: 0.5 }}>
                      {item.scope}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'inline-block',
                        mt: 1,
                        px: 1.2,
                        py: 0.35,
                        borderRadius: 1.5,
                        bgcolor: '#f8fafc',
                        border: '1px solid rgba(15,23,42,0.1)',
                        fontFamily: 'monospace',
                        color: '#0f172a',
                      }}
                    >
                      {item.credentialHint}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mt: 2.5,
                      pt: 1.5,
                      borderTop: '1px solid rgba(15,23,42,0.08)',
                    }}
                  >
                    <Typography variant="caption" sx={{ color: '#64748b' }}>
                      Provider: <strong>{item.provider.toUpperCase()}</strong>
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="Run Live API Health Check">
                        <span>
                          <IconButton
                            size="small"
                            disabled={testingId === item.id}
                            onClick={() => handleTest(item)}
                          >
                            {testingId === item.id ? (
                              <CircularProgress size={16} />
                            ) : (
                              <RefreshIcon fontSize="small" sx={{ color: '#2563eb' }} />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Disconnect">
                        <IconButton size="small" onClick={() => handleDelete(item)}>
                          <DeleteIcon fontSize="small" sx={{ color: '#475569' }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                </Perspective3DCard>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Provider Credential Verification Modal */}
      <Dialog open={addModalOpen} onClose={() => setAddModalOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCreateIntegration}>
          <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
            Connect {currentCfg.label} (Live API Verification)
          </DialogTitle>
          <DialogContent sx={{ bgcolor: '#ffffff', pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Alert severity="info">{currentCfg.hint}</Alert>
            {modalError && <Alert severity="error">{modalError}</Alert>}

            <FormControl fullWidth size="small">
              <InputLabel>Provider</InputLabel>
              <Select
                label="Provider"
                value={formProvider}
                onChange={(e) => {
                  setFormProvider(e.target.value as any);
                  setModalError('');
                }}
              >
                {PROVIDER_CONFIGS.map((p) => (
                  <MenuItem key={p.provider} value={p.provider}>
                    {p.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Connection Display Name"
              placeholder={`e.g. Prod ${currentCfg.label}`}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              size="small"
              fullWidth
            />

            {formProvider === 'gitlab' && (
              <TextField
                label="GitLab Base URL"
                value={formEndpoint}
                onChange={(e) => setFormEndpoint(e.target.value)}
                required
                size="small"
                fullWidth
              />
            )}

            {formProvider === 'dockerhub' && (
              <TextField
                label="Docker Hub Username"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                required
                size="small"
                fullWidth
              />
            )}

            {isAwsSubtype ? (
              <>
                <TextField
                  label="AWS Region"
                  value={awsRegion}
                  onChange={(e) => setAwsRegion(e.target.value)}
                  size="small"
                  fullWidth
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={useActiveAws}
                      onChange={(e) => setUseActiveAws(e.target.checked)}
                    />
                  }
                  label="Use active AWS IAM Connector credentials"
                />
                {!useActiveAws && (
                  <>
                    <TextField
                      label="AWS Access Key ID"
                      value={awsAccessKey}
                      onChange={(e) => setAwsAccessKey(e.target.value)}
                      required
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="AWS Secret Access Key"
                      type="password"
                      value={awsSecretKey}
                      onChange={(e) => setAwsSecretKey(e.target.value)}
                      required
                      size="small"
                      fullWidth
                    />
                  </>
                )}
              </>
            ) : (
              <>
                {currentCfg.scopePlaceholder && formProvider !== 'dockerhub' && (
                  <TextField
                    label="Scope / Repository (Optional)"
                    placeholder={currentCfg.scopePlaceholder}
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value)}
                    size="small"
                    fullWidth
                  />
                )}
                <TextField
                  label={currentCfg.secretLabel}
                  type={formProvider === 'gcp' ? 'text' : 'password'}
                  multiline={formProvider === 'gcp'}
                  rows={formProvider === 'gcp' ? 4 : 1}
                  value={formSecret}
                  onChange={(e) => setFormSecret(e.target.value)}
                  required
                  size="small"
                  fullWidth
                />
              </>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5, bgcolor: '#f8fafc' }}>
            <Button onClick={() => setAddModalOpen(false)} sx={{ color: '#475569' }}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={submitting || !formName.trim()}>
              {submitting ? 'Verifying with Provider...' : 'Verify & Connect'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* AWS IAM Connector Modal */}
      <Dialog open={awsModalOpen} onClose={() => setAwsModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
          Add Live AWS IAM Credentials
        </DialogTitle>
        <DialogContent sx={{ bgcolor: '#ffffff', pt: '20px !important' }}>
          <ConnectorForm onSubmit={handleAwsSubmit} />
        </DialogContent>
      </Dialog>
    </Box>
  );
};
