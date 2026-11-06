// The tick tape: while playing, one seeded step is claimed through the database every five
// seconds, however many app copies share it, and submitted through the signed tick path.

import { equitySessionAt } from "./calendar.ts";
import { readMarketClock } from "./clock.ts";
import { database, many, numberValue, one } from "./db.ts";
import { ingestTick, signTick } from "./ticks.ts";

const ETH_PRICES = ["3418.27", "3419.05", "3417.62", "3420.88", "3421.40", "3419.96", "3418.73", "3417.15"];
const VLCH_PRICES = ["14.81", "14.84", "14.79", "14.86"];
const STEP_INTERVAL_MS = 5000;
const CHECK_INTERVAL_MS = 500;

interface TapeStatus {
  state: "playing" | "paused";
  position: number;
}

export async function readTape(): Promise<TapeStatus> {
  const row = await one(database(), "SELECT state, position FROM tape_state WHERE singleton");
  if (!row) throw new Error("tape state is missing");
  return { state: row["state"] === "paused" ? "paused" : "playing", position: numberValue(row, "position") };
}

export async function setTapeState(state: "playing" | "paused"): Promise<TapeStatus> {
  await database().query("UPDATE tape_state SET state = $1, next_due_ms = 0 WHERE singleton", [state]);
  return readTape();
}

async function submit(body: Record<string, string>): Promise<void> {
  const raw = Buffer.from(JSON.stringify(body));
  const { now } = await readMarketClock(database());
  await ingestTick(raw, body, signTick(Math.floor(now / 1000), raw));
}

async function playStep(): Promise<void> {
  const claimed = await many(
    database(),
    "UPDATE tape_state SET position = position + 1, next_due_ms = $1 + $2 WHERE singleton AND state = 'playing' AND next_due_ms <= $1 RETURNING position - 1 AS step",
    [Date.now(), STEP_INTERVAL_MS],
  );
  const step = claimed[0]?.["step"];
  if (typeof step !== "number") return;
  await submit({ id: `tape-${step}`, instrument: "ETH-USD", price: ETH_PRICES[step % ETH_PRICES.length] ?? "" });
  const { now } = await readMarketClock(database());
  if (equitySessionAt(now).status === "open") {
    await submit({ id: `tape-${step}-vlch`, instrument: "VLCH", price: VLCH_PRICES[step % VLCH_PRICES.length] ?? "" });
  }
}

export function startTapePlayer(): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    playStep()
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, CHECK_INTERVAL_MS).unref();
}
