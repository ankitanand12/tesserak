import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Chip,
  Divider
} from '@mui/material';
import { ClusterConfig } from '../../pages/CreateCluster';

interface Props {
  config: ClusterConfig;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box sx={{ mb: 3 }}>
    <Typography variant="h6" gutterBottom>{title}</Typography>
    {children}
  </Box>
);

const Field: React.FC<{ label: string; value: string | React.ReactNode }> = ({ label, value }) => (
  <Grid container spacing={2} sx={{ mb: 1 }}>
    <Grid item xs={4}>
      <Typography color="text.secondary">{label}</Typography>
    </Grid>
    <Grid item xs={8}>
      <Typography>{value}</Typography>
    </Grid>
  </Grid>
);

const ClusterPreview: React.FC<Props> = ({ config }) => {
  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 3 }}>Review Cluster Configuration</Typography>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Section title="Basic Details">
          <Field label="Cluster Name" value={config.name} />
          <Field
            label="AWS Account"
            value={
              config.accountName
                ? `${config.accountName} (${config.accountId})`
                : config.accountId
            }
          />
          <Field label="Region" value={config.region} />
          <Field
            label="VPC"
            value={config.vpc.isNew ? `New VPC (CIDR: ${config.vpc.cidr})` : config.vpc.id}
          />
        </Section>

        <Divider sx={{ my: 3 }} />

        <Section title="Environment Configuration">
          <Field label="Environment Type" value={config.environment.type || 'Not configured'} />
          <Field label="Endpoint Type" value={config.environment.endpoint || 'Not configured'} />
          <Field label="Kubernetes Version" value={config.environment.kubernetesVersion || 'Not configured'} />
          <Field
            label="Availability Zones"
            value={
              config.environment.availabilityZones.length > 0 
                ? config.environment.availabilityZones.join(', ')
                : 'Not configured'
            }
          />
        </Section>

        <Divider sx={{ my: 3 }} />

        <Section title="Add-ons">
          {config.addons && config.addons.length > 0 ? (
            config.addons.map((addon, index) => (
              <Box key={index} sx={{ mb: 2 }}>
                <Field label="Add-on Name" value={addon.name} />
                <Field label="Type" value={addon.type === 'aws' ? 'AWS' : 'Community'} />
                <Field label="Version" value={addon.version} />
                {addon.configuration && (
                  <Field 
                    label="Configuration" 
                    value={
                      <pre style={{ margin: 0 }}>
                        {JSON.stringify(addon.configuration, null, 2)}
                      </pre>
                    } 
                  />
                )}
                {index < config.addons.length - 1 && <Divider sx={{ my: 2 }} />}
              </Box>
            ))
          ) : (
            <Typography color="text.secondary">No add-ons configured</Typography>
          )}
        </Section>

        {config.tags && config.tags.length > 0 && (
          <>
            <Divider sx={{ my: 3 }} />
            <Section title="Tags">
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {config.tags.map((tag, index) => (
                  <Chip
                    key={index}
                    label={`${tag.key}: ${tag.value}`}
                    variant="outlined"
                    color="primary"
                  />
                ))}
              </Box>
            </Section>
          </>
        )}
      </Paper>
    </Box>
  );
};

export default ClusterPreview;
