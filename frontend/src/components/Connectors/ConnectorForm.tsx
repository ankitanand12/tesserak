import React, { useState } from 'react';
import { 
  Box,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Alert
} from '@mui/material';

interface ConnectorFormProps {
  onSubmit: (credentials: {
    accessKey: string;
    secretKey: string;
    region: string;
    accountName: string;
  }) => void;
}

const ConnectorForm: React.FC<ConnectorFormProps> = ({ onSubmit }) => {
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [region, setRegion] = useState('us-west-2');
  const [accountName, setAccountName] = useState('');
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'none' | 'success' | 'error'>('none');
  const [errorMessage, setErrorMessage] = useState('');

  const handleTest = async () => {
    if (!accessKey || !secretKey) {
      setErrorMessage('Please fill in all required fields');
      return;
    }

    setTesting(true);
    setTestStatus('none');
    setErrorMessage('');

    try {
      const response = await fetch('http://localhost:8000/api/connections/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': localStorage.getItem('currentUser') || '',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          accessKey,
          secretKey,
          region,
          type: 'aws',
          accountName: accountName || `AWS Account (${accessKey.substring(0, 8)})`
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Connection test failed');
      }

      setTestStatus('success');
    } catch (error) {
      setTestStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = () => {
    if (testStatus === 'success') {
      onSubmit({
        accessKey,
        secretKey,
        region,
        accountName: accountName || `AWS Account (${accessKey.substring(0, 8)})`
      });
    }
  };

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <Typography variant="h6" gutterBottom>
        Add AWS Connection
      </Typography>
      
      <TextField
        fullWidth
        label="Account Name (Optional)"
        value={accountName}
        onChange={(e) => setAccountName(e.target.value)}
        margin="normal"
      />

      <TextField
        fullWidth
        required
        label="AWS Access Key"
        value={accessKey}
        onChange={(e) => setAccessKey(e.target.value)}
        margin="normal"
      />

      <TextField
        fullWidth
        required
        label="AWS Secret Key"
        type="password"
        value={secretKey}
        onChange={(e) => setSecretKey(e.target.value)}
        margin="normal"
      />

      <TextField
        fullWidth
        label="AWS Region"
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        margin="normal"
        helperText="Optional - will use us-east-1 if not specified"
      />

      {errorMessage && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorMessage}
        </Alert>
      )}

      {testStatus === 'success' && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Connected successfully!
        </Alert>
      )}

      <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
        <Button
          variant="outlined"
          onClick={handleTest}
          disabled={testing || !accessKey || !secretKey}
        >
          {testing ? <CircularProgress size={24} /> : 'Test Connection'}
        </Button>

        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={testStatus !== 'success'}
        >
          Submit
        </Button>
      </Box>
    </Box>
  );
};

export default ConnectorForm;
