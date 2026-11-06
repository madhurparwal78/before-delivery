import { query, one, withTransaction, type Tx } from "../db.js";
import { errors } from "../http/errors.js";
import { randomToken } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";
import { officeDateFor } from "./bookings.js";
import { createCredit, createOrGetAccount, BillingOutage } from "./killbill.js";
import type { SessionMember } from "./sessions.js";

/** The paired ledger: every movement sums to zero, reversals mirror, balances derive from entries. */

export interface MovementRow {
  id: string;
  kind: string;
  reference: string;
  talent_id: string | null;
  booking_id: string | null;
  reversal_of: string | null;
  reversed_by_movement: string | null;
  reversed_by_name: string | null;
  reversed_at: Date | null;
  created_by: string;
  created_at: Date;
  office_date: string;
  reason: string | null;
}

export async function recordAdvance(talentId: string, amountCents: number, note: string, member: SessionMember, now: Date, office: string): Promise<MovementRow> {
  return withTransaction(async (tx) => {
    const talent = await tx.one<{ id: string; state: string }>(`SELECT id, state FROM talent WHERE id = $1`, [talentId]);
    if (!talent || talent.state === "erased") throw errors.notFound();
    const movementId = `mov_${randomToken(12)}`;
    const officeDate = officeDateFor(office, now);
    await tx.query(
      `INSERT INTO ledger_movements (id, kind, reference, talent_id, created_by, created_at, office_date, reason)
       VALUES ($1, 'advance', $2, $3, $4, $5, $6, $7)`,
      [movementId, `ADV-${randomToken(6).toUpperCase()}`, talentId, member.id, now, officeDate, note]
    );
    await writeEntries(tx, movementId, [
      [`talent:${talentId}`, -amountCents],
      ["agency_cash", amountCents],
    ]);
    const row = await tx.one<MovementRow>(`SELECT *, to_char(office_date,'YYYY-MM-DD') AS office_date FROM ledger_movements WHERE id = $1`, [movementId]);
    if (!row) throw new Error("movement missing");
    return row;
  });
}

async function writeEntries(tx: Tx, movementId: string, entries: Array<[string, number]>): Promise<void> {
  for (const [account, amount] of entries) {
    await tx.query(`INSERT INTO ledger_entries (id, movement_id, account, amount_cents) VALUES ($1, $2, $3, $4)`, [`le_${randomToken(10)}`, movementId, account, amount]);
  }
}

export async function movementEntries(movementIds: string[]): Promise<Map<string, Array<{ account: string; amountCents: number }>>> {
  if (movementIds.length === 0) return new Map();
  const rows = await query<{ movement_id: string; account: string; amount_cents: number }>(
    `SELECT movement_id, account, amount_cents FROM ledger_entries WHERE movement_id = ANY($1::text[])`,
    [movementIds]
  );
  const map = new Map<string, Array<{ account: string; amountCents: number }>>();
  for (const r of rows) {
    const list = map.get(r.movement_id) || [];
    list.push({ account: r.account, amountCents: r.amount_cents });
    map.set(r.movement_id, list);
  }
  return map;
}

export function movementView(row: MovementRow, entries: Array<{ account: string; amountCents: number }>): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    reference: row.reference,
    talentId: row.talent_id,
    bookingId: row.booking_id,
    reversalOf: row.reversal_of,
    reversedBy: row.reversed_by_movement ? { id: row.reversed_by_movement, name: row.reversed_by_name } : null,
    createdBy: row.created_by,
    createdAt: toInstant(row.created_at),
    officeDate: row.office_date,
    reason: row.reason,
    entries: entries.map((e) => ({ account: e.account, amountCents: e.amountCents })),
  };
}

export async function talentBalanceCents(talentId: string): Promise<number> {
  const row = await one<{ total: number | null }>(
    `SELECT SUM(amount_cents) AS total FROM ledger_entries WHERE account = $1`,
    [`talent:${talentId}`]
  );
  return row?.total ?? 0;
}

export async function ledgerForTalent(talentId: string): Promise<{ balanceCents: number; movements: Array<Record<string, unknown>> }> {
  const rows = await query<MovementRow & { created_by_name: string }>(
    `SELECT m.*, to_char(m.office_date,'YYYY-MM-DD') AS office_date, mm.name AS created_by_name
     FROM ledger_movements m JOIN members mm ON mm.id = m.created_by
     WHERE m.talent_id = $1
        OR m.booking_id IN (SELECT booking_id FROM booking_talent WHERE talent_id = $1)
        OR m.id IN (SELECT reversal_of FROM ledger_movements WHERE talent_id = $1 OR booking_id IN (SELECT booking_id FROM booking_talent WHERE talent_id = $1))
     ORDER BY m.created_at, m.id`,
    [talentId]
  );
  const entries = await movementEntries(rows.map((r) => r.id));
  const movements: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    movements.push(movementView(row, entries.get(row.id) || []));
  }
  return { balanceCents: await talentBalanceCents(talentId), movements };
}

