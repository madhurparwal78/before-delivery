import { query } from './db.js';
import { config } from './config.js';
import { alert } from './fulfilment.js';

/** Stock counting and low-stock crossings, decided in one place. */
export async function remaining(): Promise<number> {
  const rows = await query<{ n: number }>("SELECT count(*)::int AS n FROM boxes WHERE box_state IN ('available','held')");
  return rows[0]?.n ?? 0;
}

/** After a box moves between states, update stock and fire downward crossings. */
export async function stockAfterChange(from: string, to: string, _number: number): Promise<void> {
  const liveFrom = from === 'available' || from === 'held';
  const liveTo = to === 'available' || to === 'held';
  if (liveFrom === liveTo) return;
  await checkCrossings();
}

export async function checkCrossings(): Promise<void> {
  const value = await remaining();
  const thresholds = config.lowStockThresholds;
  for (const threshold of thresholds) {
    const rows = await query<{ last_remaining: number | null }>(
      'SELECT last_remaining FROM stock_alert_state WHERE threshold = $1',
      [threshold],
    );
    const last = rows[0]?.last_remaining ?? null;
    if (last === null) {
      await query('INSERT INTO stock_alert_state (threshold, last_remaining) VALUES ($1,$2) ON CONFLICT (threshold) DO NOTHING', [threshold, value]);
      continue;
    }
    if (last > threshold && value <= threshold) {
      await alert('Low stock', `${value} boxes remain.`);
    }
    await query('UPDATE stock_alert_state SET last_remaining = $1 WHERE threshold = $2', [value, threshold]);
  }
}

export async function thresholds(): Promise<number[]> {
  return config.lowStockThresholds;
}
