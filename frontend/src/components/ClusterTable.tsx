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
} from '@mui/icons-material';
import { Cluster } from '../types/cluster';

interface ClusterTableProps {
  clusters: Cluster[];
  onDeleteCluster: (name: string) => void;
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

const ClusterTable: React.FC<ClusterTableProps> = ({ clusters, onDeleteCluster }) => {
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
            <TableCell>Created</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {clusters.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} align="center" sx={{ py: 5, borderBottom: 'none' }}>
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
                    {new Date(cluster.createdAt).toLocaleDateString()}
                    {cluster.deletedAt && (
                      <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                        (deleted: {new Date(cluster.deletedAt).toLocaleDateString()})
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
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
