import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { isValkeyUp, valkey } from '../services/valkey.js';

const LAPSE_RECHECK_MS = 50;

/** Who holds a match's pen: the pen id, and the holder's display name when this server knows it. */
interface PenHolder { penId: string; name: string | null }

interface Memory { penId: string; name: string; expiresAt: number }

// Names of holders, and the whole pen when Valkey is unreachable ("the same rules" kept in this process).
const holders = new Map<string, Memory>();

const keyOf = (matchId: string): string => `pen:${matchId}`;

const RENEW_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0`;

const memoryHolder = (matchId: string): Memory | null => {
  const held = holders.get(matchId);
  if (held && held.expiresAt > Date.now()) return held;
  holders.delete(matchId);
  return null;
};

export const currentPen = async (matchId: string): Promise<PenHolder | null> => {
  if (isValkeyUp()) {
    try {
      const value = await valkey.get(keyOf(matchId));
      if (value === null) {
        holders.delete(matchId);
        return null;
      }
      const known = holders.get(matchId);
      return { penId: value, name: known?.penId === value ? known.name : null };
    } catch {
      // Valkey went away between the check and the call: the in-process pen answers.
    }
  }
  const held = memoryHolder(matchId);
  return held ? { penId: held.penId, name: held.name } : null;
};

/** Asks for the pen. Exactly one of several simultaneous callers gets a pen id; the others get the holder's name. */
export const claimPen = async (matchId: string, name: string): Promise<{ pen: string | null; holder: string | null }> => {
  const penId = randomBytes(16).toString('hex');
  const granted = { pen: penId, holder: name };
  const keep = (): void => { holders.set(matchId, { penId, name, expiresAt: Date.now() + config.penGraceMs }); };
  if (isValkeyUp()) {
    try {
      if ((await valkey.set(keyOf(matchId), penId, 'PX', config.penGraceMs, 'NX')) === 'OK') {
        keep();
        return granted;
      }
      const existing = await currentPen(matchId);
      return { pen: null, holder: existing?.name ?? null };
    } catch {
      // Valkey went away between the check and the call: the in-process pen answers.
    }
  }
  const held = memoryHolder(matchId);
  if (held) return { pen: null, holder: held.name };
  keep();
  return granted;
};

/** Keeps the pen for another grace period; called while the holder's connection is open. */
export const renewPen = async (matchId: string, penId: string): Promise<void> => {
  const held = holders.get(matchId);
  if (held?.penId === penId) held.expiresAt = Date.now() + config.penGraceMs;
  if (!isValkeyUp()) return;
  try {
    await valkey.eval(RENEW_SCRIPT, 1, keyOf(matchId), penId, config.penGraceMs);
  } catch {
    // The in-process expiry above still holds the pen.
  }
};

/**
 * The holder's connection has closed: the pen lapses one grace period later by server time, and `onLapse` runs once it
 * has (only if nobody took it meanwhile).
 */
export const releaseAfterGrace = async (matchId: string, penId: string, onLapse: () => void): Promise<void> => {
  await renewPen(matchId, penId);
  const check = async (): Promise<void> => {
    const current = await currentPen(matchId);
    if (current?.penId === penId) {
      setTimeout(() => { void check(); }, LAPSE_RECHECK_MS);
      return;
    }
    if (current === null) onLapse();
  };
  setTimeout(() => { void check(); }, config.penGraceMs + LAPSE_RECHECK_MS);
};
