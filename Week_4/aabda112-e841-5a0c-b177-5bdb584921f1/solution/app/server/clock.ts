import { type Db, one, listen, notify, pool } from './db.js';

/**
 * The server clock. Real time unless the grading route anchored it; it then runs forward in real time from the set
 * instant. The anchor lives in Postgres so every process of one database agrees.
 */
interface Anchor {
  real: number;
  virtual: number;
}

let anchor: Anchor | null = null;
const CHANNEL = 'rb_clock';

export function now(): Date {
  return new Date(anchor ? anchor.virtual + (Date.now() - anchor.real) : Date.now());
}

async function load(db: Db): Promise<void> {
  const row = await one<{ real: Date; virtual: Date }>(db, 'SELECT anchor_real AS real, anchor_virtual AS virtual FROM clock WHERE id = 1');
  anchor = row ? { real: row.real.getTime(), virtual: row.virtual.getTime() } : null;
}

export async function startClock(): Promise<void> {
  await load(pool);
  listen(CHANNEL, () => void load(pool));
}

export async function setClock(db: Db, instant: Date): Promise<void> {
  const real = new Date();
  await db.query(
    `INSERT INTO clock (id, anchor_real, anchor_virtual) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET anchor_real = EXCLUDED.anchor_real, anchor_virtual = EXCLUDED.anchor_virtual`,
    [real, instant],
  );
  anchor = { real: real.getTime(), virtual: instant.getTime() };
  await notify(db, CHANNEL, 1);
}
