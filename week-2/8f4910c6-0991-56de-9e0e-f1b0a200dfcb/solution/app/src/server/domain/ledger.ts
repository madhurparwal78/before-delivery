// The paired ledger: booking, advance and reversal movements whose entries sum to zero, talent balances,
// advance recoupment, monthly statements and the statement CSV.

import type { PoolClient } from "pg";
import { exec, one, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, json, type MemberCtx } from "../http.js";
import { FieldErrors, conflict, isoInstant, notFound, optionalInstant, required } from "../errors.js";
import { accountFor, billingClient, credit } from "../killbill.js";
import { putObject } from "../storage.js";
import { csv, number, text } from "../csv.js";
import { asObject, isWholeNumber, newId, nextCounter, str } from "../util.js";
import { plainAmount } from "../../shared/format.js";
import { isMonth, lastDayOfMonth, officeToday, type OfficeId } from "../../shared/zones.js";

type Kind = "booking" | "advance" | "reversal";

interface MovementRow {
  id: string;
  kind: Kind;
  reference: string;
  talent_id: string;
  booking_id: string | null;
  reversal_of: string | null;
  reversed_by: string | null;
  reversed_at: Date | null;
  note: string;
  created_by: string;
  created_at: Date;
  office_date: string;
}

interface Entry {
  account: string;
  amountCents: number;
}

interface TalentRow {
  id: string;
  slug: string;
  display_name: string;
  office_id: OfficeId;
}

async function entriesOf(db: Db, movementIds: string[]): Promise<Map<string, Entry[]>> {
  const found = await rows<{ movement_id: string; account: string; amount_cents: number }>(
    db, "SELECT movement_id, account, amount_cents FROM entries WHERE movement_id = ANY($1) ORDER BY movement_id, position",
    [movementIds]);
  const byMovement = new Map<string, Entry[]>(movementIds.map((id) => [id, []]));
  for (const entry of found) byMovement.get(entry.movement_id)?.push({ account: entry.account, amountCents: entry.amount_cents });
  return byMovement;
}

function movementBody(row: MovementRow, entries: Entry[]): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    reference: row.reference,
    talentId: row.talent_id,
    bookingId: row.booking_id,
    reversalOf: row.reversal_of,
    reversedBy: row.reversed_by,
    createdBy: row.created_by,
    createdAt: isoInstant(row.created_at),
    officeDate: row.office_date,
    entries,
  };
}

async function movementReply(db: Db, id: string): Promise<Record<string, unknown>> {
  const row = await one<MovementRow>(db, "SELECT * FROM movements WHERE id = $1", [id]);
  if (!row) throw new Error(`movement ${id} vanished`);
  return movementBody(row, (await entriesOf(db, [id])).get(id) ?? []);
}

/** A movement as one talent sees it: their own amount, the client and a description. */
interface TalentLine {
  movement: MovementRow;
  amountCents: number;
  client: string;
  description: string;
  reversedBooking: boolean;
}

async function talentLines(db: Db, talentId: string): Promise<TalentLine[]> {
  const found = await rows<MovementRow & { amount: number; company: string | null; original_kind: Kind | null;
    original_reference: string | null }>(
    db,
    `SELECT m.*, sum(e.amount_cents)::bigint AS amount, c.company, o.kind AS original_kind, o.reference AS original_reference
       FROM movements m JOIN entries e ON e.movement_id = m.id AND e.account = $1
       LEFT JOIN bookings b ON b.id = m.booking_id LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN movements o ON o.id = m.reversal_of
      GROUP BY m.id, c.company, o.kind, o.reference
      ORDER BY m.office_date, m.created_at, m.reference`,
    [`talent:${talentId}`],
  );
  return found.map((row) => ({
    movement: row,
    amountCents: row.amount,
    client: row.company ?? "",
    description: row.kind === "reversal" ? `Reversal of ${row.original_reference}${row.note ? `: ${row.note}` : ""}` : row.note,
    reversedBooking: row.kind === "reversal" && row.original_kind === "booking",
  }));
}

/**
 * Recoupment as of a day: booking earnings net of their reversals, applied to the unreversed advances oldest first.
 */
function recoupment(lines: TalentLine[], asOf: string): Array<{ movementId: string; amountCents: number;
  recoupedCents: number; outstandingCents: number }> {
  const upTo = lines.filter((line) => line.movement.office_date <= asOf);
  let earnings = upTo.filter((line) => line.movement.kind === "booking" || line.reversedBooking)
    .reduce((sum, line) => sum + line.amountCents, 0);
  const reversed = new Set(upTo.filter((line) => line.movement.kind === "reversal").map((line) => line.movement.reversal_of));
  return upTo
    .filter((line) => line.movement.kind === "advance" && !reversed.has(line.movement.id))
    .map((line) => {
      const amount = -line.amountCents;
      const recouped = Math.max(0, Math.min(amount, earnings));
      earnings -= recouped;
      return { movementId: line.movement.id, amountCents: amount, recoupedCents: recouped, outstandingCents: amount - recouped };
    });
}

