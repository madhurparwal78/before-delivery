// Stock: the single place batch counts and per-bar status are decided, from the
// movement ledger and the active holds.
import { type PoolClient } from "pg";
import { money, type TaxLine } from "../core/money.js";

export interface BatchRow {
  code: string;
  scent: string;
  state: string;
  poured_on: string;
  cure_days: number;
  bars_cut: number;
  drop_at: Date | null;
}

export interface StockCount {
  cut: number;
  sold: number;
  held: number;
  available: number;
}

export type BarStatus = "available" | "held" | "sold";

export interface BarView {
  number: number;
  status: BarStatus;
}

export interface BatchStock {
  counts: StockCount;
  bars: BarView[];
}

export type MovementKind = "cut" | "sale" | "restock";

export interface MovementRow {
  id: number;
  batch_code: string;
  kind: MovementKind;
  bars: number[];
  ref: string | null;
  at: Date;
}

/** The one derivation of stock from the ledger and the active holds. */
export async function batchStock(client: PoolClient, code: string, now: Date): Promise<BatchStock> {
  const movements = await client.query(
    "SELECT kind, bars FROM stock_movements WHERE batch_code = $1 ORDER BY id ASC",
    [code]
  );
  const rows = movements.rows as { kind: MovementKind; bars: number[] }[];
  const cutBars = new Set<number>();
  const barState = new Map<number, "sold" | "available">();
  for (const row of rows) {
    for (const bar of row.bars) {
      if (row.kind === "cut") {
        cutBars.add(bar);
        barState.set(bar, "available");
      } else if (row.kind === "sale") {
        barState.set(bar, "sold");
      } else if (row.kind === "restock") {
        barState.set(bar, "available");
      }
    }
  }
  const holds = await client.query(
    `SELECT bar FROM holds WHERE batch_code = $1 AND status = 'active' AND expires_at > $2`,
    [code, now]
  );
  const heldBars = new Set((holds.rows as { bar: number }[]).map((r) => r.bar));
  const bars: BarView[] = [];
  let sold = 0;
  let held = 0;
  let available = 0;
  for (const bar of [...cutBars].sort((a, b) => a - b)) {
    let status: BarStatus = barState.get(bar) ?? "available";
    if (heldBars.has(bar) && status === "available") {
      status = "held";
    }
    if (status === "sold") sold += 1;
    else if (status === "held") held += 1;
    else available += 1;
    bars.push({ number: bar, status });
  }
  return {
    counts: { cut: cutBars.size, sold, held, available },
    bars
  };
}

/** Write one movement row. */
export async function addMovement(
  client: PoolClient,
  code: string,
  kind: MovementKind,
  bars: number[],
  ref: string | null
): Promise<void> {
  await client.query(
    "INSERT INTO stock_movements (batch_code, kind, bars, ref) VALUES ($1, $2, $3, $4)",
    [code, kind, bars, ref]
  );
}

/** Serialize tax lines for JSON storage. */
export function taxLinesToJson(taxes: TaxLine[]): unknown {
  return taxes.map((tax) => ({
    code: tax.code,
    rate: tax.rateLabel,
    amount_cents: tax.amount.cents
  }));
}

export function taxLinesFromJson(value: unknown): TaxLine[] {
  const rows = (Array.isArray(value) ? value : []) as { code: "GST" | "QST" | "HST"; rate: string; amount_cents: number }[];
  return rows.map((row) => ({
    code: row.code,
    rateLabel: row.rate,
    rateHundredThousandths: rateToHundredThousandths(row.rate),
    amount: money(row.amount_cents)
  }));
}

function rateToHundredThousandths(rateLabel: string): number {
  const pct = Number(rateLabel.replace("%", ""));
  return Math.round(pct * 1000);
}

/** Refresh a batch's state after a sale or restock, per the state machine. */
export async function refreshBatchState(client: PoolClient, code: string, now: Date): Promise<void> {
  const batchRes = await client.query("SELECT state, bars_cut FROM batches WHERE code = $1 FOR UPDATE", [code]);
  const batch = batchRes.rows[0] as { state: string; bars_cut: number } | undefined;
  if (!batch) return;
  if (batch.state !== "live" && batch.state !== "sold_out") return;
  const stock = await batchStock(client, code, now);
  if (batch.state === "live" && stock.counts.sold === stock.counts.cut && stock.counts.cut > 0) {
    await client.query("UPDATE batches SET state = 'sold_out' WHERE code = $1", [code]);
  } else if (batch.state === "sold_out" && stock.counts.sold < stock.counts.cut) {
    await client.query("UPDATE batches SET state = 'live' WHERE code = $1", [code]);
  }
}
