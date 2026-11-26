import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Pipelines } from './Pipelines';
import { CloudResources } from './CloudResources';
import { Integrations } from './Integrations';
import { clearSwrCache } from '../utils/swrCache';

jest.mock(
  'react-router-dom',
  () => ({
    useNavigate: () => jest.fn(),
    useLocation: () => ({ search: '' }),
  }),
  { virtual: true }
);

jest.mock('../auth/AuthContext', () => ({
  useTesserakAuth: () => ({
    userEmail: 'test@tesserak.dev',
  }),
}));

describe('Pipelines Hide Logs & CloudResources AWS Sync', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearSwrCache();
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps execution logs hidden after clicking Hide Logs without reopening', async () => {
    const samplePipeline = {
      id: 'pip-1',
      name: 'demo-app',
      repositoryUrl: 'https://github.com/ankitanand12/demo-app.git',
      branch: 'master',
      targetCluster: 'eks:replit-migration-eks',
      namespace: 'default',
      manifestPath: '.',
      verifiedRemoteSha: 'e33b3bb',
      status: 'Succeeded',
      lastRunNumber: 2,
      durationSec: 11.4,
      stages: [
        {
          name: 'Cluster Pod Verification',
          status: 'Succeeded',
          durationSec: 4.5,
          log: 'deployment "demo-app-deployment" successfully rolled out\npod/demo-app-1 1/1 Running 10.42.5.71',
        },
      ],
      recentRuns: [],
    };

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pipelines')) {
        return { ok: true, json: async () => [samplePipeline] } as Response;
      }
      if (url.endsWith('/api/cluster-targets') || url.endsWith('/api/integrations')) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }) as any;

    render(<Pipelines />);

    const hideBtn = await screen.findByRole('button', { name: 'Hide Logs' });
    expect(hideBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/REAL SUBPROCESS STDOUT/i)).toBeInTheDocument();

    fireEvent.click(hideBtn);

    const execBtn = await screen.findByRole('button', { name: 'Execution Logs' });
    expect(execBtn).toHaveAttribute('aria-expanded', 'false');

    // Allow any async effects/SWR checks to settle and confirm logs remain collapsed
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(screen.getByRole('button', { name: 'Execution Logs' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/REAL SUBPROCESS STDOUT/i)).not.toBeInTheDocument();
  });

  it('syncs all 70 AWS resources including tesserak-beta on Sync AWS and filters via search', async () => {
    const initial15 = Array.from({ length: 15 }, (_, i) => ({
      id: `aws-s3-a-bucket-${i}`,
      name: `a-bucket-${i}`,
      provider: 'aws',
      serviceType: 'S3 Bucket',
      region: 'us-east-1',
      environment: 'staging',
      spec: 'S3 Standard Object Store',
      encrypted: true,
      publicAccess: false,
      status: 'Active',
      driftStatus: 'In Sync',
      guardrailNotes: ['SSE encrypted · Public Access Blocked'],
      createdAt: '2026-10-01T00:00:00Z',
      lastSyncAt: '2026-11-26T00:00:00Z',
      source: 'aws-live',
    }));

    const refreshed70 = [
      {
        id: 'aws-s3-tesserak-beta',
        name: 'tesserak-beta',
        provider: 'aws',
        serviceType: 'S3 Bucket',
        region: 'us-east-1',
        environment: 'staging',
        spec: 'S3 Standard Object Store',
        encrypted: true,
        publicAccess: false,
        status: 'Active',
        driftStatus: 'In Sync',
        guardrailNotes: ['SSE encrypted · Public Access Blocked'],
        createdAt: '2026-11-25T23:52:25Z',
        lastSyncAt: '2026-11-26T00:00:00Z',
        source: 'aws-live',
      },
      ...Array.from({ length: 69 }, (_, i) => ({
        ...initial15[0],
        id: `aws-s3-bucket-${i}`,
        name: `bucket-${i}`,
      })),
    ];

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('refresh=true')) {
        return {
          ok: true,
          json: async () => ({
            awsConnected: true,
            accountId: '162655485574',
            region: 'us-east-1',
            resources: refreshed70,
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          awsConnected: true,
          accountId: '162655485574',
          region: 'us-east-1',
          resources: initial15,
        }),
      } as Response;
    }) as any;

    render(<CloudResources />);

    await waitFor(() => {
      expect(screen.getByText('a-bucket-0')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sync AWS' }));

    await waitFor(() => {
      expect(screen.getByText('tesserak-beta')).toBeInTheDocument();
    });
    expect(screen.getByText('Live AWS inventory synchronized.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search resources, service, region...'), {
      target: { value: 'tesserak-beta' },
    });
    expect(screen.getByText('1 of 70')).toBeInTheDocument();
    expect(screen.queryByText('bucket-0')).not.toBeInTheDocument();
  });

  it('requires confirmation before deleting Pipelines, CloudResources, and Integrations', async () => {
    const deleteCalls: string[] = [];
    const samplePipeline = {
      id: 'pip-del-1',
      name: 'demo-app',
      repositoryUrl: 'https://github.com/ankitanand12/demo-app.git',
      branch: 'master',
      targetCluster: 'eks:replit-migration-eks',
      namespace: 'default',
      manifestPath: '.',
      verifiedRemoteSha: 'e33b3bb',
      status: 'Succeeded',
      lastRunNumber: 2,
      durationSec: 11.4,
      stages: [],
      recentRuns: [],
    };
    const sampleBucket = {
      id: 'aws-s3-tesserak-beta',
      name: 'tesserak-beta',
      provider: 'aws',
      serviceType: 'S3 Bucket',
      region: 'us-east-1',
      environment: 'staging',
      spec: 'S3 Standard Object Store',
      encrypted: true,
      publicAccess: false,
      status: 'Active',
      driftStatus: 'In Sync',
      guardrailNotes: ['SSE encrypted'],
      createdAt: '2026-11-25T23:52:25Z',
      lastSyncAt: '2026-11-26T00:00:00Z',
      source: 'aws-live',
    };
    const sampleIntegration = {
      id: 'int-gh-1',
      name: 'github-prod',
      provider: 'github',
      category: 'scm',
      scope: 'ankitanand12/demo-app',
      credentialHint: 'ghp_***',
      status: 'connected',
      lastCheckedAt: '2026-11-26T00:00:00Z',
      latencyMs: 40,
      managedBy: 'tesserak',
    };

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') {
        deleteCalls.push(url);
        return {
          ok: true,
          json: async () => ({
            status: 'deleted',
            message: 'Deleted cleanly.',
            clusterCleanup: {
              attempted: true,
              cleaned: true,
              deletedResources: ['deployment.apps "demo-app-deployment" deleted'],
            },
          }),
        } as Response;
      }
      if (url.endsWith('/api/pipelines')) {
        return { ok: true, json: async () => [samplePipeline] } as Response;
      }
      if (url.includes('/api/resources')) {
        return {
          ok: true,
          json: async () => ({ awsConnected: true, accountId: '162655485574', region: 'us-east-1', resources: [sampleBucket] }),
        } as Response;
      }
      if (url.endsWith('/api/integrations')) {
        return { ok: true, json: async () => [sampleIntegration] } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    }) as any;

    // 1. Pipelines delete confirmation + cluster cleanup
    const pipRender = render(<Pipelines />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete demo-app' }));
    expect(await screen.findByText('Delete CI/CD Pipeline?')).toBeInTheDocument();
    expect(deleteCalls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() => {
      expect(deleteCalls).toContain('http://localhost:8000/api/pipelines/pip-del-1?cleanup_cluster=true');
    });
    expect(await screen.findByText(/deployment\.apps "demo-app-deployment" deleted/i)).toBeInTheDocument();
    pipRender.unmount();

    // 2. Cloud Resources delete confirmation (Cancel aborts, Confirm deletes)
    clearSwrCache();
    const resRender = render(<CloudResources />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tesserak-beta' }));
    expect(await screen.findByText('Delete AWS Resource?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(deleteCalls).toHaveLength(1);
    resRender.unmount();

    // 3. Integrations disconnect confirmation
    clearSwrCache();
    render(<Integrations />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect github-prod' }));
    expect(await screen.findByText('Disconnect Integration?')).toBeInTheDocument();
    expect(deleteCalls).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Disconnect' }));
    await waitFor(() => {
      expect(deleteCalls).toContain('http://localhost:8000/api/integrations/int-gh-1');
    });
  });
});
