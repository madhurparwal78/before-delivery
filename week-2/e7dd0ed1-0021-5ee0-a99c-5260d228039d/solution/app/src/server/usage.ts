// Usage metering (brief: Usage metering; Threshold alerts). Usage accrues into rows keyed by
// workspace, bucket, unit and window; windows are shared by every workspace and lie within one UTC hour.
import type pg from "pg";
import { one, pool, query, tx, type Db } from "./db.js";
import { truncateToSecond } from "./http.js";
import { enqueueMail, ownersOf } from "./mail.js";
import type { Bucket } from "./objects.js";
import { planOf, workspaceTotals } from "./objects.js";
import { formatCount } from "../shared/format.js";

export type Unit = "request-units" | "egress-gb" | "storage-gb-hours";
const DIVISOR: Record<Unit, bigint> = {
  "request-units": 1n,
  "egress-gb": 1_000_000_000n,
  "storage-gb-hours": 3_600_000_000_000n,
};

const WINDOW_LOCK = 4243;

// Amounts are computed exactly, rounded half up to 9 decimal places, and written with no exponent,
// no trailing zeros and a leading 0 below 1.
const NANO = 1_000_000_000n;

function formatNanos(nanos: bigint): string {
  const fraction = (nanos % NANO).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${nanos / NANO}.${fraction}` : `${nanos / NANO}`;
}

function amountOf(quantity: bigint, unit: Unit): string {
  const divisor = DIVISOR[unit];
  const scaled = quantity * NANO;
  const nanos = scaled / divisor + ((scaled % divisor) * 2n >= divisor ? 1n : 0n);
  return formatNanos(nanos);
}

export function sumAmounts(amounts: string[]): string {
  return formatNanos(amounts.reduce((sum, a) => {
    const [whole = "0", fraction = ""] = a.split(".");
    return sum + BigInt(whole) * NANO + BigInt(fraction.padEnd(9, "0"));
  }, 0n));
}

const trackingId = (slug: string, bucket: string, unit: Unit, windowStart: Date): string =>
  `fs-${slug}-${bucket}-${unit}-${windowStart.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;

const topOfHour = (at: Date): Date => new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);

// Records `quantity` of a unit for a bucket in the open window.
export async function meter(client: pg.PoolClient, bucket: Bucket, unit: Unit, quantity: number): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock_shared($1)", [WINDOW_LOCK]);
  const window = await one<{ start_at: Date; slug: string }>(client,
    `SELECT w.start_at, s.slug FROM usage_windows w, workspaces s WHERE w.end_at IS NULL AND s.id = $1`, [bucket.workspace_id]);
  if (!window) throw new Error("no open usage window");
  await client.query(
    `INSERT INTO usage_rows (tracking_id, workspace_id, bucket_id, bucket, unit, window_start, quantity, billing_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
     ON CONFLICT (tracking_id) DO UPDATE SET quantity = usage_rows.quantity + EXCLUDED.quantity`,
    [trackingId(window.slug, bucket.name, unit, window.start_at), bucket.workspace_id, bucket.id, bucket.name, unit,
      window.start_at, quantity]);
}

// One successful object read: one request unit and its body bytes as egress, then threshold alerts.
export async function meterRead(bucket: Bucket, bytes: number): Promise<void> {
  await tx(async (client) => {
    await meter(client, bucket, "request-units", 1);
    if (bytes > 0) await meter(client, bucket, "egress-gb", bytes);
  });
  await checkThresholds(bucket.workspace_id);
}

// A change of a bucket's stored bytes, at its acknowledgement second, for the storage integral.
export async function recordStorageChange(client: pg.PoolClient, bucketId: number, at: Date, delta: number): Promise<void> {
  await client.query("INSERT INTO storage_changes (bucket_id, at, delta) VALUES ($1, $2, $3)", [bucketId, truncateToSecond(at), delta]);
}

// Closes windows at each top of the hour, keeping one open window.
async function rollWindows(client: pg.PoolClient, now: Date): Promise<void> {
  const open = await one<{ start_at: Date }>(client, "SELECT start_at FROM usage_windows WHERE end_at IS NULL");
  if (!open) return;
  let start = open.start_at;
  const currentHour = topOfHour(now);
  while (topOfHour(start).getTime() < currentHour.getTime()) {
    const end = new Date(topOfHour(start).getTime() + 3_600_000);
    await client.query("UPDATE usage_windows SET end_at = $2 WHERE start_at = $1", [start, end]);
    await client.query("INSERT INTO usage_windows (start_at, end_at) VALUES ($1, NULL) ON CONFLICT DO NOTHING", [end]);
    start = end;
  }
}

