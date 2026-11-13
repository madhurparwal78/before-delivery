import { useEffect } from 'react';
import { replaceSearch, useSearch } from '../../nav';
import type { Units } from '../../../shared/units';

const queryFor = (units: Units): string => `?units=${units}`;

/** The pack page's units live in its address: feet only for `units=ft`; a missing or unknown value reads as metres and is rewritten in place. */
export function usePackUnits(): { units: Units; toggle: () => void } {
  const requested = new URLSearchParams(useSearch()).get('units');
  const units: Units = requested === 'ft' ? 'ft' : 'm';
  useEffect(() => {
    if (requested !== units) replaceSearch(queryFor(units));
  }, [requested, units]);
  return { units, toggle: () => replaceSearch(queryFor(units === 'ft' ? 'm' : 'ft')) };
}
