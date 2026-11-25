import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClusterDetails from './ClusterDetails';
import ClusterTable from '../components/ClusterTable';
import { Cluster } from '../types/cluster';
import { clearSwrCache } from '../utils/swrCache';

const mockNavigate = jest.fn();

jest.mock(
  'react-router-dom',
  () => ({
    useNavigate: () => mockNavigate,
    useParams: () => ({ clusterName: 'tesserak' }),
  }),
  { virtual: true }
);

jest.mock('../auth/AuthContext', () => ({
  useTesserakAuth: () => ({
    userEmail: 'test@tesserak.dev',
  }),
}));

const sampleClusterDetail = {
  name: 'tesserak',
  accountId: '162655485574',
  region: 'us-east-1',
  status: 'ACTIVE',
  stateStatus: 'synced',
  awsMissing: false,
  cluster: {
    name: 'tesserak',
    arn: 'arn:aws:eks:us-east-1:162655485574:cluster/tesserak',
    createdAt: '2026-11-25T13:00:00Z',
    version: '1.34',
    platformVersion: 'eks.5',
    endpoint: 'https://ABCDEF123456.gr7.us-east-1.eks.amazonaws.com',
    roleArn: 'arn:aws:iam::162655485574:role/tesserak-eks-role',
    status: 'ACTIVE',
    certificateAuthority: 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t',
    oidcIssuer: 'https://oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B716D3041E',
    logging: [
      { types: ['api', 'audit'], enabled: true },
      { types: ['scheduler'], enabled: false },
    ],
    encryptionConfig: [
      {
        resources: ['secrets'],
        provider: { keyArn: 'arn:aws:kms:us-east-1:162655485574:key/kms-123' },
      },
    ],
    accessConfig: {
      authenticationMode: 'API_AND_CONFIG_MAP',
      bootstrapClusterCreatorAdminPermissions: true,
    },
    upgradePolicy: { supportType: 'STANDARD' },
    health: { issues: [] },
  },
  networking: {
    vpc: {
      vpcId: 'vpc-0d8a17ab04fc40a71',
      name: 'tesserak-vpc',
      cidrBlock: '10.0.0.0/16',
      isDefault: false,
    },
    subnets: [
      {
        subnetId: 'subnet-111aaa',
        name: 'private-a',
        cidrBlock: '10.0.1.0/24',
        availabilityZone: 'us-east-1a',
        mapPublicIpOnLaunch: false,
        availableIpAddressCount: 248,
      },
    ],
    securityGroups: [
      {
        groupId: 'sg-0cluster123',
        groupName: 'eks-cluster-sg-tesserak',
        description: 'EKS created security group',
        isClusterSecurityGroup: true,
      },
    ],
    clusterSecurityGroupId: 'sg-0cluster123',
    endpointPublicAccess: true,
    endpointPrivateAccess: true,
    publicAccessCidrs: ['0.0.0.0/0'],
    kubernetesNetworkConfig: {
      serviceIpv4Cidr: '10.100.0.0/16',
      ipFamily: 'ipv4',
    },
  },
  nodegroups: [
    {
      nodegroupName: 'ng-workers',
      status: 'ACTIVE',
      instanceTypes: ['t3.medium'],
      amiType: 'AL2023_x86_64_STANDARD',
      capacityType: 'ON_DEMAND',
      diskSize: 20,
      version: '1.34',
      scalingConfig: { minSize: 1, desiredSize: 2, maxSize: 4 },
      subnets: ['subnet-111aaa'],
    },
  ],
  fargateProfiles: [],
  addons: [
    {
      addonName: 'vpc-cni',
      addonVersion: 'v1.22.4-eksbuild.14',
      status: 'ACTIVE',
      health: { issues: [] },
    },
  ],
  updateHistory: [
    {
      id: 'upd-12345',
      type: 'VersionUpdate',
      status: 'Successful',
      createdAt: '2026-11-25T13:15:00Z',
    },
  ],
  localState: {
    lastUpdated: '2026-11-25T13:20:00Z',
    history: [
      { timestamp: '2026-11-25T13:01:00Z', type: 'cluster_created', details: {} },
    ],
    differences: [],
  },
  tags: {
    env: 'non-prod',
    owner: 'platform',
  },
};

