// The ledger: movements of two legs that sum to zero, never edited. A household's balance is the
// sum of its legs; its credit history pages newest first by (created_at, id).
import { all, one, run } from "./db.js";
import { ApiError } from "./errors.js";

type MovementKind = "carried_forward" | "top_up" | "pledge_charge" | "short_credit" | "take_up_charge";

export const householdAccount = (code: string) => `household:${code}`;

/** `created_at` for a new movement: now, but never earlier than the latest movement, so pages stay stable. */
export function movementTime(now = new Date()): string {
  const latest = one<{ at: string | null }>("SELECT MAX(created_at) AS at FROM movements")?.at ?? "";
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return stamp > latest ? stamp : latest;
}

/** Writes one movement; `credit` gains the amount and `debit` loses it. */
export function writeMovement(
  kind: MovementKind,
  memo: string,
  amountCents: number,
  credit: string,
  debit: string,
  cycleId: string | null = null,
  createdAt = movementTime(),
): number {
  const { lastId } = run(
    "INSERT INTO movements (kind, cycle_id, memo, created_at) VALUES (?, ?, ?, ?)",
    kind, cycleId, memo, createdAt,
  );
  run("INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)", lastId, credit, amountCents);
  run("INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)", lastId, debit, -amountCents);
  return lastId;
}

export function balanceOf(code: string): number {
  return (
    one<{ total: number | null }>("SELECT SUM(amount_cents) AS total FROM legs WHERE account = ?", householdAccount(code))
      ?.total ?? 0
  );
}

interface MovementRow {
  id: number;
  kind: string;
  cycle_id: string | null;
  memo: string;
  created_at: string;
}

function encodeCursor(row: { id: number; created_at: string }): string {
  return Buffer.from(`${row.id}|${row.created_at}`).toString("base64url");
}

/** The movement a cursor names, or a 422 when the server could not have issued it. */
function decodeCursor(code: string, cursor: string): { id: number; created_at: string } {
  const text = /^[A-Za-z0-9_-]+$/.test(cursor) ? Buffer.from(cursor, "base64url").toString() : "";
  const match = /^(\d+)\|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/.exec(text);
  const found = match
    ? one<{ id: number; created_at: string }>(
        `SELECT m.id, m.created_at FROM movements m JOIN legs l ON l.movement_id = m.id
         WHERE m.id = ? AND m.created_at = ? AND l.account = ?`,
        Number(match[1]), match[2]!, householdAccount(code),
      )
    : undefined;
  if (!found) throw new ApiError(422, "validation", "Some fields need fixing.", { before: "That page marker isn't valid." });
  return found;
}

export function historyPage(code: string, limit: number, before: string | null) {
  const account = householdAccount(code);
  const cursor = before === null ? null : decodeCursor(code, before);
  const rows = cursor
    ? all<MovementRow>(
        `SELECT m.* FROM movements m JOIN legs l ON l.movement_id = m.id WHERE l.account = ?
         AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
         ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
        account, cursor.created_at, cursor.created_at, cursor.id, limit + 1,
      )
    : all<MovementRow>(
        `SELECT m.* FROM movements m JOIN legs l ON l.movement_id = m.id WHERE l.account = ?
         ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
        account, limit + 1,
      );
  const page = rows.slice(0, limit);
  const total = one<{ n: number }>("SELECT COUNT(*) AS n FROM legs WHERE account = ?", account)?.n ?? 0;
  return {
    total_movements: total,
    next_before: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
    movements: page.map((m) => ({
      id: m.id,
      kind: m.kind,
      cycle_id: m.cycle_id,
      memo: m.memo,
      created_at: m.created_at,
      legs: all<{ account: string; amount_cents: number }>(
        "SELECT account, amount_cents FROM legs WHERE movement_id = ? ORDER BY amount_cents DESC",
        m.id,
      ),
    })),
  };
}
