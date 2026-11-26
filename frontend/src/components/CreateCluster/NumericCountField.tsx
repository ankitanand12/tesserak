import React, { useEffect, useRef, useState } from 'react';
import { TextField } from '@mui/material';

interface NumericCountFieldProps {
  label: string;
  value: number | undefined;
  min?: number;
  fallbackValue?: number;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  onChange: (nextVal: number) => void;
}

/**
 * Controlled integer field that allows clearing via Backspace and multi-digit typing
 * without snapping back to `min` until focus leaves the field.
 */
export const NumericCountField: React.FC<NumericCountFieldProps> = ({
  label,
  value,
  min = 0,
  fallbackValue,
  size = 'small',
  fullWidth = true,
  onChange,
}) => {
  const effectiveFallback = fallbackValue ?? min;
  const resolvedValue = value ?? effectiveFallback;
  const [text, setText] = useState<string>(() => String(resolvedValue));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setText(String(resolvedValue));
    }
  }, [resolvedValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextRaw = e.target.value;
    if (!/^\d*$/.test(nextRaw)) return;
    setText(nextRaw);
    if (nextRaw !== '') {
      const parsed = Number(nextRaw);
      if (Number.isFinite(parsed)) {
        onChange(parsed);
      }
    }
  };

  const handleBlur = () => {
    focusedRef.current = false;
    const trimmed = text.trim();
    const parsed = trimmed === '' ? effectiveFallback : Number(trimmed);
    const clamped = Math.max(min, Number.isFinite(parsed) ? Math.floor(parsed) : effectiveFallback);
    setText(String(clamped));
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  return (
    <TextField
      label={label}
      type="text"
      size={size}
      fullWidth={fullWidth}
      value={text}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', min }}
    />
  );
};
