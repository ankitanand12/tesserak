export type IntegrationCategory = 'cloud' | 'scm' | 'registry' | 'secrets' | 'dns';

export type IntegrationProvider =
  | 'aws'
  | 'github'
  | 'gitlab'
  | 'aws-ecr'
  | 'aws-secrets'
  | 'dockerhub'
  | 'cloudflare'
  | 'gcp';

export interface IntegrationItem {
  id: string;
  name: string;
  provider: IntegrationProvider;
  category: IntegrationCategory;
  scope: string;
  endpoint?: string;
  credentialHint: string;
  status: 'connected' | 'error' | 'disconnected' | string;
  lastCheckedAt: string;
  latencyMs: number;
  managedBy: string;
  metadata?: Record<string, any>;
}

export type GuardrailSeverity = 'block' | 'warn' | 'approval';

export interface GuardrailRule {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: GuardrailSeverity;
  enabled: boolean;
  threshold?: number | null;
  violations: number;
  updatedAt: string;
}

export interface GuardrailApproval {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceKind: string;
  environment: string;
  requestedBy: string;
  estimatedMonthlyCost: number;
  triggeredRule: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string | null;
  comment?: string | null;
}

export interface GuardrailFinding {
  resourceName: string;
  resourceType: string;
  ruleId: string;
  ruleName: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface GuardrailAudit {
  awsConnected: boolean;
  accountId?: string | null;
  region?: string | null;
  findings: GuardrailFinding[];
  complianceScore: number | null;
  checkedCount: number;
  passedCount: number;
  message: string;
}

export interface GuardrailsSummary {
  enabledRules: number;
  totalRules: number;
  pendingApprovals: number;
  complianceScore: number | null;
  awsConnected: boolean;
}

export interface CloudResource {
  id: string;
  name: string;
  provider: 'aws';
  serviceType: string;
  region: string;
  environment: string;
  spec: string;
  encrypted: boolean;
  publicAccess: boolean;
  status: string;
  driftStatus: 'In Sync' | 'Drifted' | string;
  guardrailNotes: string[];
  createdAt: string;
  lastSyncAt: string;
  arn?: string;
  source?: string;
}

export interface ResourcesResponse {
  awsConnected: boolean;
  accountId?: string | null;
  region?: string | null;
  resources: CloudResource[];
  warnings?: string[];
  error?: string;
}

export interface ClusterTarget {
  id: string;
  name: string;
  type: 'aws-eks' | 'kubectl-context';
  region: string;
}

export interface PipelineStage {
  name: string;
  status: 'Succeeded' | 'Running' | 'Failed' | 'Skipped' | string;
  durationSec: number;
  log: string;
}

export interface PipelineRunSummary {
  runNumber: number;
  commitSha: string;
  status: 'Succeeded' | 'Running' | 'Failed' | string;
  durationSec: number;
  triggeredAt: string;
  branch: string;
}

export interface PipelineItem {
  id: string;
  name: string;
  repositoryUrl: string;
  branch: string;
  targetCluster: string;
  namespace: string;
  manifestPath: string;
  dockerfilePath?: string;
  imageTag?: string;
  gitIntegrationId?: string;
  verifiedRemoteSha?: string;
  lastRunNumber: number;
  status: 'Ready' | 'Running' | 'Succeeded' | 'Failed' | string;
  durationSec: number;
  triggeredBy: string;
  lastRunAt: string;
  stages: PipelineStage[];
  recentRuns: PipelineRunSummary[];
}

export type AlertSource =
  | 'drifted_resources'
  | 'guardrail_failures'
  | 'pending_approvals'
  | 'failed_pipelines'
  | 'connection_warnings';

export type AlertSeverity = 'critical' | 'approval' | 'warning';

export interface OverviewAlert {
  id: string;
  source: AlertSource;
  category: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  resourceName: string;
  actionLabel: string;
  actionPath: string;
  timestamp: string;
}

export interface RecentDeployment {
  id: string;
  pipelineId: string;
  pipelineName: string;
  repositoryUrl: string;
  branch: string;
  commitSha: string;
  targetCluster: string;
  namespace: string;
  runNumber: number;
  status: 'Succeeded' | 'Running' | 'Failed' | 'Ready' | string;
  durationSec: number;
  timestamp: string;
  triggeredBy: string;
}

export interface PlatformOverview {
  integrationsCount: number;
  connectedIntegrations: number;
  resourcesCount: number;
  driftedResources: number;
  awsConnected: boolean;
  awsAccountId?: string | null;
  awsRegion?: string | null;
  enabledGuardrails: number;
  totalGuardrails: number;
  pendingApprovals: number;
  pipelinesCount: number;
  healthyPipelines: number;
  failedPipelines?: number;
  runningPipelines?: number;
  complianceScore: number;
  alertsCount?: number;
  alerts?: OverviewAlert[];
  recentDeployments?: RecentDeployment[];
}
