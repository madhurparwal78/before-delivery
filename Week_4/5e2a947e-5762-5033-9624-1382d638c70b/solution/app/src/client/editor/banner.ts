import type { MapSession } from './session.ts';
import { lostBanner, offlineBanner } from './session.ts';

/** The connection banner copy, or null while the screen is live. */
export function banner(session: MapSession): string | null {
  if (session.connection === 'offline') return offlineBanner(session.waiting);
  if (session.connection === 'lost') return lostBanner(session.waiting);
  return null;
}
