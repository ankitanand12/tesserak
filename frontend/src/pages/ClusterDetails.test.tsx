import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ClusterDetails from './ClusterDetails';
import ClusterTable from '../components/ClusterTable';
import { Cluster } from '../types/cluster';
import { clearSwrCache } from '../utils/swrCache';

jest.setTimeout(150000);

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
        isPublic: false,
        availableIpAddressCount: 248,
      },
      {
        subnetId: 'subnet-222bbb',
        name: 'public-a',
        cidrBlock: '10.0.2.0/24',
        availabilityZone: 'us-east-1a',
        mapPublicIpOnLaunch: true,
        isPublic: true,
        availableIpAddressCount: 240,
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
      nodegroupArn: 'arn:aws:eks:us-east-1:162655485574:nodegroup/tesserak/ng-workers/ng-123',
      status: 'ACTIVE',
      instanceTypes: ['t3.medium'],
      amiType: 'AL2023_x86_64_STANDARD',
      capacityType: 'ON_DEMAND',
      diskSize: 20,
      version: '1.34',
      releaseVersion: '1.34.1-20261119',
      nodeRole: 'arn:aws:iam::162655485574:role/tesserak-node-role',
      scalingConfig: { minSize: 1, desiredSize: 2, maxSize: 4 },
      subnets: ['subnet-111aaa', 'subnet-222bbb'],
      resources: { autoScalingGroups: [{ name: 'eks-ng-workers-asg-1' }] },
      labels: { workload: 'general' },
      taints: [{ key: 'dedicated', value: 'gpu', effect: 'NO_SCHEDULE' }],
      updateConfig: { maxUnavailable: 1, updateStrategy: 'DEFAULT' },
      tags: { ManagedBy: 'Tesserak' },
      updateHistory: [{ id: 'ng-upd-1', type: 'VersionUpdate', status: 'Successful', createdAt: '2026-11-25T13:05:00Z' }],
    },
  ],
  workerNodes: [
    {
      instanceId: 'i-0worker123456',
      name: 'tesserak-ng-node-1',
      nodeName: 'ip-10-0-1-42.ec2.internal',
      nodegroupName: 'ng-workers',
      instanceType: 't3.medium',
      capacityType: 'ON_DEMAND',
      availabilityZone: 'us-east-1a',
      subnetId: 'subnet-111aaa',
      amiId: 'ami-0134recommended',
      architecture: 'amd64',
      operatingSystem: 'linux',
      osImage: 'Amazon Linux 2023.10',
      kernelVersion: '6.12.115-140.210.amzn2023.x86_64',
      containerRuntimeVersion: 'containerd://2.1.7',
      kubeletVersion: 'v1.34.1-eks',
      privateIpAddress: '10.0.1.42',
      state: 'running',
      k8sStatus: 'Ready',
      createdAt: '2026-11-25T13:02:00Z',
      allocation: {
        cpu: {
          capacityMillicores: 2000,
          allocatableMillicores: 1930,
          systemReservedMillicores: 70,
          workloadReservedMillicores: 250,
          availableMillicores: 1680,
        },
        memory: {
          capacityBytes: 4294967296,
          allocatableBytes: 3758096384,
          systemReservedBytes: 536870912,
          workloadReservedBytes: 268435456,
          availableBytes: 3489660928,
        },
        pods: { max: 17, used: 1, available: 16 },
        ephemeralStorage: {
          capacityBytes: 21474836480,
          allocatableBytes: 19327352832,
          systemReservedBytes: 2147483648,
          availableBytes: 19327352832,
        },
      },
      conditions: [
        { type: 'Ready', status: 'True', message: 'kubelet is posting ready status' },
      ],
      taints: [],
      labels: { 'kubernetes.io/hostname': 'ip-10-0-1-42.ec2.internal' },
      annotations: { 'node.alpha.kubernetes.io/ttl': '0' },
      rawNode: { kind: 'Node', metadata: { name: 'ip-10-0-1-42.ec2.internal' } },
    },
  ],
  pods: [
    {
      name: 'demo-app-pod-1',
      namespace: 'default',
      status: 'Running',
      phase: 'Running',
      ready: '1/1',
      restarts: 0,
      podIp: '10.0.1.88',
      hostIp: '10.0.1.42',
      nodeName: 'ip-10-0-1-42.ec2.internal',
      createdAt: '2026-11-25T13:10:00Z',
      lastTransitionTime: '2026-11-25T13:10:30Z',
      controlledBy: [{ kind: 'ReplicaSet', name: 'demo-app-rs-abc' }],
      qosClass: 'Burstable',
      serviceAccountName: 'default',
      conditions: [{ type: 'Ready', status: 'True', lastTransitionTime: '2026-11-25T13:10:30Z' }],
      containers: [
        {
          name: 'demo-app',
          image: 'nginx:1.26.1',
          ready: true,
          started: true,
          restartCount: 0,
          state: { status: 'Running', startedAt: '2026-11-25T13:10:25Z' },
          ports: [{ containerPort: 80, protocol: 'TCP' }],
        },
      ],
      raw: { kind: 'Pod', metadata: { name: 'demo-app-pod-1', namespace: 'default' } },
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
  communityAddons: [
    {
      id: 'ingress-nginx',
      name: 'Ingress NGINX',
      releaseName: 'ingress-nginx',
      namespace: 'ingress-nginx',
      chart: 'ingress-nginx',
      version: '4.12.1',
      requestedVersion: '4.12.1',
      status: 'NOT_INSTALLED',
      source: 'requested',
      details: 'Selected during setup; click Install via Helm to deploy onto cluster.',
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
      if (url.includes('/api/aws/eks-ami/162655485574/us-east-1')) {
        return {
          ok: true,
          json: async () => ({ amiId: 'ami-0134recommended', kubernetesVersion: '1.34' }),
        } as Response;
      }
      if (url.endsWith('/clusters/tesserak/nodegroups') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ nodegroupName: 'tesserak-ng', status: 'CREATING' }),
        } as Response;
      }
      if (url.endsWith('/clusters/tesserak/nodegroups/ng-workers') && init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ id: 'upd-scale-1', status: 'InProgress' }),
        } as Response;
      }
      if (url.endsWith('/clusters/tesserak/nodegroups/ng-workers') && init?.method === 'DELETE') {
        return {
          ok: true,
          json: async () => ({ nodegroupName: 'ng-workers', status: 'DELETING' }),
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

    // Compute & Add-ons tab (tab 1): Nodes table hides Instance ID column like AWS Console
    fireEvent.click(screen.getByRole('tab', { name: /Compute & Add-ons/i }));
    expect(screen.getAllByText('ng-workers').length).toBeGreaterThan(0);
    expect(screen.queryByText('i-0worker123456')).not.toBeInTheDocument();
    expect(screen.getAllByText('demo-app-pod-1').length).toBeGreaterThan(0);
    expect(screen.getByText('10.0.1.88')).toBeInTheDocument();
    expect(screen.getByText('vpc-cni')).toBeInTheDocument();
    expect(screen.getByText('v1.22.4-eksbuild.14')).toBeInTheDocument();

    // Add Node Group dialog
    fireEvent.click(screen.getByRole('button', { name: 'Add Node Group' }));
    await waitFor(
      () => {
        expect(screen.getByDisplayValue('ami-0134recommended')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Node Group' }));
    await waitFor(
      () => {
        expect(screen.getByText('Node group "tesserak-ng" creation initiated on AWS EKS.')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      },
      { timeout: 10000 }
    );

    // Scale Node Group dialog
    fireEvent.click(await screen.findByRole('button', { name: 'Scale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply Scaling' }));
    await waitFor(
      () => {
        expect(screen.getByText('Scaling update started for node group "ng-workers".')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      },
      { timeout: 10000 }
    );

    // Delete Node Group dialog
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Delete' }));
    await waitFor(
      () => {
        expect(screen.getByText('Node group "ng-workers" deletion initiated.')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      },
      { timeout: 10000 }
    );

    // Networking tab (tab 2)
    fireEvent.click(await screen.findByRole('tab', { name: /Networking/i }));
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

  test('opens clickable Node Inspector with Instance ID, 10 pods per page pagination, and Raw JSON view', async () => {
    const paginatedDetail = {
      ...sampleClusterDetail,
      pods: [
        ...sampleClusterDetail.pods,
        ...Array.from({ length: 14 }, (_, idx) => ({
          name: `worker-pod-${idx + 2}`,
          namespace: 'kube-system',
          status: 'Running',
          phase: 'Running',
          ready: '1/1',
          restarts: 0,
          podIp: `10.0.1.${100 + idx}`,
          nodeName: 'ip-10-0-1-42.ec2.internal',
          createdAt: '2026-11-25T13:09:00Z',
        })),
      ],
    };
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => paginatedDetail,
    })) as any;

    render(<ClusterDetails />);

    fireEvent.click(await screen.findByRole('tab', { name: /Compute & Add-ons/i }));
    const nodeButtons = screen.getAllByRole('button', { name: 'ip-10-0-1-42.ec2.internal' });
    fireEvent.click(nodeButtons[0]);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('6.12.115-140.210.amzn2023.x86_64')).toBeInTheDocument();
    expect(within(dialog).getByText('i-0worker123456')).toBeInTheDocument();
    expect(within(dialog).getByText('Capacity allocation')).toBeInTheDocument();
    expect(within(dialog).getByText('Pods on Node (15)')).toBeInTheDocument();
    expect(within(dialog).getByText('1–10 of 15')).toBeInTheDocument();
    expect(within(dialog).queryByText('worker-pod-15')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Pods page 2' }));
    expect(within(dialog).getByText('11–15 of 15')).toBeInTheDocument();
    expect(within(dialog).getByText('worker-pod-15')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Raw view' }));
    expect(within(dialog).getByText(/RAW KUBERNETES NODE/i)).toBeInTheDocument();
  });

  const createNodeGroupAndPodFetchMock = () =>
    jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/aws/eks-ami/162655485574/us-east-1')) {
        return {
          ok: true,
          json: async () => ({ amiId: 'ami-0134recommended', kubernetesVersion: '1.34' }),
        } as Response;
      }
      if (url.includes('/pods/default/demo-app-pod-1/restart') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            status: 'restarting',
            message: 'Pod "demo-app-pod-1" in namespace "default" restart triggered.',
          }),
        } as Response;
      }
      if (url.includes('/community-addons') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'ingress-nginx',
            name: 'Ingress NGINX',
            namespace: 'ingress-nginx',
            status: 'installed',
          }),
        } as Response;
      }
      if (url.includes('/pods/default/demo-app-pod-1/events')) {
        return {
          ok: true,
          json: async () => ({
            events: [
              {
                type: 'Warning',
                reason: 'BackOff',
                count: 2,
                source: 'kubelet',
                message: 'Back-off restarting failed container',
                lastSeen: '2026-11-25T13:12:00Z',
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/pods/default/demo-app-pod-1') && init?.method === 'DELETE') {
        return {
          ok: true,
          json: async () => ({
            status: 'deleting',
            message: 'Pod "demo-app-pod-1" in namespace "default" deletion requested.',
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => sampleClusterDetail,
      } as Response;
    });

  test('displays Public/Private subnet labels when adding nodegroup and opens Node Group details', async () => {
    global.fetch = createNodeGroupAndPodFetchMock() as any;

    render(<ClusterDetails />);
    fireEvent.click(await screen.findByRole('tab', { name: /Compute & Add-ons/i }));

    // 1. Add Node Group dialog labels Public/Private worker subnets clearly
    fireEvent.click(screen.getByRole('button', { name: 'Add Node Group' }));
    const ngDialog = await screen.findByRole('dialog');
    expect(within(ngDialog).getByText('private-a (subnet-111aaa) · Private')).toBeInTheDocument();
    expect(within(ngDialog).getByText('public-a (subnet-222bbb) · Public')).toBeInTheDocument();
    fireEvent.click(within(ngDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 10000 });

    // 2. Clickable Node Group details modal with AWS EKS tabs
    fireEvent.click(screen.getByRole('button', { name: 'ng-workers' }));
    const ngDetails = await screen.findByRole('dialog');
    expect(within(ngDetails).getByText('Node group configuration')).toBeInTheDocument();
    expect(
      within(ngDetails).getByText('arn:aws:eks:us-east-1:162655485574:nodegroup/tesserak/ng-workers/ng-123')
    ).toBeInTheDocument();
    expect(within(ngDetails).getByText('Private')).toBeInTheDocument();
    expect(within(ngDetails).getByText('Public')).toBeInTheDocument();

    fireEvent.click(within(ngDetails).getByRole('tab', { name: /Kubernetes labels/i }));
    expect(within(ngDetails).getByText('workload')).toBeInTheDocument();
    fireEvent.click(within(ngDetails).getByRole('tab', { name: /Kubernetes taints/i }));
    expect(within(ngDetails).getByText('dedicated')).toBeInTheDocument();
    fireEvent.click(within(ngDetails).getByRole('tab', { name: /Update history/i }));
    expect(within(ngDetails).getByText('ng-upd-1')).toBeInTheDocument();
    fireEvent.click(within(ngDetails).getByRole('tab', { name: /Tags/i }));
    expect(within(ngDetails).getByText('ManagedBy')).toBeInTheDocument();
    fireEvent.click(within(ngDetails).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 10000 });
  });

  test('opens Pod details modal with live events, raw view, Restart/Delete and installs Community Add-on', async () => {
    global.fetch = createNodeGroupAndPodFetchMock() as any;

    render(<ClusterDetails />);
    fireEvent.click(await screen.findByRole('tab', { name: /Compute & Add-ons/i }));

    // 3. Clickable Pod details modal with containers, live events, raw view, Restart & Delete actions
    fireEvent.click(screen.getByRole('button', { name: 'demo-app-pod-1' }));
    const podDetails = await screen.findByRole('dialog');
    expect(within(podDetails).getByText('ReplicaSet/demo-app-rs-abc')).toBeInTheDocument();
    expect(within(podDetails).getByText('Containers (1)')).toBeInTheDocument();
    expect(within(podDetails).getByText('nginx:1.26.1')).toBeInTheDocument();
    expect(await within(podDetails).findByText('BackOff', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(podDetails).getByText('Back-off restarting failed container')).toBeInTheDocument();

    fireEvent.click(within(podDetails).getByRole('button', { name: 'Raw view' }));
    expect(within(podDetails).getByText(/RAW KUBERNETES POD MANIFEST/i)).toBeInTheDocument();
    fireEvent.click(within(podDetails).getByRole('button', { name: 'Structured view' }));

    // Trigger Restart Pod with confirmation
    fireEvent.click(within(podDetails).getByRole('button', { name: 'Restart Pod' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Restart Pod' }, { timeout: 5000 }));
    expect(
      await screen.findByText('Pod "demo-app-pod-1" in namespace "default" restart triggered.', {}, { timeout: 10000 })
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 10000 });

    // Trigger Delete Pod from table row with confirmation
    fireEvent.click(screen.getByRole('button', { name: 'Delete pod demo-app-pod-1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Delete Pod' }, { timeout: 5000 }));
    expect(
      await screen.findByText('Pod "demo-app-pod-1" in namespace "default" deletion requested.', {}, { timeout: 10000 })
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 10000 });

    // 4. Community / Helm Add-ons section renders requested Ingress NGINX & allows Helm install
    expect(screen.getByText('Community / Helm Add-ons (1)')).toBeInTheDocument();
    expect(screen.getByText('Ingress NGINX')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install via Helm' }));
    expect(
      await screen.findByText(
        'Installed community add-on "Ingress NGINX" via Helm in namespace "ingress-nginx".',
        {},
        { timeout: 10000 }
      )
    ).toBeInTheDocument();
  });

  const setupMultiAddonTest = (holdConcurrentInstalls: boolean = false) => {
    let resolveFirstInstall: ((value: Response) => void) | null = null;
    let resolveSecondInstall: ((value: Response) => void) | null = null;
    const postedBodies: Array<{ addonId: string; valuesYaml?: string }> = [];

    const multiAddonDetail = {
      ...sampleClusterDetail,
      communityAddons: [
        {
          id: 'ingress-nginx',
          name: 'Ingress NGINX',
          releaseName: 'ingress-nginx',
          namespace: 'ingress-nginx',
          chart: 'ingress-nginx',
          version: '4.12.1',
          status: 'NOT_INSTALLED',
          details: 'Ready to install.',
        },
        {
          id: 'metrics-server',
          name: 'Metrics Server',
          releaseName: 'metrics-server',
          namespace: 'kube-system',
          chart: 'metrics-server',
          version: '3.12.2',
          status: 'NOT_INSTALLED',
          details: 'Ready to install.',
        },
        {
          id: 'argo-cd',
          name: 'Argo CD',
          releaseName: 'argocd',
          namespace: 'argocd',
          chart: 'argo-cd',
          version: '7.8.0',
          status: 'DEPLOYED',
          details: 'Release "argocd" has been upgraded.',
          logs: '$ helm upgrade --install argocd argo/argo-cd -n argocd\nRelease "argocd" deployed.',
          notes: 'Argo CD installed successfully.',
          presetValuesYaml: 'server:\n  ingress:\n    enabled: true\n',
          accessHints: ['Configure server.ingress.hosts in custom values.yaml for your domain.'],
        },
      ],
    };

    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/community-addons/argo-cd/details')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'argo-cd',
            releaseName: 'argocd',
            namespace: 'argocd',
            helmStatus: { status: 'deployed', last_deployed: '2026-11-27T15:00:00Z' },
            notes: 'Argo CD installed successfully.',
            presetValuesYaml: 'server:\n  ingress:\n    enabled: true\n',
            accessHints: ['Configure server.ingress.hosts in custom values.yaml for your domain.'],
            logs: '$ helm upgrade --install argocd argo/argo-cd -n argocd\nRelease "argocd" deployed.',
            resources: {
              pods: [],
              services: [
                {
                  name: 'argocd-server',
                  type: 'LoadBalancer',
                  clusterIP: '10.100.1.10',
                  externalEndpoints: ['a123.elb.us-east-1.amazonaws.com'],
                  ports: ['443/TCP'],
                },
              ],
              ingresses: [],
            },
            events: [
              {
                type: 'Normal',
                reason: 'Scheduled',
                involvedKind: 'Pod',
                involvedName: 'argocd-server-0',
                message: 'Successfully assigned argocd/argocd-server-0',
                lastSeen: '2026-11-27T15:00:00Z',
              },
            ],
          }),
        } as Response);
      }
      if (url.includes('/community-addons/argo-cd') && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'uninstalled', id: 'argo-cd' }),
        } as Response);
      }
      if (url.includes('/community-addons') && init?.method === 'POST') {
        const parsed = JSON.parse(String(init.body || '{}'));
        postedBodies.push(parsed);
        if (holdConcurrentInstalls && parsed.addonId === 'ingress-nginx' && !resolveFirstInstall) {
          return new Promise<Response>((resolve) => {
            resolveFirstInstall = resolve;
          });
        }
        if (holdConcurrentInstalls && parsed.addonId === 'metrics-server' && !resolveSecondInstall) {
          return new Promise<Response>((resolve) => {
            resolveSecondInstall = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: parsed.addonId, namespace: 'argocd', status: 'installed' }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => multiAddonDetail,
      } as Response);
    });
    global.fetch = fetchMock as any;

    return {
      postedBodies,
      resolveFirst: (resp: Response) => resolveFirstInstall?.(resp),
      resolveSecond: (resp: Response) => resolveSecondInstall?.(resp),
    };
  };

  test('tracks concurrent Helm install loading per add-on independently', async () => {
    const ctx = setupMultiAddonTest(true);

    render(<ClusterDetails />);
    fireEvent.click(await screen.findByRole('tab', { name: /Compute & Add-ons/i }));

    // Clicking second add-on must keep first button in disabled "Installing..." state
    const installButtons = screen.getAllByRole('button', { name: 'Install via Helm' });
    expect(installButtons).toHaveLength(2);
    fireEvent.click(installButtons[0]);
    fireEvent.click(installButtons[1]);

    await waitFor(
      () => {
        const installingBtns = screen.getAllByRole('button', { name: 'Installing...' });
        expect(installingBtns).toHaveLength(2);
        expect(installingBtns[0]).toBeDisabled();
        expect(installingBtns[1]).toBeDisabled();
      },
      { timeout: 10000 }
    );

    ctx.resolveFirst({
      ok: true,
      json: async () => ({ id: 'ingress-nginx', namespace: 'ingress-nginx', status: 'installed' }),
    } as Response);
    ctx.resolveSecond({
      ok: true,
      json: async () => ({ id: 'metrics-server', namespace: 'kube-system', status: 'installed' }),
    } as Response);
    await waitFor(
      () => expect(screen.queryByRole('button', { name: 'Installing...' })).not.toBeInTheDocument(),
      { timeout: 10000 }
    );
  });

  test('opens AWS & Community add-on details modals with logs, events, domain hints, custom values, and uninstall', async () => {
    const ctx = setupMultiAddonTest(false);

    render(<ClusterDetails />);
    fireEvent.click(await screen.findByRole('tab', { name: /Compute & Add-ons/i }));

    // 1. Click AWS Add-on name to inspect AWS Add-on Details modal
    fireEvent.click(screen.getByRole('button', { name: 'vpc-cni' }));
    const awsAddonModal = await screen.findByRole('dialog');
    expect(within(awsAddonModal).getByRole('tab', { name: 'Details & Configuration' })).toBeInTheDocument();
    expect(within(awsAddonModal).getAllByText('v1.22.4-eksbuild.14').length).toBeGreaterThan(0);
    fireEvent.click(within(awsAddonModal).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 10000 });

    // 2. Click Community Add-on (Argo CD) to inspect logs, events, domain/access guide, custom values & uninstall
    fireEvent.click(screen.getByRole('button', { name: 'Argo CD' }));
    const helmModal = await screen.findByRole('dialog');
    expect(await within(helmModal).findByText('Domain & Access Guide', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(within(helmModal).getByText('a123.elb.us-east-1.amazonaws.com')).toBeInTheDocument();

    fireEvent.click(within(helmModal).getByRole('tab', { name: /Install Logs & Events/i }));
    expect(within(helmModal).getByText(/helm upgrade --install argocd/i)).toBeInTheDocument();
    expect(within(helmModal).getByText('Scheduled')).toBeInTheDocument();

    fireEvent.click(within(helmModal).getByRole('tab', { name: /Custom Values/i }));
    fireEvent.click(within(helmModal).getByRole('button', { name: 'Load Preset / Domain Template' }));
    fireEvent.click(within(helmModal).getByRole('button', { name: 'Upgrade with Custom Values' }));
    await waitFor(
      () =>
        expect(
          ctx.postedBodies.some((b) => b.addonId === 'argo-cd' && (b.valuesYaml || '').includes('enabled: true'))
        ).toBe(true),
      { timeout: 10000 }
    );

    // Uninstall flow uses ConfirmDeleteDialog
    const uninstallBtn = within(helmModal).getByRole('button', { name: 'Uninstall' });
    await waitFor(() => expect(uninstallBtn).not.toBeDisabled(), { timeout: 10000 });
    fireEvent.click(uninstallBtn);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Uninstall' }, { timeout: 5000 }));
    expect(
      await screen.findByText('Uninstalled community add-on "Argo CD" via Helm.', {}, { timeout: 10000 })
    ).toBeInTheDocument();
  });
});
