// The market clock: real time unless an operator set a rehearsal instant, shared through Postgres.

import { one, type Queryable } from "./db.ts";

interface MarketClock {
  now: number;
  rehearsal: boolean;
}

export async function readMarketClock(q: Queryable): Promise<MarketClock> {
  const row = await one(q, "SELECT anchor_ms, set_real_ms FROM market_clock WHERE singleton");
  const anchor = row?.["anchor_ms"];
  const setAt = row?.["set_real_ms"];
  if (typeof anchor === "number" && typeof setAt === "number") {
    return { now: anchor + (Date.now() - setAt), rehearsal: true };
  }
  return { now: Date.now(), rehearsal: false };
}

/** `null` returns the market clock to real time. */
export async function setMarketClock(q: Queryable, at: number | null): Promise<void> {
  if (at === null) {
    await q.query(
      "INSERT INTO market_clock (singleton, anchor_ms, set_real_ms) VALUES (true, NULL, NULL) " +
        "ON CONFLICT (singleton) DO UPDATE SET anchor_ms = NULL, set_real_ms = NULL",
    );
    return;
  }
  await q.query(
    "INSERT INTO market_clock (singleton, anchor_ms, set_real_ms) VALUES (true, $1, $2) " +
      "ON CONFLICT (singleton) DO UPDATE SET anchor_ms = $1, set_real_ms = $2",
    [at, Date.now()],
  );
}
