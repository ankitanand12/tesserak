import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Box,
  Chip,
  CircularProgress,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { Cluster } from '../types/cluster';

interface ClusterTableProps {
  clusters: Cluster[];
  onDeleteCluster: (name: string) => void;
  onSyncCluster?: (name: string) => void;
  syncingCluster?: string | null;
}

const getStatusStyle = (status: string, deletedAt?: string | null) => {
  if (deletedAt || status === 'NOT_AVAILABLE' || status === 'FAILED') {
    return { bg: '#fee2e2', color: '#dc2626' };
  }
  if (status === 'ACTIVE') {
    return { bg: '#dcfce7', color: '#16a34a' };
  }
  return { bg: '#fef3c7', color: '#d97706' };
};

const getStateSyncBadge = (stateStatus: string) => {
  if (stateStatus === 'synced' || stateStatus === 'in_sync') {
    return { label: 'Synced', bg: '#eff6ff', color: '#1d4ed8' };
  }
  if (stateStatus === 'differences_found') {
    return { label: 'Needs Sync', bg: '#fef3c7', color: '#b45309' };
  }
  if (stateStatus === 'missing_local') {
    return { label: 'AWS Live (Unsynced)', bg: '#eff6ff', color: '#09090b' };
  }
  if (stateStatus === 'deleted') {
    return { label: 'Deleted', bg: '#fee2e2', color: '#dc2626' };
  }
  return { label: stateStatus || 'Unknown', bg: '#f1f5f9', color: '#475569' };
};

const ClusterTable: React.FC<ClusterTableProps> = ({
  clusters,
  onDeleteCluster,
  onSyncCluster,
  syncingCluster,
}) => {
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow
            sx={{
              bgcolor: '#f8fafc',
              '& th': {
                borderBottom: '1px solid #e2e8f0',
                fontWeight: 600,
                color: 'text.secondary',
                py: 1.4,
              },
            }}
          >
            <TableCell>Name</TableCell>
            <TableCell>AWS Account</TableCell>
            <TableCell>Region</TableCell>
            <TableCell>K8s Version</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>State Sync</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {clusters.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} align="center" sx={{ py: 5, borderBottom: 'none' }}>
                <Typography variant="body2" color="text.secondary">
                  No clusters found yet. Connect an AWS account or create a cluster to see live state.
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            clusters.map((cluster) => {
              const statusStyle = getStatusStyle(cluster.status, cluster.deletedAt);
              return (
                <TableRow
                  key={cluster.name}
                  sx={{
                    opacity: cluster.deletedAt ? 0.7 : 1,
                    backgroundColor: cluster.deletedAt ? 'rgba(0,0,0,0.03)' : 'inherit',
                    transition: 'background-color 0.15s ease',
                    '&:hover': { bgcolor: '#f8fafc' },
                  }}
                >
                  <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
                    {cluster.name}
                  </TableCell>
                  <TableCell>{cluster.accountId}</TableCell>
                  <TableCell>{cluster.region}</TableCell>
                  <TableCell>{cluster.version}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      icon={
                        cluster.deletedAt ? (
                          <Tooltip
                            title={`Deleted ${
                              cluster.deletedBy === 'aws-console'
                                ? 'from AWS Console'
                                : 'using this tool'
                            }`}
                          >
                            <ErrorIcon sx={{ fontSize: 16, color: `${statusStyle.color} !important` }} />
                          </Tooltip>
                        ) : cluster.status === 'ACTIVE' ? (
                          <CheckCircleIcon sx={{ fontSize: 16, color: `${statusStyle.color} !important` }} />
                        ) : cluster.status === 'CREATING' ? (
                          <CircularProgress size={14} />
                        ) : cluster.status === 'NOT_AVAILABLE' || cluster.status === 'FAILED' ? (
                          <ErrorIcon sx={{ fontSize: 16, color: `${statusStyle.color} !important` }} />
                        ) : (
                          <WarningIcon sx={{ fontSize: 16, color: `${statusStyle.color} !important` }} />
                        )
                      }
                      label={cluster.status}
                      sx={{
                        bgcolor: statusStyle.bg,
                        color: statusStyle.color,
                        fontWeight: 600,
                        fontSize: '0.75rem',
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const syncBadge = getStateSyncBadge(cluster.stateStatus);
                      return (
                        <Chip
                          size="small"
                          label={syncBadge.label}
                          sx={{
                            bgcolor: syncBadge.bg,
                            color: syncBadge.color,
                            fontWeight: 700,
                            fontSize: '0.72rem',
                          }}
                        />
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {new Date(cluster.createdAt).toLocaleDateString()}
                    {cluster.deletedAt && (
                      <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                        (deleted: {new Date(cluster.deletedAt).toLocaleDateString()})
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {!cluster.deletedAt &&
                        onSyncCluster &&
                        cluster.stateStatus !== 'synced' &&
                        cluster.stateStatus !== 'in_sync' && (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={
                              syncingCluster === cluster.name ? (
                                <CircularProgress size={12} />
                              ) : (
                                <SyncIcon fontSize="small" />
                              )
                            }
                            disabled={syncingCluster === cluster.name}
                            onClick={() => onSyncCluster(cluster.name)}
                            sx={{ borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 }}
                          >
                            Sync
                          </Button>
                        )}
                      {!cluster.deletedAt && (
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={() => onDeleteCluster(cluster.name)}
                        >
                          Delete
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default ClusterTable;
