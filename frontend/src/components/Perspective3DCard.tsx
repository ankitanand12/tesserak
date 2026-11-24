import React from 'react';
import { Box, SxProps, Theme } from '@mui/material';

interface Perspective3DCardProps {
  children: React.ReactNode;
  perspective?: number;
  baseRotateX?: number;
  baseRotateY?: number;
  hoverLiftZ?: number;
  backingPlane?: boolean;
  flattenOnFocus?: boolean;
  sx?: SxProps<Theme>;
  elevationColor?: string;
}

/**
 * Spatial 3D extruded card in crisp White, Obsidian Black, and Electric Blue.
 * Uses a recessed 3D backing layer for multi-plane depth while keeping foreground controls
 * axis-aligned so buttons and form inputs never shift away from the pointer on click.
 */
export const Perspective3DCard: React.FC<Perspective3DCardProps> = ({
  children,
  perspective = 1200,
  baseRotateX = 0,
  baseRotateY = 0,
  hoverLiftZ = 8,
  backingPlane = true,
  sx,
  elevationColor = 'rgba(9, 9, 11, 0.14)',
}) => {
  return (
    <Box
      sx={{
        position: 'relative',
        perspective: `${perspective}px`,
        transformStyle: 'preserve-3d',
      }}
    >
      {backingPlane && (
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '20px',
            background:
              'linear-gradient(135deg, rgba(9, 9, 11, 0.12) 0%, rgba(37, 99, 235, 0.22) 100%)',
            border: '1px solid rgba(37, 99, 235, 0.22)',
            transform: `translate3d(6px, 8px, -18px) rotateX(${baseRotateX * 0.25}deg) rotateY(${baseRotateY * 0.25}deg)`,
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}

      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          borderRadius: '18px',
          background: '#ffffff',
          border: '1px solid rgba(15, 23, 42, 0.11)',
          boxShadow: `0 20px 42px -18px ${elevationColor}, 0 1px 0 rgba(255, 255, 255, 0.9) inset`,
          transition: 'box-shadow 200ms ease, border-color 200ms ease',
          '&:hover': {
            borderColor: 'rgba(37, 99, 235, 0.42)',
            boxShadow: `0 ${22 + Math.min(hoverLiftZ, 12)}px 52px -16px rgba(37, 99, 235, 0.22), 0 0 0 1px rgba(37, 99, 235, 0.12) inset`,
          },
          ...sx,
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

export default Perspective3DCard;
