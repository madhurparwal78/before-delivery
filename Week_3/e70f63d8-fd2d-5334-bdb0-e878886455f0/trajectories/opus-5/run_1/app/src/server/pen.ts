import { MSG } from '../shared/messages.js';
import { HttpError } from './errors.js';
import { randomToken } from './store.js';
import { penAcquire, penGet } from './valkey.js';

export interface PenHolder {
  pen: string;
  user: string;
  name: string;
}

export async function currentHolder(matchId: string): Promise<PenHolder | null> {
  const value = await penGet(matchId);
  if (!value) return null;
  return JSON.parse(value) as PenHolder;
}

export async function takePen(
  matchId: string,
  user: { id: string; display_name: string },
): Promise<{ pen: string; value: string } | null> {
  const pen = randomToken(16);
  const value = JSON.stringify({ pen, user: user.id, name: user.display_name });
  const acquired = await penAcquire(matchId, value);
  return acquired ? { pen, value } : null;
}

export async function requirePen(matchId: string, header: string | undefined): Promise<void> {
  const holder = await currentHolder(matchId);
  if (!holder || !header || holder.pen !== header) {
    throw new HttpError(409, 'PEN_HELD', holder ? MSG.penHeld(holder.name) : MSG.penFree, {
      holder: holder ? holder.name : null,
    });
  }
}
