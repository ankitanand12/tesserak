import React from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}

export const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm Delete',
  loading = false,
  onCancel,
  onConfirm,
  children,
}) => {
  return (
    <Dialog open={open} onClose={() => !loading && onCancel()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ bgcolor: '#09090b', color: '#ffffff', fontWeight: 700 }}>
        {title}
      </DialogTitle>
      <DialogContent sx={{ pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2" sx={{ color: '#334155' }}>
          {description}
        </Typography>
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, bgcolor: '#f8fafc' }}>
        <Button onClick={onCancel} disabled={loading} sx={{ color: '#475569' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
          onClick={onConfirm}
        >
          {loading ? 'Deleting...' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
