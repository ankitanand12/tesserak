import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClusterBasicDetails from './ClusterBasicDetails';
import ClusterEnvironment from './ClusterEnvironment';
import ClusterAddons from './ClusterAddons';
import type { ClusterConfig } from '../../pages/CreateCluster';

jest.mock('../../auth/AuthContext', () => ({
  useTesserakAuth: () => ({
    userEmail: 'ops@tesserak.dev',
    isAuthenticated: true,
    isLoading: false,
    sessionUser: { email: 'ops@tesserak.dev' },
    isAuth0Configured: false,
    authMode: 'local-fallback',
    authError: null,
    loginWithLocal: jest.fn(),
    loginWithAuth0: jest.fn(),
    simulateAuth0Sso: jest.fn(),
    logout: jest.fn(),
    getAccessToken: jest.fn(),
  }),
}));

const baseConfig: ClusterConfig = {
  name: 'test-cluster',
  accountId: '162655485574',
  accountName: 'Deloitte',
  region: 'us-east-1',
  vpc: { id: 'vpc-0d8a17ab04fc40a71', isNew: false },
  environment: {
    type: 'Non-Prod',
    endpoint: 'public-private',
    availabilityZones: ['us-east-1a', 'us-east-1b'],
    kubernetesVersion: '',
  },
  tags: [],
  addons: [],
};

describe('CreateCluster wizard fixes', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('displays integration accountName + accountId in AWS Account dropdown', async () => {
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const s = url.toString();
      if (s.includes('/api/connections/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'aws_1',
              accountName: 'Deloitte',
              accountId: '162655485574',
              region: 'us-east-1',
              status: 'connected',
            },
          ],
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }) as jest.Mock;

    const onChange = jest.fn();
    render(<ClusterBasicDetails config={baseConfig} onChange={onChange} />);

    expect(await screen.findByText('Deloitte (162655485574)')).toBeInTheDocument();
  });

  test('loads Kubernetes versions from AWS and defaults to latest', async () => {
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const s = url.toString();
      if (s.includes('/api/aws/eks-versions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            versions: [
              { version: '1.37', status: 'STANDARD_SUPPORT', isLatest: true },
              { version: '1.36', status: 'STANDARD_SUPPORT', isLatest: false },
            ],
            latest: '1.37',
          }),
        } as Response);
      }
      if (s.includes('/api/aws/zones/')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ name: 'us-east-1a' }, { name: 'us-east-1b' }],
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }) as jest.Mock;

    const onChange = jest.fn();
    render(<ClusterEnvironment config={baseConfig} onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: expect.objectContaining({
            kubernetesVersion: '1.37',
          }),
        })
      );
    });
  });

  test('defaults AWS add-ons to latest and populates community addon versions', async () => {
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const s = url.toString();
      if (s.includes('/api/aws/addon-versions/')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            'vpc-cni': [
              { version: 'v1.23.3-eksbuild.2', defaultVersion: false, isLatest: true },
              { version: 'v1.22.4-eksbuild.14', defaultVersion: true, isLatest: false },
            ],
            'kube-proxy': [{ version: 'v1.37.0-eksbuild.1', defaultVersion: true, isLatest: true }],
            coredns: [{ version: 'v1.12.4-eksbuild.1', defaultVersion: true, isLatest: true }],
            'external-dns': [
              { version: '0.20.0', defaultVersion: true, isLatest: true },
              { version: '0.19.0', defaultVersion: false, isLatest: false },
            ],
            'cert-manager': [{ version: '1.19.1', defaultVersion: true, isLatest: true }],
            'metrics-server': [{ version: '0.8.0', defaultVersion: true, isLatest: true }],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }) as jest.Mock;

    const onChange = jest.fn();
    const envConfig: ClusterConfig = {
      ...baseConfig,
      environment: { ...baseConfig.environment, kubernetesVersion: '1.37' },
    };

    render(<ClusterAddons config={envConfig} onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          addons: expect.arrayContaining([
            expect.objectContaining({ id: 'vpc-cni', version: 'v1.23.3-eksbuild.2' }),
          ]),
        })
      );
    });

    fireEvent.click(screen.getByLabelText(/External DNS/i));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        addons: expect.arrayContaining([
          expect.objectContaining({ id: 'external-dns', type: 'community', version: '0.20.0' }),
        ]),
      })
    );
  });
});
