import { useEffect, useState } from 'preact/hooks';
import type { Model } from './model';

/** Re-renders the component when the model changes. */
export function useModel(m: Model): Model {
  const [, bump] = useState(0);
  useEffect(() => m.subscribe(() => bump((n) => n + 1)), [m]);
  return m;
}
