import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CloudIcon from '@mui/icons-material/Cloud';
import { useTesserakAuth } from '../../auth/AuthContext';
import Perspective3DCard from '../Perspective3DCard';

export interface Connector {
  id: string;
  accountName: string;
  type: 'aws';
  status: 'connected' | 'disconnected' | 'error';
  createdAt: string;
  createdBy: string;
  lastUpdated: string;
  accountId?: string;
}

interface ConnectorListProps {
  connectors: Connector[];
  onDelete?: (id: string) => void;
  onStatusUpdate?: (updatedConnectors: Connector[]) => void;
}

const ConnectorList: React.FC<ConnectorListProps> = ({
  connectors,
  onDelete,
  onStatusUpdate,
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || '';
  const connectorsRef = useRef(connectors);
  connectorsRef.current = connectors;
  const onStatusUpdateRef = useRef(onStatusUpdate);
  onStatusUpdateRef.current = onStatusUpdate;
  const connectorIdsKey = connectors.map((c) => c.id).join(',');

  useEffect(() => {
    if (!connectorIdsKey || !userEmail) return;

    let cancelled = false;
    const checkStatus = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/connections/status', {
          headers: {
            'x-user-email': userEmail,
            Accept: 'application/json',
          },
        });

        if (!response.ok) throw new Error('Failed to check connections status');

        const statusList = await response.json();
        if (cancelled) return;

        const currentConnectors = connectorsRef.current;
        const updatedConnectors = currentConnectors.map((conn) => {
          const status = statusList.find(
            (s: { id: string; status: string; accountId?: string }) => s.id === conn.id
          );
          return status ? { ...conn, status: status.status, accountId: status.accountId } : conn;
        });

        if (JSON.stringify(updatedConnectors) !== JSON.stringify(currentConnectors)) {
          onStatusUpdateRef.current?.(updatedConnectors);
        }
      } catch (error) {
        console.error('Error checking connections status:', error);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 120000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connectorIdsKey, userEmail]);

  if (connectors.length === 0) {
    return (
      <Perspective3DCard
        perspective={1200}
        baseRotateX={2}
        baseRotateY={2}
        sx={{ p: 4, textAlign: 'center' }}
      >
        <CloudIcon sx={{ fontSize: 42, color: 'primary.light', mb: 1 }} />
        <Typography variant="h6" gutterBottom>
          No AWS Connections Yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Test and save your AWS IAM credentials in the vault panel to start discovering and
          provisioning EKS clusters.
        </Typography>
      </Perspective3DCard>
    );
  }

  return (
    <Stack spacing={2.5}>
      {connectors.map((connector) => (
        <Perspective3DCard
          key={connector.id}
          perspective={1200}
          baseRotateX={2}
          baseRotateY={2}
          hoverLiftZ={10}
        >
          <CardContent sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <CloudIcon color="primary" />
                <Typography variant="h6">{connector.accountName}</Typography>
              </Box>
              {onDelete && (
                <>
                  <IconButton
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteConfirmId(connector.id);
                    }}
                    size="small"
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                  <Dialog
                    open={deleteConfirmId === connector.id}
                    onClose={() => setDeleteConfirmId(null)}
                  >
                    <DialogTitle>Delete Connection</DialogTitle>
                    <DialogContent>
                      <Typography>
                        Are you sure you want to delete this connection? This action cannot be
                        undone.
                      </Typography>
                    </DialogContent>
                    <DialogActions>
                      <Button onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                      <Button
                        onClick={() => {
                          if (deleteConfirmId) {
                            onDelete(deleteConfirmId);
                            setDeleteConfirmId(null);
                          }
                        }}
                        color="error"
                        variant="contained"
                      >
                        Delete
                      </Button>
                    </DialogActions>
                  </Dialog>
                </>
              )}
            </Box>

            <Box sx={{ mt: 1.5, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip
                label={connector.type.toUpperCase()}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Chip
                label={connector.status}
                size="small"
                color={connector.status === 'connected' ? 'success' : 'error'}
              />
              {connector.accountId && connector.status === 'connected' && (
                <Chip label={`Account: ${connector.accountId}`} size="small" color="info" />
              )}
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Created by {connector.createdBy} on{' '}
              {new Date(connector.createdAt).toLocaleDateString()}
            </Typography>
          </CardContent>
        </Perspective3DCard>
      ))}
    </Stack>
  );
};

export default ConnectorList;