interface StatementLine {
  movementId: string;
  officeDate: string;
  kind: Kind;
  reference: string;
  client: string;
  description: string;
  amountCents: number;
  balanceCents: number;
}

interface Statement {
  talentId: string;
  displayName: string;
  month: string;
  openingBalanceCents: number;
  lines: StatementLine[];
  totals: { earningsCents: number; advancesCents: number; reversalsCents: number; netCents: number };
  closingBalanceCents: number;
  advances: Array<{ movementId: string; amountCents: number; recoupedCents: number; outstandingCents: number }>;
}

/** One office calendar month; totals recomputed on every read. */
async function statement(db: Db, talent: TalentRow, month: string): Promise<Statement> {
  const all = await talentLines(db, talent.id);
  const start = `${month}-01`;
  const end = lastDayOfMonth(month);
  const openingBalanceCents = all.filter((line) => line.movement.office_date < start)
    .reduce((sum, line) => sum + line.amountCents, 0);
  let running = openingBalanceCents;
  const totals = { earningsCents: 0, advancesCents: 0, reversalsCents: 0, netCents: 0 };
  const lines = all.filter((line) => line.movement.office_date >= start && line.movement.office_date <= end).map((line) => {
    running += line.amountCents;
    totals.netCents += line.amountCents;
    if (line.movement.kind === "booking") totals.earningsCents += line.amountCents;
    if (line.movement.kind === "advance") totals.advancesCents += line.amountCents;
    if (line.movement.kind === "reversal") totals.reversalsCents += line.amountCents;
    return {
      movementId: line.movement.id,
      officeDate: line.movement.office_date,
      kind: line.movement.kind,
      reference: line.movement.reference,
      client: line.client,
      description: line.description,
      amountCents: line.amountCents,
      balanceCents: running,
    };
  });
  return {
    talentId: talent.id,
    displayName: talent.display_name,
    month,
    openingBalanceCents,
    lines,
    totals,
    closingBalanceCents: openingBalanceCents + totals.netCents,
    advances: recoupment(all, end),
  };
}

/** Step 4 for a talent's money records: a talent member sees only their own; others answer like unknown ids. */
async function visibleTalent(ctx: MemberCtx): Promise<TalentRow> {
  const talent = await one<TalentRow>(pool, "SELECT id, slug, display_name, office_id FROM talent WHERE id = $1",
    [ctx.params.id]);
  if (!talent || (ctx.isTalent() && ctx.member.talentId !== talent.id)) throw notFound();
  return talent;
}

function allowMoneyReaders(ctx: MemberCtx): void {
  if (!ctx.isTalent()) ctx.allow("accounts_lead", "agency_director");
}

memberRoute("GET", "/api/talent/:id/ledger", async (ctx) => {
  const talent = await visibleTalent(ctx);
  allowMoneyReaders(ctx);
  const lines = await talentLines(pool, talent.id);
  const entries = await entriesOf(pool, lines.map((line) => line.movement.id));
  return json(200, {
    balanceCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    movements: lines.map((line) => movementBody(line.movement, entries.get(line.movement.id) ?? [])),
  });
});

memberRoute("POST", "/api/talent/:id/advances", async (ctx) => {
  const talent = await visibleTalent(ctx);
  ctx.allow("accounts_lead", "agency_director");
  const body = asObject(await ctx.json());
  const errors: FieldErrors = new FieldErrors();
  const amount = body.amountCents;
  if (amount === undefined || amount === null || amount === "") errors.add("amountCents", required("Amount"));
  else if (!isWholeNumber(amount) || amount <= 0) errors.add("amountCents", "Enter an amount above zero, like 125.50.");
  if (body.note !== undefined && typeof body.note !== "string") errors.add("note", "Enter the note as text.");
  if (errors.any() || !isWholeNumber(amount)) errors.fail();
  return tx(async (client) => {
    const id = newId();
    const reference = `ADV-${String(await nextCounter(client, "advance")).padStart(6, "0")}`;
    await exec(client, `INSERT INTO movements (id, kind, reference, talent_id, note, created_by, created_at, office_date)
      VALUES ($1, 'advance', $2, $3, $4, $5, $6, $7)`,
    [id, reference, talent.id, str(body, "note"), ctx.member.name, new Date(ctx.now), officeToday(talent.office_id, ctx.now)]);
    await writeEntries(client, id, [[`talent:${talent.id}`, -amount], ["agency_cash", amount]]);
    return json(201, { movement: await movementReply(client, id) });
  });
});

