import React from 'react';
import { Box, SxProps, Theme } from '@mui/material';

interface TesserakLogoProps {
  size?: number;
  variant?: 'light' | 'gradient';
  sx?: SxProps<Theme>;
}

/**
 * Geometric 3D hypercube mark for Tesserak rendered in crisp black, white, and electric blue.
 */
export const TesserakLogo: React.FC<TesserakLogoProps> = ({
  size = 32,
  variant = 'gradient',
  sx,
}) => {
  const isLight = variant === 'light';
  const outerStroke = isLight ? '#ffffff' : 'url(#tesserak-logo-grad)';
  const strutColor = isLight ? 'rgba(147, 197, 253, 0.85)' : 'rgba(37, 99, 235, 0.72)';
  const innerFillTop = isLight ? 'rgba(59, 130, 246, 0.34)' : 'rgba(37, 99, 235, 0.24)';
  const innerFillSide = isLight ? 'rgba(255, 255, 255, 0.20)' : 'rgba(9, 9, 11, 0.85)';
  const innerEdgeStroke = isLight ? '#93c5fd' : '#09090b';
  const innerAccentStroke = isLight ? '#ffffff' : '#3b82f6';
  const coreDot = isLight ? '#ffffff' : '#2563eb';

  return (
    <Box
      component="svg"
      viewBox="0 0 64 64"
      fill="none"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-block',
        ...sx,
      }}
      aria-label="Tesserak logo"
    >
      {!isLight && (
        <defs>
          <linearGradient id="tesserak-logo-grad" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#09090b" />
            <stop offset="55%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>
      )}

      <polygon
        points="32,6 54.5,19 54.5,45 32,58 9.5,45 9.5,19"
        stroke={outerStroke}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />

      <g stroke={strutColor} strokeWidth="2.2" strokeLinecap="round">
        <line x1="32" y1="6" x2="32" y2="19.5" />
        <line x1="54.5" y1="19" x2="42.8" y2="25.8" />
        <line x1="54.5" y1="45" x2="42.8" y2="38.2" />
        <line x1="32" y1="58" x2="32" y2="44.5" />
        <line x1="9.5" y1="45" x2="21.2" y2="38.2" />
        <line x1="9.5" y1="19" x2="21.2" y2="25.8" />
      </g>

      <polygon points="32,19.5 42.8,25.8 32,32 21.2,25.8" fill={innerFillTop} />
      <polygon points="32,32 42.8,25.8 42.8,38.2 32,44.5" fill={innerFillSide} />

      <polygon
        points="32,19.5 42.8,25.8 42.8,38.2 32,44.5 21.2,38.2 21.2,25.8"
        stroke={innerEdgeStroke}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M21.2 25.8 L32 32 L42.8 25.8 M32 32 L32 44.5"
        stroke={innerAccentStroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx="32" cy="32" r="2.7" fill={coreDot} />
    </Box>
  );
};

export default TesserakLogo;

