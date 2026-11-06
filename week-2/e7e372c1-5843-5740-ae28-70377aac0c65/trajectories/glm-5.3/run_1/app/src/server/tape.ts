// The tick tape: while playing, it submits one seeded step every 5 seconds.
// Steps are claimed through the database, so one step is submitted per 5
// seconds however many app copies share the database.

import { createHmac } from "node:crypto";
import { pool, withTransaction } from "./db.js";
import { ingestTick } from "./ticks.js";
import { inRegularSession } from "./calendar.js";
import { marketNow } from "./clock.js";

const STEP_MS = 5_000;
const ETH_PRICES = ["3418.27", "3419.05", "3417.62", "3420.88", "3421.40", "3419.96", "3418.73", "3417.15"];
const VLCH_PRICES = ["14.81", "14.84", "14.79", "14.86"];

interface TapeRow {
  state: "playing" | "paused";
  position: number;
}

export async function getTapeState(): Promise<TapeRow> {
  const { rows } = await pool.query<TapeRow>(`SELECT state, position FROM tape_state WHERE id = 1`);
  if (rows.length === 0) return { state: "playing", position: 0 };
  return rows[0] as TapeRow;
}

export async function setTapeState(state: "playing" | "paused"): Promise<TapeRow> {
  const { rows } = await pool.query<TapeRow>(
    `UPDATE tape_state SET state = $1::text WHERE id = 1 RETURNING state, position`,
    [state],
  );
  if (rows.length === 0) {
    await pool.query(`INSERT INTO tape_state (id, state, position) VALUES (1, $1, 0) ON CONFLICT (id) DO NOTHING`, [state]);
    return getTapeState();
  }
  return rows[0] as TapeRow;
}

/** Claims the next step through the database: one step per 5 seconds, each position once. */
async function claimStep(): Promise<number | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<TapeRow>(`SELECT state, position FROM tape_state WHERE id = 1 FOR UPDATE`);
    const row = rows[0] as TapeRow | undefined;
    if (!row || row.state !== "playing") return null;
    const position = row.position;
    await client.query(`UPDATE tape_state SET position = position + 1 WHERE id = 1`);
    return position;
  });
}

export async function playTapeStep(): Promise<void> {
  const step = await claimStep();
  if (step === null) return;
  const now = await marketNow();
  await submitSigned(`tape-${step}`, "ETH-USD", ETH_PRICES[step % ETH_PRICES.length] ?? "3418.27", now);
  if (inRegularSession(now)) {
    await submitSigned(`tape-${step}-vlch`, "VLCH", VLCH_PRICES[step % VLCH_PRICES.length] ?? "14.81", now);
  }
}

/** The tape uses the same signed endpoint as external ticks, with `t` from the market clock. */
async function submitSigned(id: string, instrument: "ETH-USD" | "VLCH", price: string, now: number): Promise<void> {
  const body = JSON.stringify({ id, instrument, price });
  const { getTickKey } = await import("./ticks.js");
  const tickKey = await getTickKey();
  const t = Math.floor(now / 1000);
  const v1 = createHmac("sha256", Buffer.from(tickKey, "ascii")).update(`${t}.${body}`, "utf8").digest("hex");
  await ingestTick(body, `t=${t},v1=${v1}`);
}

export function startTape(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void playTapeStep().catch(() => undefined);
  }, STEP_MS);
  timer.unref?.();
  return timer;
}