async function writeEntries(client: PoolClient, movementId: string, entries: Array<[string, number]>): Promise<void> {
  for (const [position, [account, amount]] of entries.entries()) {
    await exec(client, "INSERT INTO entries (movement_id, position, account, amount_cents) VALUES ($1, $2, $3, $4)",
      [movementId, position, account, amount]);
  }
}

memberRoute("POST", "/api/ledger/movements/:id/reversal", async (ctx) => {
  const found = ctx.isTalent() ? null : await one<MovementRow>(pool, "SELECT * FROM movements WHERE id = $1", [ctx.params.id]);
  if (!found) throw notFound();
  ctx.allow("accounts_lead", "agency_director");
  const body = asObject(await ctx.json());
  return tx(async (client) => {
    const original = await one<MovementRow & { office_id: OfficeId }>(client,
      "SELECT m.*, t.office_id FROM movements m JOIN talent t ON t.id = m.talent_id WHERE m.id = $1 FOR UPDATE OF m", [found.id]);
    if (!original) throw notFound();
    if (original.reversed_by) {
      throw conflict("already_reversed", { reversedBy: original.reversed_by, reversedAt: optionalInstant(original.reversed_at) });
    }
    const booking = original.booking_id && original.kind === "booking"
      ? await one<{ id: string; state: string; reference: string; client_id: string; total_cents: number }>(client,
        "SELECT id, state, reference, client_id, total_cents FROM bookings WHERE id = $1 FOR UPDATE", [original.booking_id])
      : null;
    if (booking && booking.state !== "invoiced") throw conflict("not_invoiced");
    const reason = str(body, "reason").trim();
    if (!reason) {
      const errors: FieldErrors = new FieldErrors();
      errors.add("reason", required("Reason"));
      errors.fail();
    }
    if (booking) {
      const account = await accountFor(client, await billingClient(client, booking.client_id));
      await credit(account, { description: `Reversal of ${booking.reference}`, amountCents: booking.total_cents });
    }
    const id = newId();
    const reference = `REV-${String(await nextCounter(client, "reversal")).padStart(6, "0")}`;
    await exec(client, `INSERT INTO movements (id, kind, reference, talent_id, booking_id, reversal_of, note, created_by,
        created_at, office_date) VALUES ($1, 'reversal', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, reference, original.talent_id, original.booking_id, original.id, reason, ctx.member.name, new Date(ctx.now),
      officeToday(original.office_id, ctx.now)]);
    const mirrored = (await entriesOf(client, [original.id])).get(original.id) ?? [];
    await writeEntries(client, id, mirrored.map((entry): [string, number] => [entry.account, -entry.amountCents]));
    await exec(client, "UPDATE movements SET reversed_by = $2, reversed_at = $3 WHERE id = $1",
      [original.id, ctx.member.name, new Date(ctx.now)]);
    if (booking) await exec(client, "UPDATE bookings SET state = 'corrected' WHERE id = $1", [booking.id]);
    return json(201, { movement: await movementReply(client, id) });
  });
});

const CSV_HEADER = ["Date", "Type", "Reference", "Client", "Description", "Amount (CAD)", "Balance (CAD)"];
const TYPE_NAMES: Record<Kind, string> = { booking: "Booking", advance: "Advance", reversal: "Reversal" };

memberRoute("GET", "/api/talent/:id/statements/:month", async (ctx) => {
  const talent = await visibleTalent(ctx);
  const asCsv = ctx.params.month.endsWith(".csv");
  const month = asCsv ? ctx.params.month.slice(0, -4) : ctx.params.month;
  if (!isMonth(month)) throw notFound();
  allowMoneyReaders(ctx);
  const body = await statement(pool, talent, month);
  if (!asCsv) return json(200, body);
  const content = csv(CSV_HEADER, body.lines.map((line) => [
    number(line.officeDate),
    text(TYPE_NAMES[line.kind]),
    text(line.reference),
    text(line.client),
    text(line.description),
    number(plainAmount(line.amountCents)),
    number(plainAmount(line.balanceCents)),
  ]));
  await putObject(`statements/${talent.id}/${month}.csv`, Buffer.from(content, "utf8"), "text/csv; charset=utf-8");
  return {
    status: 200,
    raw: content,
    contentType: "text/csv; charset=utf-8",
    headers: { "Content-Disposition": `attachment; filename="statement-${talent.slug}-${month}.csv"` },
  };
});
