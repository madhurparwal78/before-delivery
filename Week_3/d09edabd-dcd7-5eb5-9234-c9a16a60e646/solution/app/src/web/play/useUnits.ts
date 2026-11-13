import { useState } from 'react';
import type { Units } from '../../shared/units';

const KEY = 'kb-play-units';

function remembered(): Units {
  try {
    return localStorage.getItem(KEY) === 'ft' ? 'ft' : 'm';
  } catch {
    return 'm';
  }
}

/** The tester's metres or feet choice, remembered per browser. */
export function useUnits(): [Units, () => void] {
  const [units, setUnits] = useState<Units>(remembered);
  const toggle = (): void => {
    const next: Units = units === 'ft' ? 'm' : 'ft';
    setUnits(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // The choice still applies to this visit when the browser refuses storage.
    }
  };
  return [units, toggle];
}
