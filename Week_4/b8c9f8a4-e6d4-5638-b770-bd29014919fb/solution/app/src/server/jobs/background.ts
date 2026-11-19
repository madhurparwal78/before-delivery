// The one background pass: it persists offer lapses and raises the single lapse warning per
// offer. Every instance may run it; the database decides who does the work.

import { config } from '../config.js';
import { query } from '../db/pool.js';
import { raiseAlert } from '../services/alerts.js';
import { LAPSED_OFFER, LIVE_OFFER } from '../domain/offers.js';

const EVERY_MS = 2000;

async function pass(): Promise<void> {
  const warning = await query<{ id: string; car_id: string }>(
    `SELECT id, car_id FROM offer
     WHERE ${LIVE_OFFER}
       AND lapses_at <= now() + ($1 || ' seconds')::interval`,
    [String(config.offerWarningSeconds)],
  );
  for (const offer of warning) {
    await raiseAlert(offer.car_id, 'offer_lapsing', offer.id);
  }
  await query(
    `UPDATE offer SET status = 'lapsed' WHERE ${LAPSED_OFFER}`,
  );
}

export function startBackgroundPass(): NodeJS.Timeout {
  const timer = setInterval(() => {
    pass().catch(() => undefined);
  }, EVERY_MS);
  timer.unref();
  return timer;
}
