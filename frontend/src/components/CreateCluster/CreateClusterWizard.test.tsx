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
  amiType: 'amazon-linux-2023/x86_64/standard',
  amiId: '',
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

    expect(screen.getByLabelText(/Karpenter/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Grafana Stack/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/CSI Snapshot Controller/i)).toBeInTheDocument();
  });

  test('auto-fills recommended AWS SSM AMI ID in Environment Setup, updates on K8s version or AMI type change, and supports manual edit', async () => {
    const fetchMock = jest.fn((url: RequestInfo | URL) => {
      const s = url.toString();
      if (s.includes('/api/aws/eks-versions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            versions: [
              { version: '1.37', status: 'STANDARD_SUPPORT', isLatest: true },
              { version: '1.35', status: 'STANDARD_SUPPORT', isLatest: false },
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
      if (s.includes('/api/aws/eks-ami/162655485574/us-east-1')) {
        const isArm = s.includes('arm64');
        const is135 = s.includes('kubernetes_version=1.35');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            amiId: isArm
              ? 'ami-0arm64recommended'
              : is135
              ? 'ami-0d4c5f36cb9ec8fdf'
              : 'ami-00975b531d8dc8286',
            amiType: isArm ? 'amazon-linux-2023/arm64/standard' : 'amazon-linux-2023/x86_64/standard',
            kubernetesVersion: is135 ? '1.35' : '1.37',
            region: 'us-east-1',
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    });
    global.fetch = fetchMock as any;

    const Wrapper: React.FC = () => {
      const [cfg, setCfg] = React.useState<ClusterConfig>(baseConfig);
      return <ClusterEnvironment config={cfg} onChange={setCfg} />;
    };

    render(<Wrapper />);

    // Open Configure Environment dialog by choosing Production
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Production' }));

    await waitFor(
      () => {
        expect(screen.getByDisplayValue('ami-00975b531d8dc8286')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Switch Kubernetes Version to 1.35 -> AMI updates for 1.35
    fireEvent.mouseDown(screen.getByText(/1\.37 \(Latest\)/i));
    fireEvent.click(screen.getByText('1.35'));

    await waitFor(
      () => {
        expect(screen.getByDisplayValue('ami-0d4c5f36cb9ec8fdf')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Switch AMI Type to ARM64 -> AMI updates for ARM64
    fireEvent.mouseDown(screen.getByText(/Standard x86_64/i));
    fireEvent.click(screen.getByText(/Standard ARM64 \(Graviton\)/i));

    await waitFor(
      () => {
        expect(screen.getByDisplayValue('ami-0arm64recommended')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    const amiInput = screen.getByLabelText(/AMI ID/i);
    fireEvent.change(amiInput, { target: { value: 'ami-custommanual01' } });
    expect(screen.getByDisplayValue('ami-custommanual01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Recommended' })).toBeInTheDocument();

    // Cluster Access, IP Family / Service CIDR, and Prod Deletion Protection
    expect(screen.getByText('Cluster Access')).toBeInTheDocument();
    expect(screen.getByLabelText(/Allow cluster admin access/i)).toBeChecked();
    expect(screen.getByLabelText(/Service IPv4 CIDR \(Optional\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Turn on deletion protection/i)).toBeInTheDocument();
  });

  test('supports compatible AMI instance type dropdown with vCPU/Memory, free-edit Desired Nodes, and excludes selected subnets', async () => {
    const fetchMock = jest.fn((url: RequestInfo | URL) => {
      const s = url.toString();
      if (s.includes('/api/aws/eks-versions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            versions: [{ version: '1.37', status: 'STANDARD_SUPPORT', isLatest: true }],
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
      if (s.includes('/api/aws/subnets/')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'subnet-pub-a', name: 'public-a', cidr: '10.42.128.0/20', availabilityZone: 'us-east-1a', isPublic: true },
            { id: 'subnet-pub-b', name: 'public-b', cidr: '10.42.144.0/20', availabilityZone: 'us-east-1b', isPublic: true },
            { id: 'subnet-priv-a', name: 'private-a', cidr: '10.42.0.0/20', availabilityZone: 'us-east-1a', isPublic: false },
          ],
        } as Response);
      }
      if (s.includes('/api/aws/eks-ami/')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ amiId: 'ami-00975b531d8dc8286', kubernetesVersion: '1.37', region: 'us-east-1' }),
        } as Response);
      }
      if (s.includes('/api/aws/eks-instance-types/')) {
        const isArm = s.includes('arm64');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            region: 'us-east-1',
            source: 'memory-cache',
            instanceTypes: isArm
              ? [
                  { instanceType: 't4g.medium', family: 't4g', vcpus: 2, memoryGiB: 4, currentGeneration: true },
                  { instanceType: 'm7g.large', family: 'm7g', vcpus: 2, memoryGiB: 8, currentGeneration: true },
                ]
              : [
                  { instanceType: 't3.medium', family: 't3', vcpus: 2, memoryGiB: 4, currentGeneration: true },
                  { instanceType: 'm6i.large', family: 'm6i', vcpus: 2, memoryGiB: 8, currentGeneration: true },
                ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    });
    global.fetch = fetchMock as any;

    const Wrapper: React.FC = () => {
      const [cfg, setCfg] = React.useState<ClusterConfig>({
        ...baseConfig,
        desiredNodes: 2,
        minNodes: 1,
        maxNodes: 4,
        environment: { ...baseConfig.environment, kubernetesVersion: '1.37' },
      });
      return <ClusterEnvironment config={cfg} onChange={setCfg} />;
    };

    render(<Wrapper />);

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Non-Production' }));

    // 1. Instance type shows vCPU/Memory details, allows full clearing + prefix search
    const instanceInput = (await screen.findByLabelText(/Instance Type/i)) as HTMLInputElement;
    await waitFor(() => {
      expect(screen.getByText(/2 vCPU · 4 GiB Memory/i)).toBeInTheDocument();
    });
    expect(instanceInput.value).toBe('t3.medium');

    // Clear input completely via backspace/change and verify it stays empty while searching
    fireEvent.focus(instanceInput);
    fireEvent.change(instanceInput, { target: { value: '' } });
    expect(instanceInput.value).toBe('');
    fireEvent.change(instanceInput, { target: { value: 'm6i' } });
    expect(instanceInput.value).toBe('m6i');
    expect(await screen.findByText(/m6i\.large/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/m6i\.large/i));
    expect(instanceInput.value).toBe('m6i.large');

    // 2. Desired Nodes allows Backspace clear ('') and typing '5' without snapping to '1'
    const desiredInput = screen.getByLabelText('Desired Nodes') as HTMLInputElement;
    fireEvent.focus(desiredInput);
    fireEvent.change(desiredInput, { target: { value: '' } });
    expect(desiredInput.value).toBe('');
    fireEvent.change(desiredInput, { target: { value: '5' } });
    fireEvent.blur(desiredInput);
    expect(desiredInput.value).toBe('5');

    // 3. Selecting a public subnet removes it from both Public & Private subnet dropdown lists
    const publicSubnetsInput = screen.getByLabelText(/Public Subnets \(Optional\)/i);
    fireEvent.mouseDown(publicSubnetsInput);
    fireEvent.click(await screen.findByText(/public-a \(subnet-pub-a\)/i));

    fireEvent.mouseDown(publicSubnetsInput);
    expect(screen.queryByRole('option', { name: /public-a \(subnet-pub-a\)/i })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /public-b \(subnet-pub-b\)/i })).toBeInTheDocument();
    fireEvent.keyDown(publicSubnetsInput, { key: 'Escape' });

    const privateSubnetsInput = screen.getByLabelText(/Private Subnets \(Optional\)/i);
    fireEvent.mouseDown(privateSubnetsInput);
    expect(screen.queryByRole('option', { name: /public-a \(subnet-pub-a\)/i })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /private-a \(subnet-priv-a\)/i })).toBeInTheDocument();
  });
});