/** Reverses a movement: writes the mirror, marks the original, records the Kill Bill credit together. */
export async function reverseMovement(movementId: string, reason: string, member: SessionMember, now: Date): Promise<MovementRow> {
  return withTransaction(async (tx) => {
    const original = await tx.one<MovementRow & { created_by_name: string }>(`SELECT m.*, to_char(m.office_date,'YYYY-MM-DD') AS office_date, mm.name AS created_by_name FROM ledger_movements m JOIN members mm ON mm.id = m.created_by WHERE m.id = $1`, [movementId]);
    if (!original) throw errors.notFound();
    if (original.reversed_by_movement) {
      const by = await tx.one<{ name: string }>(`SELECT name FROM members WHERE id = (SELECT created_by FROM ledger_movements WHERE id = $1)`, [original.reversed_by_movement]);
      throw errors.conflict("already_reversed", { reversedBy: by?.name || "", reversedAt: toInstant(original.reversed_at || now) });
    }
    if (original.reversal_of) throw errors.conflict("already_reversed", { reversedBy: "", reversedAt: toInstant(now) });
    if (original.kind === "booking") {
      const booking = original.booking_id ? await tx.one<{ state: string; total_cents: number; reference: string; client_id: string }>(`SELECT state, total_cents, reference, client_id FROM bookings WHERE id = $1`, [original.booking_id]) : null;
      if (!booking || booking.state !== "invoiced") throw errors.conflict("not_invoiced");
    }
    const entries = await tx.query<{ account: string; amount_cents: number }>(`SELECT account, amount_cents FROM ledger_entries WHERE movement_id = $1`, [movementId]);
    // Kill Bill credit first (mirrors the confirm rule: nothing is written when billing is down)
    if (original.kind === "booking") {
      const booking = (await tx.one<{ total_cents: number; client_id: string }>(`SELECT total_cents, client_id FROM bookings WHERE id = $1`, [original.booking_id]))!;
      const client = await tx.one<{ slug: string; company: string; contact_email: string }>(`SELECT slug, company, contact_email FROM clients WHERE id = $1`, [booking.client_id]);
      if (!client) throw errors.notFound();
      try {
        const account = await createOrGetAccount(`rungboard-client-${client.slug}`, client.company, client.contact_email);
        await createCredit(account.accountId, `Reversal of ${original.reference}`, booking.total_cents);
      } catch (err) {
        if (err instanceof BillingOutage) throw errors.billingUnavailable();
        throw err;
      }
    }
    const reversalId = `mov_${randomToken(12)}`;
    await tx.query(
      `INSERT INTO ledger_movements (id, kind, reference, talent_id, booking_id, reversal_of, created_by, created_at, office_date, reason)
       VALUES ($1, 'reversal', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [reversalId, `REV-${randomToken(6).toUpperCase()}`, original.talent_id, original.booking_id, original.id, member.id, now, original.office_date, reason]
    );
    for (const entry of entries) {
      await tx.query(`INSERT INTO ledger_entries (id, movement_id, account, amount_cents) VALUES ($1, $2, $3, $4)`, [`le_${randomToken(10)}`, reversalId, entry.account, -entry.amount_cents]);
    }
    await tx.query(`UPDATE ledger_movements SET reversed_by_movement = $2, reversed_by_name = $3, reversed_at = $4 WHERE id = $1`, [original.id, reversalId, member.name, now]);
    if (original.booking_id) {
      await tx.query(`UPDATE bookings SET state = 'corrected' WHERE id = $1 AND state = 'invoiced'`, [original.booking_id]);
    }
    const row = await tx.one<MovementRow>(`SELECT *, to_char(office_date,'YYYY-MM-DD') AS office_date FROM ledger_movements WHERE id = $1`, [reversalId]);
    if (!row) throw new Error("reversal missing");
    return row;
  });
}

export interface StatementLine {
  movementId: string;
  officeDate: string;
  kind: string;
  reference: string;
  client: string;
  description: string;
  amountCents: number;
  balanceCents: number;
}

export interface AdvanceSummary {
  movementId: string;
  amountCents: number;
  recoupedCents: number;
  outstandingCents: number;
}

export interface Statement {
  talentId: string;
  displayName: string;
  month: string;
  openingBalanceCents: number;
  lines: StatementLine[];
  totals: { earningsCents: number; advancesCents: number; reversalsCents: number; netCents: number };
  closingBalanceCents: number;
  advances: AdvanceSummary[];
}

/** Builds a statement for one office calendar month. Totals are recomputed on every read. */
export async function buildStatement(talentId: string, month: string, office: string): Promise<Statement> {
  const [y, m] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEndDate = new Date(Date.UTC(y, m, 0));
  const monthEnd = `${monthEndDate.getUTCFullYear()}-${String(monthEndDate.getUTCMonth() + 1).padStart(2, "0")}-${String(monthEndDate.getUTCDate()).padStart(2, "0")}`;
  const rows = await query<MovementRow & { created_by_name: string }>(
    `SELECT m.*, to_char(m.office_date,'YYYY-MM-DD') AS office_date, mm.name AS created_by_name
     FROM ledger_movements m JOIN members mm ON mm.id = m.created_by
     WHERE m.talent_id = $1
     ORDER BY m.office_date, m.created_at, m.id`,
    [talentId]
  );
  const talent = await one<{ display_name: string }>(`SELECT display_name FROM talent WHERE id = $1`, [talentId]);
  void office;
  const lines: StatementLine[] = [];
  let opening = 0;
  let running = 0;
  const sortedRows = [...rows].sort((a, b) => (a.office_date < b.office_date ? -1 : a.office_date > b.office_date ? 1 : a.created_at < b.created_at ? -1 : 1));
  for (const row of sortedRows) {
    const amount = await talentAmountFor(row);
    if (row.office_date < monthStart) {
      opening += amount;
      continue;
    }
    if (row.office_date > monthEnd) continue;
    running += amount;
    lines.push({
      movementId: row.id,
      officeDate: row.office_date,
      kind: row.kind,
      reference: row.reference,
      client: await clientForMovement(row),
      description: descriptionFor(row),
      amountCents: amount,
      balanceCents: opening + running,
    });
  }
  const earnings = lines.filter((l) => l.kind === "booking").reduce((a, l) => a + l.amountCents, 0);
  const advances = lines.filter((l) => l.kind === "advance").reduce((a, l) => a + l.amountCents, 0);
  const reversals = lines.filter((l) => l.kind === "reversal").reduce((a, l) => a + l.amountCents, 0);
  const net = lines.reduce((a, l) => a + l.amountCents, 0);
  const closing = opening + net;
  const advancesOut = await advanceSummaries(sortedRows);
  return {
    talentId,
    displayName: talent?.display_name || "",
    month,
    openingBalanceCents: opening,
    lines,
    totals: { earningsCents: earnings, advancesCents: advances, reversalsCents: reversals, netCents: net },
    closingBalanceCents: closing,
    advances: advancesOut,
  };
}

async function talentAmountFor(row: MovementRow): Promise<number> {
  if (!row.talent_id) return 0;
  const entry = await one<{ amount_cents: number }>(`SELECT amount_cents FROM ledger_entries WHERE movement_id = $1 AND account = $2`, [row.id, `talent:${row.talent_id}`]);
  return entry?.amount_cents ?? 0;
}

async function clientForMovement(row: MovementRow): Promise<string> {
  if (row.booking_id) {
    const booking = await one<{ company: string }>(`SELECT c.company FROM bookings b JOIN clients c ON c.id = b.client_id WHERE b.id = $1`, [row.booking_id]);
    return booking?.company || "";
  }
  return "";
}

function descriptionFor(row: MovementRow): string {
  if (row.kind === "booking") return "Booking";
  if (row.kind === "advance") return row.reason || "Advance";
  if (row.kind === "reversal") return row.reason || "Reversal";
  return row.reference;
}

/** Recoupment: booking earnings net of reversals applied to unreversed advances oldest first. */
async function advanceSummaries(rows: MovementRow[]): Promise<AdvanceSummary[]> {
  const advances = rows.filter((r) => r.kind === "advance" && !r.reversed_by_movement);
  if (advances.length === 0) return [];
  const out: AdvanceSummary[] = [];
  let earnings = 0;
  for (const row of rows) {
    if (row.kind === "booking") earnings += (await talentAmountFor(row)) || 0;
    if (row.kind === "reversal") earnings += (await talentAmountFor(row)) || 0;
  }
  let remaining = earnings;
  for (const advance of advances) {
    const amount = Math.abs(await talentAmountFor(advance));
    const recouped = Math.max(0, Math.min(amount, remaining));
    remaining -= recouped;
    out.push({ movementId: advance.id, amountCents: amount, recoupedCents: recouped, outstandingCents: amount - recouped });
  }
  return out;
}

export const STATEMENT_CSV_HEADER = ["Date", "Type", "Reference", "Client", "Description", "Amount (CAD)", "Balance (CAD)"];

export function csvQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Neutralises text cells that begin with a formula trigger. */
export function neutralise(text: string): string {
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

export function statementCsv(statement: Statement): string {
  const rows: string[][] = [STATEMENT_CSV_HEADER];
  for (const line of statement.lines) {
    rows.push([
      line.officeDate,
      line.kind === "booking" ? "Booking" : line.kind === "advance" ? "Advance" : "Reversal",
      line.reference,
      line.client,
      line.description,
      money(line.amountCents),
      money(line.balanceCents),
    ]);
  }
  const out = rows.map((r) => r.map((cell, i) => (i >= 2 && i <= 4 ? csvQuote(neutralise(cell)) : csvQuote(cell))).join(","));
  return out.join("\r\n") + "\r\n";
}

function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
