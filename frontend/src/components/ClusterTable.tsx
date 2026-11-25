import React, { useState } from 'react';
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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Sync as SyncIcon,
  DeleteOutline as DeleteIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { Cluster } from '../types/cluster';

interface ClusterTableProps {
  clusters: Cluster[];
  onDeleteCluster: (name: string) => void;
  onSyncCluster?: (name: string) => void;
  onSelectCluster?: (name: string) => void;
  syncingCluster?: string | null;
  emptyMessage?: string;
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

const getStateSyncMeta = (stateStatus: string) => {
  if (stateStatus === 'synced' || stateStatus === 'in_sync') {
    return { label: 'Synced', bg: '#eff6ff', color: '#1d4ed8' };
  }
  if (stateStatus === 'differences_found') {
    return { label: 'Needs Sync', bg: '#fef3c7', color: '#92400e' };
  }
  if (stateStatus === 'missing_local') {
    return { label: 'AWS Only', bg: '#f1f5f9', color: '#334155' };
  }
  if (stateStatus === 'deleted') {
    return { label: 'Deleted', bg: '#fee2e2', color: '#b91c1c' };
  }
  return { label: 'Unknown', bg: '#f1f5f9', color: '#475569' };
};

const ClusterTable: React.FC<ClusterTableProps> = ({
  clusters,
  onDeleteCluster,
  onSyncCluster,
  onSelectCluster,
  syncingCluster,
  emptyMessage,
}) => {
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  const handleConfirmDelete = () => {
    if (!confirmTarget) return;
    const name = confirmTarget;
    setConfirmTarget(null);
    onDeleteCluster(name);
  };

  return (
    <>
      <TableContainer
        tabIndex={0}
        role="region"
        aria-label="Kubernetes clusters inventory"
        sx={{
          overflowX: 'auto',
          maxBlockSize: 540,
          '&:focus-visible': {
            outline: '2px solid #2563eb',
            outlineOffset: '2px',
            borderRadius: 1,
          },
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow
              sx={{
                '& th': {
                  bgcolor: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  fontWeight: 700,
                  color: '#09090b',
                  py: 1.4,
                  whiteSpace: 'nowrap',
                },
              }}
            >
              <TableCell component="th" scope="col">Cluster</TableCell>
              <TableCell component="th" scope="col">AWS Account</TableCell>
              <TableCell component="th" scope="col">Region</TableCell>
              <TableCell component="th" scope="col">K8s Version</TableCell>
              <TableCell component="th" scope="col">AWS Status</TableCell>
              <TableCell component="th" scope="col">State Sync</TableCell>
              <TableCell component="th" scope="col">Created</TableCell>
              <TableCell component="th" scope="col" align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {clusters.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 5, borderBottom: 'none' }}>
                  <Typography variant="body2" color="text.secondary">
                    {emptyMessage ||
                      'No clusters found yet. Connect an AWS account or create a cluster to see live state.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              clusters.map((cluster) => {
                const statusStyle = getStatusStyle(cluster.status, cluster.deletedAt);
                const syncMeta = getStateSyncMeta(cluster.stateStatus);
                const isSyncing = syncingCluster === cluster.name;

                return (
                  <TableRow
                    key={cluster.name}
                    onClick={onSelectCluster ? () => onSelectCluster(cluster.name) : undefined}
                    sx={{
                      opacity: cluster.deletedAt ? 0.72 : 1,
                      backgroundColor: cluster.deletedAt ? 'rgba(0,0,0,0.03)' : 'inherit',
                      cursor: onSelectCluster ? 'pointer' : 'default',
                      transition: 'background-color 0.15s ease',
                      '&:hover': { bgcolor: '#f8fafc' },
                      '&:hover .cluster-name-label': onSelectCluster
                        ? { color: '#2563eb', textDecoration: 'underline' }
                        : undefined,
                      '&:hover .cluster-inspect-chevron': onSelectCluster
                        ? { opacity: 1, transform: 'translateX(2px)', color: '#2563eb' }
                        : undefined,
                    }}
                  >
                    <TableCell component="th" scope="row" sx={{ fontWeight: 700, color: '#09090b', maxWidth: 260 }}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography
                          variant="body2"
                          className="cluster-name-label"
                          sx={{ fontWeight: 700, color: '#09090b', transition: 'color 0.15s ease' }}
                        >
                          {cluster.name}
                        </Typography>
                        {onSelectCluster && (
                          <ChevronRightIcon
                            className="cluster-inspect-chevron"
                            sx={{
                              fontSize: 16,
                              color: '#94a3b8',
                              opacity: 0.75,
                              transition: 'transform 0.15s ease, opacity 0.15s ease, color 0.15s ease',
                            }}
                          />
                        )}
                      </Box>
                      {cluster.endpoint && (
                        <Typography
                          variant="caption"
                          sx={{
                            color: '#64748b',
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={cluster.endpoint}
                        >
                          {cluster.endpoint}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {cluster.accountId}
                    </TableCell>
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
                          fontWeight: 700,
                          fontSize: '0.73rem',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={syncMeta.label}
                        sx={{
                          bgcolor: syncMeta.bg,
                          color: syncMeta.color,
                          fontWeight: 700,
                          fontSize: '0.73rem',
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {new Date(cluster.createdAt).toLocaleDateString()}
                      {cluster.deletedAt && (
                        <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                          (deleted: {new Date(cluster.deletedAt).toLocaleDateString()})
                        </Box>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {!cluster.deletedAt && (
                        <Box
                          sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {onSyncCluster && (
                            <Button
                              variant="outlined"
                              size="small"
                              disabled={isSyncing}
                              aria-label={`Sync ${cluster.name}`}
                              startIcon={isSyncing ? <CircularProgress size={13} /> : <SyncIcon fontSize="small" />}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSyncCluster(cluster.name);
                              }}
                              sx={{
                                borderColor: 'rgba(15, 23, 42, 0.22)',
                                color: '#09090b',
                                fontWeight: 600,
                              }}
                            >
                              {isSyncing ? 'Syncing' : 'Sync'}
                            </Button>
                          )}
                          <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            aria-label={`Delete ${cluster.name}`}
                            startIcon={<DeleteIcon fontSize="small" />}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmTarget(cluster.name);
                            }}
                          >
                            Delete
                          </Button>
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={Boolean(confirmTarget)} onClose={() => setConfirmTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
          Delete EKS Cluster?
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Typography variant="body2" sx={{ color: '#334155' }}>
            This will initiate live AWS EKS cluster deletion for{' '}
            <strong>{confirmTarget}</strong> and record the deletion event in local cluster state.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmTarget(null)} sx={{ color: '#475569' }}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={handleConfirmDelete}>
            Confirm Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ClusterTable;
