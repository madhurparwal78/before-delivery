import { useLayoutEffect, useState } from 'preact/hooks';
import type { MapSession } from './session.ts';

/** Re-render the calling component whenever the session changes. */
export function useSession(session: MapSession): void {
  const [, setTick] = useState(0);
  useLayoutEffect(() => session.subscribe(() => setTick((n) => n + 1)), [session]);
}
