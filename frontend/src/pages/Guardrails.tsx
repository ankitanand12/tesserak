import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  GppGood as GppGoodIcon,
  Policy as PolicyIcon,
  Refresh as RefreshIcon,
  VerifiedUser as VerifiedUserIcon,
} from '@mui/icons-material';
import { useTesserakAuth } from '../auth/AuthContext';
import { Perspective3DCard } from '../components/Perspective3DCard';
import {
  GuardrailApproval,
  GuardrailAudit,
  GuardrailRule,
  GuardrailSeverity,
  GuardrailsSummary,
} from '../types/platform';
import { fetchWithSwr, invalidateSwrCache, readSwrCache } from '../utils/swrCache';

export const Guardrails: React.FC = () => {
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || 'demo@tesserak.dev';

  const cachedGuard = readSwrCache<{
    rules: GuardrailRule[];
    approvals: GuardrailApproval[];
    audit: GuardrailAudit | null;
    summary: GuardrailsSummary | null;
  }>(userEmail, 'guardrails');

  const [rules, setRules] = useState<GuardrailRule[]>(() => cachedGuard?.rules ?? []);
  const [approvals, setApprovals] = useState<GuardrailApproval[]>(() => cachedGuard?.approvals ?? []);
  const [audit, setAudit] = useState<GuardrailAudit | null>(() => cachedGuard?.audit ?? null);
  const [summary, setSummary] = useState<GuardrailsSummary | null>(() => cachedGuard?.summary ?? null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newRuleOpen, setNewRuleOpen] = useState(false);

  const [ruleName, setRuleName] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [ruleCategory, setRuleCategory] = useState('Security');
  const [ruleSeverity, setRuleSeverity] = useState<GuardrailSeverity>('block');

  const loadGuardrails = useCallback(
    async (force: boolean = false) => {
      try {
        const data = await fetchWithSwr(
          userEmail,
          'guardrails',
          async () => {
            const url = force
              ? 'http://localhost:8000/api/guardrails?refresh=true'
              : 'http://localhost:8000/api/guardrails';
            const res = await fetch(url, {
              headers: { 'x-user-email': userEmail },
            });
            if (!res.ok) throw new Error('Unable to load guardrails');
            const parsed = await res.json();
            return {
              rules: (parsed.rules || []) as GuardrailRule[],
              approvals: (parsed.approvals || []) as GuardrailApproval[],
              audit: (parsed.audit || null) as GuardrailAudit | null,
              summary: (parsed.summary || null) as GuardrailsSummary | null,
            };
          },
          { force, dedupeWindowMs: 5000 }
        );
        setRules(data.rules);
        setApprovals(data.approvals);
        setAudit(data.audit);
        setSummary(data.summary);
      } catch (err: any) {
        if (!readSwrCache(userEmail, 'guardrails')) {
          setError(err.message || 'Failed to load policy engine');
        }
      }
    },
    [userEmail]
  );

  useEffect(() => {
    loadGuardrails(false);
  }, [loadGuardrails]);

  const handleToggleRule = async (rule: GuardrailRule) => {
    const res = await fetch(`http://localhost:8000/api/guardrails/rules/${rule.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': userEmail,
      },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (res.ok) {
      setNotice(`Guardrail "${rule.name}" ${!rule.enabled ? 'enabled' : 'paused'}.`);
      invalidateSwrCache(userEmail, 'guardrails');
      invalidateSwrCache(userEmail, 'overview');
      await loadGuardrails(true);
    }
  };

  const handleSeverityChange = async (ruleId: string, severity: GuardrailSeverity) => {
    const res = await fetch(`http://localhost:8000/api/guardrails/rules/${ruleId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': userEmail,
      },
      body: JSON.stringify({ severity }),
    });
    if (res.ok) {
      invalidateSwrCache(userEmail, 'guardrails');
      invalidateSwrCache(userEmail, 'overview');
      await loadGuardrails(true);
    }
  };

  const handleDecision = async (approvalId: string, decision: 'approve' | 'reject') => {
    setError('');
    setNotice('');
    try {
      const res = await fetch(`http://localhost:8000/api/approvals/${approvalId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail,
        },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Approval action failed');
        return;
      }
      setNotice(
        decision === 'approve'
          ? 'Approved and created live resource in AWS.'
          : 'Request rejected by Guardrail reviewer.'
      );
      invalidateSwrCache(userEmail, 'guardrails');
      invalidateSwrCache(userEmail, 'resources');
      invalidateSwrCache(userEmail, 'overview');
      await loadGuardrails(true);
    } catch {
      setError('Failed to submit decision');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('http://localhost:8000/api/guardrails/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': userEmail,
      },
      body: JSON.stringify({
        name: ruleName,
        description: ruleDesc,
        category: ruleCategory,
        severity: ruleSeverity,
      }),
    });
    if (res.ok) {
      setNewRuleOpen(false);
      setRuleName('');
      setRuleDesc('');
      setNotice('Custom Guardrail rule added and active.');
      invalidateSwrCache(userEmail, 'guardrails');
      invalidateSwrCache(userEmail, 'overview');
      await loadGuardrails(true);
    }
  };

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

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
              Policy Guardrails
            </Typography>
            <Chip
              icon={<VerifiedUserIcon sx={{ color: '#60a5fa !important', fontSize: 16 }} />}
              label="Live Enforcement + Audit"
              size="small"
              sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 600 }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#475569' }}>
            Enforces policy rules against live AWS provisioning, Kubernetes pipeline manifests, and real AWS EKS/RDS/S3 account scans.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => loadGuardrails(true)}
            sx={{ borderColor: '#09090b', color: '#09090b' }}
          >
            Run Live Scan
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewRuleOpen(true)}>
            Add Rule
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

      <Grid container spacing={2.5}>
        <Grid item xs={12} sm={3}>
          <Perspective3DCard
            sx={{
              p: 2.5,
              bgcolor: '#09090b',
              color: '#ffffff',
              border: '1px solid rgba(59, 130, 246, 0.45)',
            }}
          >
            <Typography variant="caption" sx={{ color: '#93c5fd', fontWeight: 700 }}>
              LIVE AWS COMPLIANCE
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, mt: 0.5 }}>
              {audit?.awsConnected && audit.complianceScore !== null
                ? `${audit.complianceScore}%`
                : 'N/A'}
            </Typography>
            <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
              {audit?.awsConnected
                ? `${audit.passedCount}/${audit.checkedCount} live checks passed`
                : 'Connect AWS IAM to audit live resources'}
            </Typography>
          </Perspective3DCard>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Perspective3DCard sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              ACTIVE POLICIES
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mt: 0.5 }}>
              {summary?.enabledRules ?? rules.length}/{summary?.totalRules ?? rules.length}
            </Typography>
            <Typography variant="caption" sx={{ color: '#2563eb', fontWeight: 600 }}>
              Checked on create, pipeline & delete
            </Typography>
          </Perspective3DCard>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Perspective3DCard sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              LIVE FINDINGS COUNT
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#09090b', mt: 0.5 }}>
              {audit?.findings.filter((f) => f.status === 'FAIL').length ?? 0}
            </Typography>
            <Typography variant="caption" sx={{ color: '#475569' }}>
              Real AWS failing checks
            </Typography>
          </Perspective3DCard>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Perspective3DCard sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
              PENDING APPROVALS
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#2563eb', mt: 0.5 }}>
              {pendingCount}
            </Typography>
            <Typography variant="caption" sx={{ color: '#475569' }}>
              Held before AWS API create
            </Typography>
          </Perspective3DCard>
        </Grid>
      </Grid>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          borderBottom: '1px solid rgba(15, 23, 42, 0.1)',
          '& .MuiTab-root': { fontWeight: 700, textTransform: 'none' },
        }}
      >
        <Tab label={`Policy Rules (${rules.length})`} />
        <Tab label={`Live AWS Audit Findings (${audit?.findings.length ?? 0})`} />
        <Tab label={`Approval Queue (${pendingCount} Pending)`} />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={2.5}>
          {rules.map((rule) => (
            <Grid item xs={12} md={6} key={rule.id}>
              <Perspective3DCard sx={{ p: 2.5, height: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PolicyIcon sx={{ color: rule.enabled ? '#2563eb' : '#94a3b8' }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#09090b' }}>
                      {rule.name}
                    </Typography>
                  </Box>
                  <Switch checked={rule.enabled} onChange={() => handleToggleRule(rule)} color="primary" />
                </Box>

                <Typography variant="body2" sx={{ color: '#475569', my: 1.5, minHeight: 42 }}>
                  {rule.description}
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Chip label={rule.category} size="small" sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 600 }} />
                    <Chip
                      label={`${rule.violations} blocked events`}
                      size="small"
                      variant="outlined"
                      sx={{ borderColor: 'rgba(15,23,42,0.18)', color: '#475569' }}
                    />
                  </Box>

                  <Select
                    size="small"
                    value={rule.severity}
                    onChange={(e) => handleSeverityChange(rule.id, e.target.value as GuardrailSeverity)}
                    sx={{ minWidth: 140, fontSize: '0.8rem', fontWeight: 600 }}
                  >
                    <MenuItem value="block">Hard Block</MenuItem>
                    <MenuItem value="approval">Require Approval</MenuItem>
                    <MenuItem value="warn">Soft Warn</MenuItem>
                  </Select>
                </Box>
              </Perspective3DCard>
            </Grid>
          ))}
        </Grid>
      )}

      {tab === 1 && (
        <Perspective3DCard sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, bgcolor: '#f8fafc', borderBottom: '1px solid rgba(15,23,42,0.08)' }}>
            <Typography variant="body2" sx={{ color: '#09090b', fontWeight: 600 }}>
              {audit?.message || 'Run scan to evaluate AWS EKS, RDS, and S3 resources.'}
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Resource</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Guardrail Check</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Detail</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(!audit || audit.findings.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4, color: '#64748b' }}>
                      {audit?.awsConnected ? 'No EKS, RDS, or S3 resources scanned in account.' : 'No live AWS connection active.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  audit.findings.map((f, idx) => (
                    <TableRow key={`${f.resourceName}-${f.ruleId}-${idx}`}>
                      <TableCell sx={{ fontWeight: 700 }}>{f.resourceName}</TableCell>
                      <TableCell>{f.resourceType}</TableCell>
                      <TableCell>{f.ruleName}</TableCell>
                      <TableCell>
                        <Chip
                          label={f.status}
                          size="small"
                          sx={{
                            fontWeight: 700,
                            bgcolor: f.status === 'PASS' ? '#eff6ff' : '#fee2e2',
                            color: f.status === 'PASS' ? '#1d4ed8' : '#b91c1c',
                          }}
                        />
                      </TableCell>
                      <TableCell>{f.detail}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Perspective3DCard>
      )}

      {tab === 2 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {approvals.length === 0 ? (
            <Perspective3DCard sx={{ p: 4, textAlign: 'center' }}>
              <GppGoodIcon sx={{ fontSize: 40, color: '#2563eb', mb: 1 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b' }}>
                Approval Queue Empty
              </Typography>
              <Typography variant="body2" sx={{ color: '#475569' }}>
                Provision requests in Cloud Resources that exceed your FinOps Spend Ceiling appear here before calling AWS create APIs.
              </Typography>
            </Perspective3DCard>
          ) : (
            approvals.map((apr) => (
              <Perspective3DCard key={apr.id} sx={{ p: 3 }}>
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 0.5 }}>
                      <GppGoodIcon sx={{ color: '#2563eb' }} />
                      <Typography variant="h6" sx={{ fontWeight: 700, color: '#09090b' }}>
                        {apr.resourceName}
                      </Typography>
                      <Chip label={apr.resourceKind} size="small" variant="outlined" />
                      <Chip
                        label={apr.status.toUpperCase()}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          bgcolor:
                            apr.status === 'pending'
                              ? '#fef3c7'
                              : apr.status === 'approved'
                              ? '#eff6ff'
                              : '#fee2e2',
                          color:
                            apr.status === 'pending'
                              ? '#92400e'
                              : apr.status === 'approved'
                              ? '#1d4ed8'
                              : '#b91c1c',
                        }}
                      />
                    </Box>
                    <Typography variant="body2" sx={{ color: '#0f172a', fontWeight: 600 }}>
                      {apr.reason}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#64748b' }}>
                      Requested by {apr.requestedBy} · Environment: {apr.environment} · Est. ${apr.estimatedMonthlyCost}/mo
                    </Typography>
                  </Box>

                  {apr.status === 'pending' && (
                    <Box sx={{ display: 'flex', gap: 1.25 }}>
                      <Button
                        variant="outlined"
                        startIcon={<CloseIcon />}
                        onClick={() => handleDecision(apr.id, 'reject')}
                        sx={{ borderColor: '#09090b', color: '#09090b' }}
                      >
                        Reject
                      </Button>
                      <Button
                        variant="contained"
                        startIcon={<CheckIcon />}
                        onClick={() => handleDecision(apr.id, 'approve')}
                      >
                        Approve &amp; Create in AWS
                      </Button>
                    </Box>
                  )}
                </Box>
              </Perspective3DCard>
            ))
          )}
        </Box>
      )}

      <Dialog open={newRuleOpen} onClose={() => setNewRuleOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCreateRule}>
          <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
            Add Platform Guardrail Rule
          </DialogTitle>
          <DialogContent sx={{ bgcolor: '#ffffff', pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Rule Name"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              required
              size="small"
              fullWidth
            />
            <TextField
              label="Policy Description"
              value={ruleDesc}
              onChange={(e) => setRuleDesc(e.target.value)}
              required
              multiline
              rows={2}
              size="small"
              fullWidth
            />
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Category</InputLabel>
                  <Select
                    label="Category"
                    value={ruleCategory}
                    onChange={(e) => setRuleCategory(e.target.value)}
                  >
                    <MenuItem value="Security">Security</MenuItem>
                    <MenuItem value="FinOps">FinOps</MenuItem>
                    <MenuItem value="Network">Network</MenuItem>
                    <MenuItem value="Governance">Governance</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Enforcement</InputLabel>
                  <Select
                    label="Enforcement"
                    value={ruleSeverity}
                    onChange={(e) => setRuleSeverity(e.target.value as GuardrailSeverity)}
                  >
                    <MenuItem value="block">Hard Block</MenuItem>
                    <MenuItem value="approval">Require Approval</MenuItem>
                    <MenuItem value="warn">Soft Warn</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5, bgcolor: '#f8fafc' }}>
            <Button onClick={() => setNewRuleOpen(false)} sx={{ color: '#475569' }}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={!ruleName.trim() || !ruleDesc.trim()}>
              Save Rule
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};
