import { useEffect, useState } from 'react';
import type { Catalogue } from '../shared/types.js';
import { get } from './api.js';

let cached: Promise<Catalogue> | null = null;

export function useCatalogue(): Catalogue | null {
  const [value, setValue] = useState<Catalogue | null>(null);
  useEffect(() => {
    cached ??= get<Catalogue>('/api/catalogue', { poll: true });
    let alive = true;
    cached.then((c) => { if (alive) setValue(c); }, () => { cached = null; });
    return () => { alive = false; };
  }, []);
  return value;
}
