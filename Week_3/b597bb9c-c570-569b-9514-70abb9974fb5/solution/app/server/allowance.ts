import { allowanceText, gigabytes } from "../shared/copy";
import type { Allowance } from "../shared/types";
import { config } from "./config";
import { one } from "./db";
import { AppError } from "./errors";
import { hub } from "./live";
import { kv } from "./kv";

const MINUTES_KEY_TTL_SECONDS = 40 * 24 * 3600;

interface WorkspaceRow {
  id: string;
  carried_storage_bytes: number;
  opening_minutes: number;
  opening_month: string;
}

let workspaceCache: WorkspaceRow | null = null;

async function workspace(): Promise<WorkspaceRow> {
  if (workspaceCache) return workspaceCache;
  const row = await one<WorkspaceRow>("SELECT id, carried_storage_bytes, opening_minutes, opening_month FROM workspace LIMIT 1");
  if (!row) throw new Error("workspace is not seeded");
  workspaceCache = row;
  return row;
}

export const currentMonth = (now = new Date()): string => now.toISOString().slice(0, 7);

const minutesKey = (ws: string, month: string): string => `gatecut:${ws}:export-minutes:${month}`;
const storageKey = (ws: string): string => `gatecut:${ws}:storage-bytes`;

/** Rebuilds a missing month counter from Postgres: the opening usage of that month plus its live exports. */
async function ensureMinutes(month: string): Promise<void> {
  const ws = await workspace();
  const key = minutesKey(ws.id, month);
  if (await kv.exists(key)) return;
  const spent = await one<{ minutes: number }>(
    `SELECT COALESCE(SUM(minutes), 0)::int AS minutes FROM exports
      WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1 AND state NOT IN ('cancelled', 'failed')`,
    [month],
  );
  await kv.set(key, (ws.opening_month === month ? ws.opening_minutes : 0) + (spent?.minutes ?? 0), "EX", MINUTES_KEY_TTL_SECONDS, "NX");
}

async function ensureStorage(): Promise<void> {
  const ws = await workspace();
  const key = storageKey(ws.id);
  if (await kv.exists(key)) return;
  const stored = await one<{ bytes: number }>("SELECT COALESCE(SUM(bytes), 0)::bigint AS bytes FROM media");
  await kv.set(key, ws.carried_storage_bytes + (stored?.bytes ?? 0), "NX");
}

export async function ensureCounters(): Promise<void> {
  await ensureMinutes(currentMonth());
  await ensureStorage();
}

export async function allowance(): Promise<Allowance> {
  await ensureCounters();
  const ws = await workspace();
  const month = currentMonth();
  const [minutes, storage] = await Promise.all([kv.get(minutesKey(ws.id, month)), kv.get(storageKey(ws.id))]);
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const base = {
    workspace_id: ws.id,
    month,
    export_minutes_used: Number(minutes ?? 0),
    export_minutes_allowance: config.exportMinuteAllowance,
    storage_bytes_used: Number(storage ?? 0),
    storage_bytes_allowance: config.storageAllowanceBytes,
    resets_at: reset.toISOString(),
  };
  return { ...base, text: allowanceText(base) };
}

export function allowanceExceeded(current: Allowance): AppError {
  return new AppError(
    "allowance_exceeded",
    {
      minutes: current.export_minutes_used,
      minutes_allowance: current.export_minutes_allowance,
      gb: gigabytes(current.storage_bytes_used),
      gb_allowance: gigabytes(current.storage_bytes_allowance),
    },
    { allowance: current },
  );
}

async function publishAllowance(): Promise<void> {
  hub.toWorkspace({ type: "allowance", allowance: await allowance() });
}

/** Takes minutes from the month's shared counter in one atomic step; false when the allowance would pass. */
export async function takeMinutes(amount: number): Promise<boolean> {
  await ensureMinutes(currentMonth());
  const ws = await workspace();
  const [taken] = await kv.takeCounter(minutesKey(ws.id, currentMonth()), amount, config.exportMinuteAllowance);
  if (taken) void publishAllowance();
  return taken === 1;
}

export async function giveBackMinutes(amount: number, month: string): Promise<void> {
  const ws = await workspace();
  const key = minutesKey(ws.id, month);
  if (await kv.exists(key)) await kv.eval("local v=tonumber(redis.call('GET',KEYS[1])); redis.call('SET',KEYS[1],math.max(0,v-tonumber(ARGV[1])),'KEEPTTL')", 1, key, amount);
  void publishAllowance();
}

export async function takeStorage(bytes: number): Promise<boolean> {
  await ensureStorage();
  const ws = await workspace();
  const [taken] = await kv.takeCounter(storageKey(ws.id), bytes, config.storageAllowanceBytes);
  if (taken) void publishAllowance();
  return taken === 1;
}

export async function giveBackStorage(bytes: number): Promise<void> {
  const ws = await workspace();
  await kv.decrby(storageKey(ws.id), bytes);
  void publishAllowance();
}
