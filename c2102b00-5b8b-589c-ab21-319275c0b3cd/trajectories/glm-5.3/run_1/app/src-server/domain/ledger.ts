import { all, one, run, tx } from "../db";
import { HouseholdRow, PledgeRow } from "../db";
import { unitHoldCents } from "./club";
import { ProductRow } from "../db";

export interface Credit {
  balance_cents: number;
  held_cents: number;
  spendable_cents: number;
}

export interface Movement {
  id: number;
  kind: string;
  cycle_id: string | null;
  memo: string;
  created_at: number;
  legs: { account: string; amount_cents: number }[];
}

/** The single place that decides spendable credit. */
export function creditOf(code: string): Credit {
  const bal = one<{ b: number }>(
    "SELECT COALESCE(SUM(l.amount_cents), 0) AS b FROM legs l WHERE l.account = ?",
    `household:${code}`
  );
  const balance = bal?.b ?? 0;
  const holds = heldCents(code, Math.floor(Date.now() / 1000));
  return { balance_cents: balance, held_cents: holds, spendable_cents: balance - holds };
}

export interface HoldRow {
  cycle_id: string;
  product_id: string;
  household_code: string;
  units: number;
  price_cents: number;
  pack: number;
}

/** Sum of the household's pledge holds on cycles that are not closed. */
export function heldCents(code: string, nowSec: number): number {
  const rows = all<HoldRow & { cycle_status: string; line_status: string }>(
    `SELECT p.cycle_id, p.product_id, p.household_code, p.units, pr.price_cents, pr.pack,
            c.status AS cycle_status, l.status AS line_status
     FROM pledges p
     JOIN products pr ON pr.id = p.product_id
     JOIN cycles c ON c.id = p.cycle_id
     LEFT JOIN lines l ON l.cycle_id = p.cycle_id AND l.product_id = p.product_id
     WHERE p.household_code = ?`,
    code
  );
  let total = 0;
  for (const r of rows) {
    if (r.cycle_status === "closed") continue;
    if (r.line_status === "dropped") continue;
    total += r.units * unitHoldCents(r.price_cents, r.pack);
  }
  return total;
}

export function movementsOf(code: string, beforeId: number | null, limit: number): { movements: Movement[]; nextBefore: number | null; total: number } {
  const total = one<{ n: number }>("SELECT COUNT(*) AS n FROM movements WHERE household_code = ?", code)?.n ?? 0;
  let rows: { id: number; kind: string; cycle_id: string | null; memo: string; created_at: number }[];
  if (beforeId === null) {
    rows = all(
      "SELECT id, kind, cycle_id, memo, created_at FROM movements WHERE household_code = ? ORDER BY id DESC LIMIT ?",
      code, limit
    );
  } else {
    rows = all(
      "SELECT id, kind, cycle_id, memo, created_at FROM movements WHERE household_code = ? AND id < ? ORDER BY id DESC LIMIT ?",
      code, beforeId, limit
    );
  }
  const ids = rows.map((r) => r.id);
  const legs = ids.length
    ? all<{ movement_id: number; account: string; amount_cents: number }>(
        `SELECT movement_id, account, amount_cents FROM legs WHERE movement_id IN (${ids.map(() => "?").join(",")}) ORDER BY rowid`,
        ...ids
      )
    : [];
  const byMove = new Map<number, { account: string; amount_cents: number }[]>();
  for (const l of legs) {
    const list = byMove.get(l.movement_id) ?? [];
    list.push({ account: l.account, amount_cents: l.amount_cents });
    byMove.set(l.movement_id, list);
  }
  const movements: Movement[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    cycle_id: r.cycle_id,
    memo: r.memo,
    created_at: r.created_at,
    legs: byMove.get(r.id) ?? [],
  }));
  const nextBefore = movements.length === limit && movements.length < total ? movements[movements.length - 1].id : null;
  return { movements, nextBefore, total };
}

/** Writes one movement of two legs. Must be called inside a transaction. */
export function writeMovement(
  householdCode: string,
  kind: "carried_forward" | "top_up" | "pledge_charge" | "short_credit" | "take_up_charge",
  cycleId: string | null,
  memo: string,
  createdAt: number,
  debitAccount: string,
  creditAccount: string,
  amountCents: number
): number {
  const m = run(
    "INSERT INTO movements (household_code, kind, cycle_id, memo, created_at) VALUES (?, ?, ?, ?, ?)",
    householdCode, kind, cycleId, memo, createdAt
  );
  run("INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)", m.lastInsertRowid, debitAccount, amountCents);
  run("INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)", m.lastInsertRowid, creditAccount, -amountCents);
  return m.lastInsertRowid;
}