export async function rollWindowsNow(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [WINDOW_LOCK]);
    await rollWindows(client, new Date());
  });
}

// Seals every window that has ended (and, for a manual sync, the open window at this second):
// open rows get their amount and queue for billing, and storage rows are computed from the integral.
export async function sealWindows(manual: boolean): Promise<number> {
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [WINDOW_LOCK]);
    const now = new Date();
    await rollWindows(client, now);
    if (manual) {
      const second = truncateToSecond(now);
      const open = await one<{ start_at: Date }>(client, "SELECT start_at FROM usage_windows WHERE end_at IS NULL");
      if (open && open.start_at.getTime() < second.getTime()) {
        await client.query("UPDATE usage_windows SET end_at = $2 WHERE start_at = $1", [open.start_at, second]);
        await client.query("INSERT INTO usage_windows (start_at) VALUES ($1)", [second]);
      }
    }
    let sealed = 0;
    const rows = await query<{ tracking_id: string; unit: Unit; quantity: string; end_at: Date }>(client,
      `SELECT r.tracking_id, r.unit, r.quantity::text AS quantity, w.end_at FROM usage_rows r
       JOIN usage_windows w ON w.start_at = r.window_start WHERE r.billing_state = 'open' AND w.end_at IS NOT NULL`);
    for (const row of rows) {
      const amount = amountOf(BigInt(row.quantity), row.unit);
      if (amount === "0") {
        await client.query("DELETE FROM usage_rows WHERE tracking_id = $1", [row.tracking_id]);
        continue;
      }
      await client.query("UPDATE usage_rows SET window_end = $2, amount = $3, billing_state = 'queued' WHERE tracking_id = $1",
        [row.tracking_id, row.end_at, amount]);
      sealed += 1;
    }
    const windows = await query<{ start_at: Date; end_at: Date }>(client,
      `SELECT start_at, end_at FROM usage_windows WHERE end_at IS NOT NULL
       AND end_at > (SELECT coalesce(min(coalesce(storage_sealed_through, created_at)), now()) FROM buckets)
       ORDER BY start_at`);
    for (const w of windows) sealed += await sealStorage(client, w.start_at, w.end_at);
    return sealed;
  });
}

// storage-gb-hours for one window: the sum of each bucket's stored bytes over every whole second
// from window start (included) to window end (excluded), divided by 3,600,000,000,000.
async function sealStorage(client: pg.PoolClient, start: Date, end: Date): Promise<number> {
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  const integrals = await query<{ id: number; name: string; slug: string; workspace_id: string; byte_seconds: string }>(client,
    `SELECT b.id, b.name, w.slug, b.workspace_id,
       (coalesce((SELECT sum(delta) FROM storage_changes c WHERE c.bucket_id = b.id AND c.at <= $1), 0) * $3
        + coalesce((SELECT sum(c.delta * extract(epoch FROM ($2::timestamptz - c.at)))
                    FROM storage_changes c WHERE c.bucket_id = b.id AND c.at > $1 AND c.at < $2), 0))::numeric(40,0)::text AS byte_seconds
     FROM buckets b JOIN workspaces w ON w.id = b.workspace_id
     WHERE b.created_at < $2 AND coalesce(b.storage_sealed_through, '-infinity') < $2`, [start, end, seconds]);
  let sealed = 0;
  for (const bucket of integrals) {
    const amount = amountOf(BigInt(bucket.byte_seconds), "storage-gb-hours");
    if (amount !== "0") {
      await client.query(
        `INSERT INTO usage_rows (tracking_id, workspace_id, bucket_id, bucket, unit, window_start, window_end, quantity, amount, billing_state)
         VALUES ($1, $2, $3, $4, 'storage-gb-hours', $5, $6, $7, $8, 'queued') ON CONFLICT DO NOTHING`,
        [trackingId(bucket.slug, bucket.name, "storage-gb-hours", start), bucket.workspace_id, bucket.id, bucket.name, start, end,
          bucket.byte_seconds, amount]);
      sealed += 1;
    }
  }
  if (integrals.length) {
    await client.query("UPDATE buckets SET storage_sealed_through = $2 WHERE id = ANY($1)", [integrals.map((b) => b.id), end]);
  }
  return sealed;
}

