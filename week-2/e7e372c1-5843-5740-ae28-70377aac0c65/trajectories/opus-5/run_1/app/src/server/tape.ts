/**
 * The replayable signed price tape. Each step is claimed through the database,
 * so one step is submitted every 5 seconds however many app copies run.
 */
import { query } from './db';
import { isSessionOpenAt } from '../domain/calendar';
import { marketClockNow } from './marketClock';
import { expectedSignature } from '../domain/tickSignature';
import { getTickKey } from './secrets';

const ETH_PRICES = [
  '3418.27',
  '3419.05',
  '3417.62',
  '3420.88',
  '3421.40',
  '3419.96',
  '3418.73',
  '3417.15',
] as const;

const VLCH_PRICES = ['14.81', '14.84', '14.79', '14.86'] as const;

export interface TapeState {
  state: 'playing' | 'paused';
  position: number;
}

export async function readTapeState(): Promise<TapeState> {
  const rows = await query<{ state: string; position: number }>(
    'SELECT state, position FROM tape_state WHERE id = 1',
  );
  const row = rows[0];
  return {
    state: row?.state === 'paused' ? 'paused' : 'playing',
    position: row?.position ?? 0,
  };
}

export async function writeTapeState(state: 'playing' | 'paused'): Promise<TapeState> {
  await query('UPDATE tape_state SET state = $1 WHERE id = 1', [state]);
  return readTapeState();
}

async function claimStep(): Promise<number | null> {
  const rows = await query<{ claimed: number }>(
    `UPDATE tape_state SET position = position + 1, last_step_at = now()
       WHERE id = 1 AND state = 'playing'
         AND (last_step_at IS NULL OR last_step_at <= now() - interval '5 seconds')
       RETURNING position - 1 AS claimed`,
  );
  return rows[0]?.claimed ?? null;
}

async function submitSignedTick(
  port: number,
  id: string,
  instrument: 'ETH-USD' | 'VLCH',
  price: string,
): Promise<void> {
  const body = JSON.stringify({ id, instrument, price });
  const raw = Buffer.from(body, 'utf8');
  const signedSeconds = String(Math.floor((await marketClockNow()) / 1000));
  const signature = expectedSignature(getTickKey(), signedSeconds, raw);
  await fetch(`http://127.0.0.1:${port}/api/internal/ticks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tick-signature': `t=${signedSeconds},v1=${signature}`,
    },
    body: raw,
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

async function playStep(port: number): Promise<void> {
  const position = await claimStep();
  if (position === null) return;
  const ethPrice = ETH_PRICES[position % ETH_PRICES.length] as string;
  await submitSignedTick(port, `tape-${position}`, 'ETH-USD', ethPrice);
  if (isSessionOpenAt(await marketClockNow())) {
    const vlchPrice = VLCH_PRICES[position % VLCH_PRICES.length] as string;
    await submitSignedTick(port, `tape-${position}-vlch`, 'VLCH', vlchPrice);
  }
}

export function startTapePlayer(port: number): void {
  setInterval(() => {
    void playStep(port).catch(() => undefined);
  }, 1000).unref();
}
