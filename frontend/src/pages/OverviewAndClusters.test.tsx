import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

const mockNavigate = jest.fn();
let mockPathname = '/';

jest.mock(
  'react-router-dom',
  () => ({
    HashRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Routes: ({ children }: { children: any }) => {
      const mockReact = require('react');
      const childArray = mockReact.Children.toArray(children) as any[];
      const match = childArray.find((c) => c?.props?.path === mockPathname);
      return mockReact.createElement(mockReact.Fragment, null, match ? match.props.element : null);
    },
    Route: () => null,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: mockPathname, search: '' }),
  }),
  { virtual: true }
);

const sampleOverview = {
  integrationsCount: 2,
  connectedIntegrations: 2,
  resourcesCount: 3,
  driftedResources: 1,
  awsConnected: true,
  enabledGuardrails: 5,
  totalGuardrails: 5,
  pendingApprovals: 1,
  pipelinesCount: 2,
  healthyPipelines: 1,
  activeRunningPipelines: 0,
  complianceScore: 100,
  alerts: [
    {
      id: 'alert-pip-1',
      severity: 'error',
      category: 'CI/CD Failure',
      title: 'Pipeline Failed: api-gateway',
      detail: 'Run #4 failed at stage Guardrail Manifest Scan.',
      timestamp: '2026-11-25T00:00:00Z',
      actionPath: '/pipelines?pipelineId=pip-1',
      actionLabel: 'Inspect Trace',
    },
    {
      id: 'alert-drift-1',
      severity: 'warning',
      category: 'Cloud Drift',
      title: 'Drift Detected: logs-bucket (S3 Bucket)',
      detail: 'PublicAccessBlock incomplete',
      timestamp: '2026-11-25T00:05:00Z',
      actionPath: '/resources',
      actionLabel: 'Remediate',
    },
  ],
  recentDeployments: [
    {
      id: 'pip-2-r3',
      pipelineId: 'pip-2',
      pipelineName: 'checkout-service',
      repositoryUrl: 'https://github.com/org/checkout.git',
      branch: 'main',
      commitSha: 'a1b2c3d4',
      targetCluster: 'eks:prod-eks-core',
      namespace: 'payments',
      runNumber: 3,
      status: 'Succeeded',
      durationSec: 14.2,
      triggeredAt: '2026-11-25T00:10:00Z',
      triggeredBy: 'ops@tesserak.dev',
      stagesSummary: [
        { name: 'Git Checkout', status: 'Succeeded', durationSec: 2.1 },
        { name: 'Deploy to Cluster', status: 'Succeeded', durationSec: 6.4 },
      ],
    },
  ],
  recentPipelines: [],
};

const sampleClusters = [
  {
    name: 'prod-eks-core',
    status: 'ACTIVE',
    accountId: '123456789012',
    region: 'us-east-1',
    version: '1.30',
    endpoint: 'https://eks.us-east-1.amazonaws.com',
    stateStatus: 'differences_found',
    createdAt: '2026-11-20T10:00:00Z',
  },
];

describe('Overview vs Clusters route separation and visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem('currentUser', 'ops@tesserak.dev');
    localStorage.setItem('authProvider', 'local');

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/atmosly/overview')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => sampleOverview,
        } as Response);
      }
      if (url.endsWith('/clusters')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => sampleClusters,
        } as Response);
      }
      if (url.includes('/clusters/prod-eks-core/sync') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ message: 'State synchronized successfully' }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    }) as jest.Mock;
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('route "/" renders Platform Overview with Alerts and Recent Deployments', async () => {
    mockPathname = '/';
    render(<App />);

    expect(await screen.findByRole('heading', { name: /Platform Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Alerts & Attention/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Recent Deployments/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Kubernetes Clusters Inventory/i })).not.toBeInTheDocument();

    expect(await screen.findByText(/Pipeline Failed: api-gateway/i)).toBeInTheDocument();
    expect(screen.getByText(/Drift Detected: logs-bucket/i)).toBeInTheDocument();
    expect(screen.getByText(/EKS Drift Detected: prod-eks-core/i)).toBeInTheDocument();

    expect(screen.getByText('checkout-service')).toBeInTheDocument();
    expect(screen.getByText(/#3 · Succeeded/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Logs/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/pipelines?pipelineId=pip-2');
  });

  test('route "/clusters" renders dedicated EKS Clusters page instead of Overview', async () => {
    mockPathname = '/clusters';
    render(<App />);

    expect(await screen.findByRole('heading', { name: /^EKS Clusters$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Kubernetes Clusters Inventory/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Platform Overview/i })).not.toBeInTheDocument();

    expect(await screen.findByText('prod-eks-core')).toBeInTheDocument();
    expect(screen.getByText('Needs Sync')).toBeInTheDocument();

    const syncBtn = screen.getByRole('button', { name: /Sync prod-eks-core/i });
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/clusters/prod-eks-core/sync',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
