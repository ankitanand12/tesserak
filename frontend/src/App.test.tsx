import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { TesserakAuthProvider } from './auth/AuthContext';
import Dashboard from './pages/Dashboard';
import { Clusters } from './pages/Clusters';

jest.mock(
  'react-router-dom',
  () => ({
    HashRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Route: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: '/' }),
  }),
  { virtual: true }
);

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

test('renders Tesserak branding on auth screen', () => {
  render(<App />);
  const brandElement = screen.getByRole('heading', { name: /Tesserak/i });
  expect(brandElement).toBeInTheDocument();
  expect(screen.getByText(/EKS Cluster Manager/i)).toBeInTheDocument();
});

test('Overview renders live alerts, severity filters, and recent pipeline deployments', async () => {
  localStorage.setItem('currentUser', 'ops@tesserak.dev');
  const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.includes('/api/atmosly/overview')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          integrationsCount: 2,
          connectedIntegrations: 2,
          resourcesCount: 3,
          driftedResources: 1,
          awsConnected: true,
          enabledGuardrails: 5,
          totalGuardrails: 5,
          pendingApprovals: 1,
          pipelinesCount: 1,
          healthyPipelines: 1,
          complianceScore: 80,
          alertsCount: 2,
          alerts: [
            {
              id: 'drift-aws-s3-logs',
              source: 'drifted_resources',
              category: 'Cloud Drift',
              severity: 'critical',
              title: 'Drifted Resource: logs-bucket (S3 Bucket)',
              detail: 'us-east-1 · Bucket default encryption not set',
              resourceName: 'logs-bucket',
              actionLabel: 'Remediate Drift',
              actionPath: '/resources',
              timestamp: new Date().toISOString(),
            },
            {
              id: 'apr-1',
              source: 'pending_approvals',
              category: 'Approval',
              severity: 'approval',
              title: 'Approval Pending: prod-pg (RDS PostgreSQL)',
              detail: 'Estimated $290/mo exceeds ceiling ($250/mo)',
              resourceName: 'prod-pg',
              actionLabel: 'Review Approval',
              actionPath: '/guardrails',
              timestamp: new Date().toISOString(),
            },
          ],
          recentDeployments: [
            {
              id: 'pip-1-r3',
              pipelineId: 'pip-1',
              pipelineName: 'payments-api-gitops',
              repositoryUrl: 'https://github.com/org/payments.git',
              branch: 'main',
              commitSha: '9f8e7d6',
              targetCluster: 'eks:prod-eks',
              namespace: 'payments',
              runNumber: 3,
              status: 'Succeeded',
              durationSec: 6.4,
              timestamp: new Date().toISOString(),
              triggeredBy: 'ops@tesserak.dev',
            },
          ],
        }),
      } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => [],
    } as any;
  });

  render(
    <TesserakAuthProvider>
      <Dashboard />
    </TesserakAuthProvider>
  );

  await waitFor(() => {
    expect(screen.getByText(/Drifted Resource: logs-bucket/i)).toBeInTheDocument();
  });
  expect(screen.getByText(/Approval Pending: prod-pg/i)).toBeInTheDocument();
  expect(screen.getByText('payments-api-gitops')).toBeInTheDocument();
  expect(screen.getByText('9f8e7d6')).toBeInTheDocument();

  // Filter alerts down to Approvals only
  fireEvent.click(screen.getByText(/Approvals \(1\)/i));
  expect(screen.queryByText(/Drifted Resource: logs-bucket/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Approval Pending: prod-pg/i)).toBeInTheDocument();

  fetchSpy.mockRestore();
});

test('Clusters page renders dedicated AWS EKS Clusters view with Sync action for unsynced clusters', async () => {
  localStorage.setItem('currentUser', 'ops@tesserak.dev');
  const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.endsWith('/clusters')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            name: 'test-anish',
            status: 'ACTIVE',
            accountId: '783953295581',
            region: 'us-east-1',
            version: '1.29',
            stateStatus: 'missing_local',
            createdAt: new Date().toISOString(),
          },
        ],
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });

  render(
    <TesserakAuthProvider>
      <Clusters />
    </TesserakAuthProvider>
  );

  expect(screen.getByRole('heading', { name: /AWS EKS Clusters/i })).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByText('test-anish')).toBeInTheDocument();
  });
  expect(screen.getByText(/AWS Live \(Unsynced\)/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Sync/i })).toBeInTheDocument();

  fetchSpy.mockRestore();
});
