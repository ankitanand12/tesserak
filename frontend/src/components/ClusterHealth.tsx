import React from 'react';
import { Box, Typography } from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface ClusterHealthProps {
  data: Array<{
    name: string;
    value: number;
    [key: string]: string | number;
  }>;
}

const COLORS = ['#4caf50', '#ff9800', '#f44336'];

const ClusterHealth: React.FC<ClusterHealthProps> = ({ data }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const chartData =
    total > 0 ? data : [{ name: 'Empty', value: 1 }];

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        pt: 0.5,
      }}
    >
      <Box sx={{ width: 132, height: 132, flexShrink: 0, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={56}
              paddingAngle={total > 0 ? 4 : 0}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={total > 0 ? COLORS[index % COLORS.length] : '#e2e8f0'}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {total}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flexGrow: 1 }}>
        {data.map((entry, index) => (
          <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                bgcolor: COLORS[index % COLORS.length],
                borderRadius: '50%',
                flexShrink: 0,
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>
              {entry.name}: <strong>{entry.value}</strong>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default ClusterHealth;