describe('ClusterTable clickable navigation', () => {
  const sampleRows: Cluster[] = [
    {
      name: 'tesserak',
      accountId: '162655485574',
      region: 'us-east-1',
      status: 'ACTIVE',
      version: '1.34',
      endpoint: 'https://eks.example.com',
      stateStatus: 'synced',
      createdAt: '2026-11-25T13:00:00Z',
    },
  ];

  test('clicking row invokes onSelectCluster while Sync and Delete stop propagation', () => {
    const onSelect = jest.fn();
    const onSync = jest.fn();
    const onDelete = jest.fn();

    render(
      <ClusterTable
        clusters={sampleRows}
        onSelectCluster={onSelect}
        onSyncCluster={onSync}
        onDeleteCluster={onDelete}
      />
    );

    fireEvent.click(screen.getByLabelText('Sync tesserak'));
    expect(onSync).toHaveBeenCalledWith('tesserak');
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Delete tesserak'));
    expect(screen.getByText('Delete EKS Cluster?')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByText('tesserak'));
    expect(onSelect).toHaveBeenCalledWith('tesserak');
  });
});

describe('ClusterDetails page', () => {
  beforeEach(() => {
    clearSwrCache();
    mockNavigate.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders AWS EKS control plane, compute, networking, observability, history, and tags tabs', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/clusters/tesserak/sync') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ message: 'Cluster synced' }),
        } as Response;
      }
      if (url.endsWith('/clusters/tesserak')) {
        return {
          ok: true,
          json: async () => sampleClusterDetail,
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({ detail: `Unexpected URL ${url}` }),
      } as Response;
    });
    global.fetch = fetchMock as any;

    render(<ClusterDetails />);

    // Overview & Config tab (default tab 0)
    await waitFor(() => {
      expect(screen.getByText('arn:aws:eks:us-east-1:162655485574:cluster/tesserak')).toBeInTheDocument();
    });
    expect(screen.getByText('State Synced')).toBeInTheDocument();
    expect(screen.getByText('https://ABCDEF123456.gr7.us-east-1.eks.amazonaws.com')).toBeInTheDocument();

    // Compute & Add-ons tab (tab 1)
    fireEvent.click(screen.getByRole('tab', { name: /Compute & Add-ons/i }));
    expect(screen.getByText('ng-workers')).toBeInTheDocument();
    expect(screen.getByText('vpc-cni')).toBeInTheDocument();
    expect(screen.getByText('v1.22.4-eksbuild.14')).toBeInTheDocument();

    // Networking tab (tab 2)
    fireEvent.click(screen.getByRole('tab', { name: /Networking/i }));
    expect(screen.getByText('tesserak-vpc (vpc-0d8a17ab04fc40a71)')).toBeInTheDocument();
    expect(screen.getByText('sg-0cluster123')).toBeInTheDocument();
    expect(screen.getByText('10.100.0.0/16 (ipv4)')).toBeInTheDocument();

    // Observability & Access tab (tab 3)
    fireEvent.click(screen.getByRole('tab', { name: /Observability & Access/i }));
    expect(screen.getByText('api: Enabled')).toBeInTheDocument();
    expect(screen.getByText('API_AND_CONFIG_MAP')).toBeInTheDocument();
    expect(
      screen.getByText('https://oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B716D3041E')
    ).toBeInTheDocument();

    // Update & State History tab (tab 4)
    fireEvent.click(screen.getByRole('tab', { name: /Update & State History/i }));
    expect(screen.getByText('VersionUpdate')).toBeInTheDocument();
    expect(screen.getByText('cluster_created')).toBeInTheDocument();

    // Tags tab (tab 5)
    fireEvent.click(screen.getByRole('tab', { name: /Tags/i }));
    expect(screen.getByText('env')).toBeInTheDocument();
    expect(screen.getByText('non-prod')).toBeInTheDocument();

    // Sync AWS State button triggers POST /clusters/tesserak/sync and shows confirmation banner
    fireEvent.click(screen.getByRole('button', { name: 'Sync AWS State' }));
    await waitFor(() => {
      expect(screen.getByText('Synchronized "tesserak" with live AWS EKS state.')).toBeInTheDocument();
    });
  });
});