// ---- Usage views ----

export interface UsageRow {
  window_start: Date;
  window_end: Date | null;
  bucket: string;
  unit: Unit;
  quantity: string;
  amount: string | null;
  tracking_id: string;
  billing_state: "open" | "queued" | "posted";
}

export const periodOf = (at: Date): string => at.toISOString().slice(0, 7);
const periodBounds = (period: string): [Date, Date] => {
  const [year = 0, month = 1] = period.split("-").map(Number);
  return [new Date(Date.UTC(year, month - 1, 1)), new Date(Date.UTC(year, month, 1))];
};

export function rowAmount(row: UsageRow): string {
  return row.amount ?? amountOf(BigInt(row.quantity), row.unit);
}

// An open row's window ends at the next top of the hour unless a manual sync seals it earlier.
export const rowEnd = (row: UsageRow): Date => row.window_end ?? new Date(topOfHour(row.window_start).getTime() + 3_600_000);

export async function usageRows(db: Db, workspaceId: string, period: string, order: "newest" | "export"): Promise<UsageRow[]> {
  const [from, to] = periodBounds(period);
  return query<UsageRow>(db,
    `SELECT window_start, window_end, bucket, unit, quantity::text AS quantity, amount::text AS amount, tracking_id, billing_state
     FROM usage_rows WHERE workspace_id = $1 AND window_start >= $2 AND window_start < $3
     ORDER BY ${order === "newest" ? "window_start DESC, bucket COLLATE \"C\", unit" : "window_start, bucket COLLATE \"C\", unit"}`,
    [workspaceId, from, to]);
}

interface MonthToDate {
  egressBytes: number;
  requestUnits: number;
  storageAmounts: string[];
}

export async function monthToDate(db: Db, workspaceId: string, period: string): Promise<MonthToDate> {
  const [from, to] = periodBounds(period);
  const rows = await query<{ unit: Unit; quantity: string; amount: string | null }>(db,
    `SELECT unit, quantity::text AS quantity, amount::text AS amount FROM usage_rows
     WHERE workspace_id = $1 AND window_start >= $2 AND window_start < $3`, [workspaceId, from, to]);
  let egress = 0n;
  let requests = 0n;
  const storage: string[] = [];
  for (const r of rows) {
    if (r.unit === "egress-gb") egress += BigInt(r.quantity);
    else if (r.unit === "request-units") requests += BigInt(r.quantity);
    else storage.push(r.amount ?? amountOf(BigInt(r.quantity), r.unit));
  }
  return { egressBytes: Number(egress), requestUnits: Number(requests), storageAmounts: storage };
}

// A percent of an included amount, rounded half up to one decimal place.
export function percentOf(value: number, included: number): number {
  const tenths = (BigInt(value) * 2000n / BigInt(included) + 1n) / 2n;
  return Number(tenths) / 10;
}

// ---- Threshold alerts ----

const THRESHOLDS = [80, 100] as const;

export async function checkThresholds(workspaceId: string): Promise<void> {
  const workspace = await one<{ name: string; plan_id: string }>(pool, "SELECT name, plan_id FROM workspaces WHERE id = $1", [workspaceId]);
  if (!workspace) return;
  const plan = planOf(workspace.plan_id);
  const period = periodOf(new Date());
  const totals = await workspaceTotals(pool, workspaceId);
  const usage = await monthToDate(pool, workspaceId, period);
  const metrics = [
    { metric: "storage", value: totals.stored_bytes, included: plan.includedStorageBytes },
    { metric: "egress", value: usage.egressBytes, included: plan.includedEgressBytes },
  ] as const;
  for (const { metric, value, included } of metrics) {
    for (const threshold of THRESHOLDS) {
      if (value * 100 < included * threshold) continue;
      await tx(async (client) => {
        const inserted = await one(client,
          `INSERT INTO threshold_alerts (workspace_id, period, metric, threshold) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING RETURNING 1`, [workspaceId, period, metric, threshold]);
        if (!inserted) return;
        for (const owner of await ownersOf(client, workspaceId)) {
          await enqueueMail(client, owner.email, `${workspace.name} has used ${threshold}% of included ${metric}`,
            [`${workspace.name} has used ${threshold}% of the ${metric} included in its plan this month.`, "",
              `Current ${metric}: ${formatCount(value)} bytes`, `Included ${metric}: ${formatCount(included)} bytes`].join("\n"));
        }
      });
    }
  }
}
