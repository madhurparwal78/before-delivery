// Objectives (Business rules M): error budget, burn rates and status, in exact integer arithmetic.
import { now } from "./clock";
import { pool } from "./db";
import { findStream } from "./access";
import { loadStreamContext, loadUniverse } from "./search/context";
import { eventValues, matchesFilter, type Filter } from "./search/filters";

const HOUR_MS = 3_600_000;
const FIVE_MINUTES_MS = 300_000;
export const DEFAULT_OBJECTIVE_WINDOW_MS = 2_592_000_000;

interface Counts {
  bad: number;
  total: number;
}

interface ObjectiveRow {
  id: number;
  spaceId: number;
  service: string;
  name: string;
  stream: string;
  target: string;
  windowMs: number;
  bad: Filter;
  counts: { objective: Counts; long: Counts; short: Counts } | null;
}

const SCALE = 100_000n;

/** A value divided by a positive denominator, as hundredths, rounded half away from zero. */
function hundredths(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (2n * absolute * 100n + denominator) / (2n * denominator);
  return negative ? -rounded : rounded;
}

const show = (value: bigint): string => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
};

/** The budget is `1 - target / 100`; expressed over 100000 so no float touches it. */
const budgetUnits = (target: string): bigint => {
  const [whole = "0", fraction = ""] = target.split(".");
  return SCALE - (BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")));
};

const burn = (counts: Counts, target: string): bigint =>
  counts.total === 0 ? 0n : hundredths(BigInt(counts.bad) * SCALE, BigInt(counts.total) * budgetUnits(target));

const budgetRemaining = (counts: Counts, target: string): bigint => {
  if (counts.total === 0) return 10_000n;
  const total = BigInt(counts.total) * budgetUnits(target);
  return hundredths((total - BigInt(counts.bad) * SCALE) * 100n, total);
};

const statusOf = (long: bigint, short: bigint): "Burning fast" | "Burning" | "OK" =>
  long >= 1440n && short >= 1440n ? "Burning fast" : long >= 600n && short >= 600n ? "Burning" : "OK";

async function countWindows(row: ObjectiveRow, at: number): Promise<{ objective: Counts; long: Counts; short: Counts }> {
  const stream = await findStream(row.spaceId, row.stream);
  const empty = { bad: 0, total: 0 };
  if (!stream) return { objective: empty, long: empty, short: empty };
  const universe = await loadUniverse(await loadStreamContext(stream, row.spaceId), at - row.windowMs + 1, at + 1);
  const mine = universe.events.filter((event) => eventValues(event, "service").includes(row.service));
  const within = (ms: number): Counts => {
    const inside = mine.filter((event) => event.ts > at - ms);
    return { bad: inside.filter((event) => matchesFilter(event, row.bad)).length, total: inside.length };
  };
  return { objective: within(row.windowMs), long: within(HOUR_MS), short: within(FIVE_MINUTES_MS) };
}

export async function objectiveView(row: ObjectiveRow) {
  const counts = row.counts ?? (await countWindows(row, now()));
  const longBurn = burn(counts.long, row.target);
  const shortBurn = burn(counts.short, row.target);
  return {
    id: row.id, service: row.service, name: row.name, stream: row.stream, target: Number(row.target), objective_window_ms: row.windowMs,
    budget_remaining: show(budgetRemaining(counts.objective, row.target)),
    objective: counts.objective,
    long: { ...counts.long, burn: show(longBurn) },
    short: { ...counts.short, burn: show(shortBurn) },
    status: statusOf(longBurn, shortBurn),
  };
}

export async function loadObjectives(spaceId: number): Promise<ObjectiveRow[]> {
  const { rows } = await pool.query<Record<string, unknown>>("SELECT * FROM objectives WHERE space_id = $1 ORDER BY service", [spaceId]);
  return rows.map((row) => ({
    id: row.id as number, spaceId, service: row.service as string, name: row.name as string, stream: row.stream as string, target: row.target as string,
    windowMs: row.objective_window_ms as number, bad: row.bad as Filter, counts: row.counts as ObjectiveRow["counts"],
  }));
}
