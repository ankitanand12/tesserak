export interface Cluster {
    name: string;
    status: string;
    accountId: string;
    region: string;
    version: string;
    endpoint: string | null;
    stateStatus: 'synced' | 'in_sync' | 'differences_found' | 'missing_local' | 'unknown' | 'deleted';
    createdAt: string;
    deletedAt?: string | null;
    deletedBy?: 'aws-console' | 'tool' | null;
}

export interface ClusterState {
    status: string;
    differences: string[];
    needsSync: boolean;
}

export interface CreateClusterForm {
    name: string;
    region: string;
    nodeGroupName: string;
    instanceType: string;
    desiredNodes: number;
    minNodes: number;
    maxNodes: number;
}
