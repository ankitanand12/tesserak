import React, { useEffect, useRef, useState } from 'react';
import { TextField } from '@mui/material';

interface NumericCountFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  onChange: (nextValue: number) => void;
}

/**
 * Controlled integer input that allows clearing/backspacing without snapping
 * immediately to the minimum value until blur or valid digit entry.
 */
export const NumericCountField: React.FC<NumericCountFieldProps> = ({
  label,
  value,
  min = 0,
  max,
  size = 'small',
  fullWidth = true,
  onChange,
}) => {
  const [draft, setDraft] = useState<string>(String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  const clampValue = (n: number): number => {
    let res = Math.max(min, Math.trunc(n));
    if (max !== undefined) {
      res = Math.min(max, res);
    }
    return res;
  };

  return (
    <TextField
      label={label}
      type="number"
      size={size}
      fullWidth={fullWidth}
      value={draft}
      inputProps={{ min, max }}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw.trim() === '') return;
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= min && (max === undefined || parsed <= max)) {
          onChange(Math.trunc(parsed));
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = Number(draft);
        const committed =
          draft.trim() === '' || !Number.isFinite(parsed)
            ? clampValue(value)
            : clampValue(parsed);
        setDraft(String(committed));
        if (committed !== value) {
          onChange(committed);
        }
      }}
    />
  );
};
