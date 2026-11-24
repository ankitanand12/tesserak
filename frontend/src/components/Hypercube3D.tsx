import React, { useState } from 'react';
import { Box } from '@mui/material';

interface Hypercube3DProps {
  size?: number;
  interactive?: boolean;
}

/**
 * Interactive 6-face CSS 3D perspective hypercube rendered in Obsidian, White, and Electric Blue.
 */
export const Hypercube3D: React.FC<Hypercube3DProps> = ({
  size = 180,
  interactive = true,
}) => {
  const [tilt, setTilt] = useState({ rx: -20, ry: 32 });
  const [hovered, setHovered] = useState(false);

  const halfOuter = size / 2;
  const innerSize = Math.round(size * 0.5);
  const halfInner = innerSize / 2;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({
      rx: -18 - ny * 28,
      ry: 32 + nx * 36,
    });
  };

  const resetTilt = () => {
    setHovered(false);
    setTilt({ rx: -20, ry: 32 });
  };

  const outerFaces = [
    { name: 'front', transform: `translateZ(${halfOuter}px)` },
    { name: 'back', transform: `rotateY(180deg) translateZ(${halfOuter}px)` },
    { name: 'right', transform: `rotateY(90deg) translateZ(${halfOuter}px)` },
    { name: 'left', transform: `rotateY(-90deg) translateZ(${halfOuter}px)` },
    { name: 'top', transform: `rotateX(90deg) translateZ(${halfOuter}px)` },
    { name: 'bottom', transform: `rotateX(-90deg) translateZ(${halfOuter}px)` },
  ];

  const innerFaces = [
    { name: 'front', transform: `translateZ(${halfInner}px)`, bg: 'linear-gradient(135deg, rgba(37,99,235,0.92), rgba(9,9,11,0.92))' },
    { name: 'back', transform: `rotateY(180deg) translateZ(${halfInner}px)`, bg: 'linear-gradient(135deg, rgba(9,9,11,0.94), rgba(29,78,216,0.9))' },
    { name: 'right', transform: `rotateY(90deg) translateZ(${halfInner}px)`, bg: 'linear-gradient(135deg, rgba(59,130,246,0.92), rgba(15,23,42,0.95))' },
    { name: 'left', transform: `rotateY(-90deg) translateZ(${halfInner}px)`, bg: 'linear-gradient(135deg, rgba(9,9,11,0.92), rgba(59,130,246,0.88))' },
    { name: 'top', transform: `rotateX(90deg) translateZ(${halfInner}px)`, bg: 'linear-gradient(135deg, rgba(255,255,255,0.92), rgba(147,197,253,0.9))' },
    { name: 'bottom', transform: `rotateX(-90deg) translateZ(${halfInner}px)`, bg: 'linear-gradient(135deg, #09090b, #1e3a8a)' },
  ];

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={resetTilt}
      sx={{
        width: size * 1.4,
        height: size * 1.4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '900px',
        position: 'relative',
        cursor: interactive ? 'grab' : 'default',
        userSelect: 'none',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          width: size * 1.18,
          height: size * 1.18,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(37,99,235,0.22) 0%, rgba(9,9,11,0.08) 48%, rgba(255,255,255,0) 74%)',
          filter: 'blur(12px)',
          pointerEvents: 'none',
        }}
      />

      <Box
        sx={{
          width: size,
          height: size,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) scale3d(${hovered ? 1.05 : 1}, ${hovered ? 1.05 : 1}, 1)`,
          transition: hovered ? 'transform 120ms ease-out' : 'transform 650ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {outerFaces.map((face) => (
          <Box
            key={face.name}
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: '18px',
              border: '1.5px solid rgba(37, 99, 235, 0.45)',
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.78) 0%, rgba(239,246,255,0.38) 60%, rgba(9,9,11,0.08) 100%)',
              boxShadow: 'inset 0 0 22px rgba(37, 99, 235, 0.14)',
              backdropFilter: 'blur(3px)',
              transform: face.transform,
            }}
          />
        ))}

        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: innerSize,
            height: innerSize,
            marginLeft: `-${halfInner}px`,
            marginTop: `-${halfInner}px`,
            transformStyle: 'preserve-3d',
            transform: 'rotateX(12deg) rotateY(15deg)',
          }}
        >
          {innerFaces.map((face) => (
            <Box
              key={`inner-${face.name}`}
              sx={{
                position: 'absolute',
                inset: 0,
                borderRadius: '12px',
                border: '1.5px solid rgba(255, 255, 255, 0.6)',
                background: face.bg,
                boxShadow: '0 0 24px rgba(37, 99, 235, 0.32)',
                transform: face.transform,
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export default Hypercube3D;

