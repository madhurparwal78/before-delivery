// Commission loading with object-level access, the detail view, quotes, holds and milestone invoicing.
import { randomUUID } from "node:crypto";
import { FOOTPRINTS, MILESTONE_SCHEDULE, VENUES, pieceLabel, type AddOn, type Audience, type InstallationType, type PieceKind, type Size, type Venue } from "../shared/catalog.js";
import { formatDay, usd } from "../shared/format.js";
import type { Caller } from "./auth.js";
import { notify, one, query, type Db } from "./db.js";
import { fail, UUID } from "./http.js";
import { enqueue } from "./jobs.js";
import { ensureAccount, invoiceCharges } from "./providers/killbill.js";
import { dayBounds, dueAt, holdActive, isoInZone, quoteValidUntil, secondsRemaining } from "./rules/calendar.js";
import { funderParts, milestoneParts, priceQuote, type QuoteLine } from "./rules/money.js";
import type { LayoutItem, Room } from "./rules/placement.js";
import { findMove, type Actor, type CommissionState } from "./rules/transitions.js";

export interface Commission {
  id: string;
  briefId: string;
  clientId: string;
  title: string;
  state: CommissionState;
  installationType: InstallationType;
  venue: Venue;
  room: Room;
  audience: Audience;
  notes: string;
  size: Size;
  addOns: AddOn[];
  quoteId: string | null;
  layoutVersion: number;
  layout: LayoutItem[];
  createdAt: Date;
}

interface CommissionRow {
  id: string; brief_id: string; client_id: string; title: string; state: CommissionState; installation_type: InstallationType;
  venue_id: string; width_m: number; depth_m: number; door_wall: Room["doorWall"]; audience: Audience; notes: string;
  size: Size; add_ons: AddOn[]; quote_id: string | null; layout_version: number; layout: LayoutItem[]; created_at: Date;
}

export function venueById(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}

function toCommission(row: CommissionRow): Commission {
  return {
    id: row.id, briefId: row.brief_id, clientId: row.client_id, title: row.title, state: row.state,
    installationType: row.installation_type, venue: venueById(row.venue_id) as Venue,
    room: { widthM: row.width_m, depthM: row.depth_m, doorWall: row.door_wall }, audience: row.audience, notes: row.notes,
    size: row.size, addOns: row.add_ons, quoteId: row.quote_id, layoutVersion: row.layout_version, layout: row.layout, createdAt: row.created_at,
  };
}

export async function loadCommission(db: Db, id: string, lock = false): Promise<Commission | null> {
  const row = await one<CommissionRow & Record<string, unknown>>(`SELECT * FROM commissions WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], db);
  return row ? toCommission(row) : null;
}

type Access = "owner" | "producer" | "crew" | "sponsor";

/** The commission when the caller may reach it in one of the given ways; 404 otherwise (ids are never confirmed). */
export async function commissionFor(db: Db, caller: Caller, id: string, ways: readonly Access[], lock = false): Promise<Commission> {
  if (!UUID.test(id)) return fail(404, "not_found");
  const c = await loadCommission(db, id, lock);
  if (!c) return fail(404, "not_found");
  if (ways.includes("owner") && c.clientId === caller.id) return c;
  if (ways.includes("producer") && caller.roles.includes("producer")) return c;
  if (ways.includes("crew") && caller.roles.includes("crew") && (await isAssignedCrew(db, id, caller.id))) return c;
  if (ways.includes("sponsor")) {
    const bound = await one("SELECT 1 FROM funders WHERE commission_id = $1 AND user_id = $2 AND removed_at IS NULL", [id, caller.id], db);
    if (bound) return c;
  }
  return fail(404, "not_found");
}

export async function isAssignedCrew(db: Db, commissionId: string, userId: string): Promise<boolean> {
  return Boolean(await one(
    "SELECT 1 FROM install_days d JOIN install_day_crew x ON x.install_day_id = d.id WHERE d.commission_id = $1 AND x.crew_user_id = $2 AND d.released_at IS NULL",
    [commissionId, userId], db,
  ));
}

export function requiredPieces(c: Pick<Commission, "installationType" | "addOns">): PieceKind[] {
  return [c.installationType, ...c.addOns];
}

/** Applies a move from the state machine when the table allows it for the actor; false otherwise. */
export async function applyMove(db: Db, c: Commission, to: CommissionState, actor: Actor): Promise<boolean> {
  const move = findMove(c.state, to);
  if (!move || !move.by.includes(actor)) return false;
  await db.query("UPDATE commissions SET state = $2 WHERE id = $1", [c.id, to]);
  c.state = to;
  await notify(db, "commission.updated", { commissionId: c.id, state: to });
  return true;
}

// ---- Quotes --------------------------------------------------------------------------------------

interface Quote {
  quoteId: string;
  lines: QuoteLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  issuedAt: number;
  validUntil: number;
}

export async function currentQuote(db: Db, c: Commission): Promise<Quote | null> {
  if (!c.quoteId) return null;
  const row = await one<{ id: string; lines: QuoteLine[]; subtotal_cents: number; tax_cents: number; total_cents: number; issued_at: Date; valid_until: Date }>(
    "SELECT * FROM quotes WHERE id = $1", [c.quoteId], db,
  );
  return row && {
    quoteId: row.id, lines: row.lines, subtotalCents: row.subtotal_cents, taxCents: row.tax_cents, totalCents: row.total_cents,
    issuedAt: row.issued_at.getTime(), validUntil: row.valid_until.getTime(),
  };
}

export async function issueQuote(db: Db, c: Commission, now: number): Promise<Quote> {
  const amounts = priceQuote(c.installationType, c.size, c.addOns, c.venue.taxRateBp);
  const quote: Quote = { quoteId: randomUUID(), ...amounts, issuedAt: now, validUntil: quoteValidUntil(now, c.venue.timeZone) };
  await db.query(
    "INSERT INTO quotes (id, commission_id, lines, subtotal_cents, tax_cents, total_cents, issued_at, valid_until) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [quote.quoteId, c.id, JSON.stringify(quote.lines), quote.subtotalCents, quote.taxCents, quote.totalCents, new Date(now), new Date(quote.validUntil)],
  );
  await db.query("UPDATE commissions SET quote_id = $2 WHERE id = $1", [c.id, quote.quoteId]);
  c.quoteId = quote.quoteId;
  return quote;
}

export function quoteView(q: Quote, c: Commission): Record<string, unknown> {
  return {
    quoteId: q.quoteId, lines: q.lines, subtotalCents: q.subtotalCents, taxCents: q.taxCents, totalCents: q.totalCents,
    issuedAt: isoInZone(q.issuedAt, c.venue.timeZone), validUntil: isoInZone(q.validUntil, c.venue.timeZone),
  };
}

// ---- Funders and milestone amounts -------------------------------------------------------------

export interface Funder {
  id: string;
  kind: "client" | "sponsor";
  name: string;
  email: string;
  bp: number;
  state: string;
  position: number;
  userId: string | null;
  inviteExpiresAt: Date | null;
  acceptedAt: Date | null;
  frozen: { subtotalCents: number; taxCents: number; amountCents: number } | null;
  invoicedAt: Date | null;
  dueAt: Date | null;
  killbillInvoiceId: string | null;
  killbillPaymentId: string | null;
  documentId: string | null;
}

interface FunderRow {
  id: string; kind: "client" | "sponsor"; name: string; email: string; bp: number; state: string; position: number;
  user_id: string | null; invite_expires_at: Date | null; accepted_at: Date | null; subtotal_cents: number | null;
  tax_cents: number | null; amount_cents: number | null; invoiced_at: Date | null; due_at: Date | null;
  killbill_invoice_id: string | null; killbill_payment_id: string | null; document_id: string | null;
}

export async function activeFunders(db: Db, commissionId: string): Promise<Funder[]> {
  const rows = await query<FunderRow & Record<string, unknown>>(
    "SELECT * FROM funders WHERE commission_id = $1 AND removed_at IS NULL ORDER BY position", [commissionId], db,
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind, name: r.name, email: r.email, bp: r.bp, state: r.state, position: r.position, userId: r.user_id,
    inviteExpiresAt: r.invite_expires_at, acceptedAt: r.accepted_at,
    frozen: r.amount_cents === null ? null : { subtotalCents: r.subtotal_cents ?? 0, taxCents: r.tax_cents ?? 0, amountCents: r.amount_cents },
    invoicedAt: r.invoiced_at, dueAt: r.due_at, killbillInvoiceId: r.killbill_invoice_id, killbillPaymentId: r.killbill_payment_id, documentId: r.document_id,
  }));
}

/** Each funder's part of the quote by the splitting rule (frozen once the sponsor's invoice is issued). */
export function funderAmounts(funders: Funder[], quote: Quote | null): { subtotalCents: number; taxCents: number; amountCents: number }[] {
  const live = quote ? funderParts(quote, funders.map((f) => f.bp)) : funders.map(() => ({ subtotalCents: 0, taxCents: 0, amountCents: 0 }));
  return funders.map((f, i) => f.frozen ?? live[i]);
}

/** The lead client's subtotal and tax parts (the whole quote when no funders are set). */
export function clientPart(funders: Funder[], quote: Quote): { subtotalCents: number; taxCents: number } {
  if (!funders.length) return { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents };
  return funderAmounts(funders, quote)[0];
}

interface Milestone {
  id: string | null;
  position: number;
  label: string;
  scheduleBp: number;
  state: string;
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
  invoicedAt: Date | null;
  dueAt: Date | null;
  killbillInvoiceId: string | null;
  killbillPaymentId: string | null;
  documentId: string | null;
}

interface MilestoneRow {
  id: string; position: number; label: string; schedule_bp: number; state: string; subtotal_cents: number; tax_cents: number;
  amount_cents: number; invoiced_at: Date | null; due_at: Date | null; killbill_invoice_id: string | null; killbill_payment_id: string | null; document_id: string | null;
}

export async function storedMilestones(db: Db, commissionId: string, lock = false): Promise<Milestone[]> {
  const rows = await query<MilestoneRow & Record<string, unknown>>(
    `SELECT * FROM milestones WHERE commission_id = $1 ORDER BY position${lock ? " FOR UPDATE" : ""}`, [commissionId], db,
  );
  return rows.map((r) => ({
    id: r.id, position: r.position, label: r.label, scheduleBp: r.schedule_bp, state: r.state, subtotalCents: r.subtotal_cents,
    taxCents: r.tax_cents, amountCents: r.amount_cents, invoicedAt: r.invoiced_at, dueAt: r.due_at,
    killbillInvoiceId: r.killbill_invoice_id, killbillPaymentId: r.killbill_payment_id, documentId: r.document_id,
  }));
}

/** The payment schedule as it stands: stored rows after signing, otherwise computed from the quote. */
async function milestonesOf(db: Db, c: Commission): Promise<Milestone[]> {
  const stored = await storedMilestones(db, c.id);
  if (stored.length) return stored;
  const quote = await currentQuote(db, c);
  if (!quote) return [];
  const parts = milestoneParts(clientPart(await activeFunders(db, c.id), quote));
  return MILESTONE_SCHEDULE.map((m, i) => ({
    id: null, position: i, label: m.label, scheduleBp: m.bp, state: "scheduled", ...parts[i],
    invoicedAt: null, dueAt: null, killbillInvoiceId: null, killbillPaymentId: null, documentId: null,
  }));
}

export interface Payer {
  id: string;
  name: string;
  email: string;
}

export async function userById(db: Db, id: string): Promise<Payer> {
  return (await one<{ id: string; name: string; email: string }>("SELECT id, name, email FROM users WHERE id = $1", [id], db)) as Payer;
}

export function dueText(due: number, zone: string): string {
  const local = isoInZone(due, zone).slice(0, 10);
  return `${formatDay(local)}, 23:59:59 (${zone})`;
}

/** Issues an invoice document for a payer's Kill Bill invoice and queues its PDF. */
export async function queueInvoiceDocument(db: Db, c: Commission, payer: Payer, label: string, invoice: { invoiceId: string; invoiceNumber: string }, amounts: { subtotalCents: number; taxCents: number; amountCents: number }, due: number): Promise<string> {
  const id = randomUUID();
  await db.query(
    "INSERT INTO documents (id, commission_id, kind, version, label, storage_key, snapshot, status) VALUES ($1, $2, 'invoice', 1, $3, $4, $5, 'preparing')",
    [id, c.id, `Invoice — ${label}`, `commissions/${c.id}/documents/invoice-${invoice.invoiceId}.pdf`, JSON.stringify({
      title: c.title, label, payerName: payer.name, payerEmail: payer.email, invoiceNumber: invoice.invoiceNumber, venueName: c.venue.name,
      subtotalCents: amounts.subtotalCents, taxCents: amounts.taxCents, amountCents: amounts.amountCents, dueBy: dueText(due, c.venue.timeZone),
    })],
  );
  await enqueue(db, "pdf", c.id, { documentId: id });
  return id;
}

/** Invoices a milestone in Kill Bill on its trigger, due 14 days later at 23:59:59 venue time. */
export async function invoiceMilestone(db: Db, c: Commission, m: Milestone, now: number): Promise<void> {
  const client = await userById(db, c.clientId);
  const accountId = await ensureAccount(client);
  const invoice = await invoiceCharges(accountId, c.title, m.label, m.subtotalCents, m.taxCents);
  const due = dueAt(now, c.venue.timeZone);
  const documentId = await queueInvoiceDocument(db, c, client, m.label, invoice, m, due);
  await db.query(
    "UPDATE milestones SET state = 'invoiced', invoiced_at = $2, due_at = $3, killbill_invoice_id = $4, killbill_invoice_number = $5, document_id = $6 WHERE id = $1",
    [m.id, new Date(now), new Date(due), invoice.invoiceId, invoice.invoiceNumber, documentId],
  );
  await queueDueEmail(db, c, client.email, m.label, m.amountCents, due);
}

/** The milestone-due email, sent when a milestone or sponsor share is invoiced. */
export async function queueDueEmail(db: Db, c: Commission, to: string, label: string, amountCents: number, due: number): Promise<void> {
  await enqueue(db, "email", c.id, {
    to: [to],
    subject: `${label} is due — ${c.title}`,
    text: `${label} for ${c.title} at ${c.venue.name}.\n\nAmount due: ${usd(amountCents)}\nDue by: ${dueText(due, c.venue.timeZone)}\n`,
  });
}

// ---- Holds and install days --------------------------------------------------------------------

export interface HoldRow {
  id: string; commission_id: string; venue_id: string; date: string; recorded_at: Date; expires_at: Date; status: string;
}


/** Ends every hold whose edge has passed: the date frees up, the commission returns to placed, one email. */
export async function endLapsedHolds(db: Db, now: number, scope: { commissionId?: string; venueId?: string; date?: string } = {}): Promise<void> {
  const held = await query<HoldRow & Record<string, unknown>>(
    `SELECT id, expires_at FROM holds WHERE status = 'held'
       AND ($1::uuid IS NULL OR commission_id = $1) AND ($2::text IS NULL OR venue_id = $2) AND ($3::date IS NULL OR date = $3)`,
    [scope.commissionId ?? null, scope.venueId ?? null, scope.date ?? null], db,
  );
  const lapsed = held.filter((h) => !holdActive(h.expires_at.getTime(), now)).map((h) => h.id);
  if (!lapsed.length) return;
  const ended = await query<HoldRow & Record<string, unknown>>(
    "UPDATE holds SET status = 'expired', ended_at = $1 WHERE id = ANY($2::uuid[]) AND status = 'held' RETURNING id, commission_id, venue_id, date",
    [new Date(now), lapsed], db,
  );
  for (const hold of ended) {
    const c = await loadCommission(db, hold.commission_id, true);
    if (!c) continue;
    await applyMove(db, c, "placed", "system");
    const client = await userById(db, c.clientId);
    await enqueue(db, "email", c.id, {
      to: [client.email],
      subject: `Your hold on ${formatDay(hold.date)} has ended`,
      text: `Your hold on ${formatDay(hold.date)} at ${c.venue.name} for ${c.title} has ended.\n\nPick a day again to finish — your details are still here.\n`,
    });
    await notify(db, "hold.updated", { commissionId: c.id, status: "expired" });
  }
}

export async function latestHold(db: Db, commissionId: string): Promise<HoldRow | null> {
  return one<HoldRow & Record<string, unknown>>(
    `SELECT id, commission_id, venue_id, date, recorded_at, expires_at, status
     FROM holds WHERE commission_id = $1 AND status <> 'released' ORDER BY recorded_at DESC LIMIT 1`,
    [commissionId], db,
  );
}

export function holdView(hold: HoldRow, zone: string, now: number): Record<string, unknown> {
  const expires = hold.expires_at.getTime();
  const status = hold.status === "booked" ? "booked" : hold.status === "held" && holdActive(expires, now) ? "held" : "expired";
  return {
    holdId: hold.id, date: hold.date, expiresAt: isoInZone(expires, zone),
    secondsRemaining: status === "held" ? secondsRemaining(expires, now) : 0,
    serverTime: new Date(now).toISOString(), status,
  };
}

export interface InstallDay {
  id: string;
  commissionId: string;
  venueId: string;
  date: string;
  crewUserIds: string[];
}

export async function installDayOf(db: Db, commissionId: string): Promise<InstallDay | null> {
  const row = await one<{ id: string; commission_id: string; venue_id: string; date: string }>(
    "SELECT id, commission_id, venue_id, date FROM install_days WHERE commission_id = $1 AND released_at IS NULL",
    [commissionId], db,
  );
  if (!row) return null;
  const crew = await query<{ crew_user_id: string }>("SELECT crew_user_id FROM install_day_crew WHERE install_day_id = $1", [row.id], db);
  return { id: row.id, commissionId: row.commission_id, venueId: row.venue_id, date: row.date, crewUserIds: crew.map((x) => x.crew_user_id) };
}

export function installDayView(day: InstallDay, zone: string): Record<string, unknown> {
  const bounds = dayBounds(day.date, zone);
  return { id: day.id, date: day.date, startsAt: isoInZone(bounds.startsAt, zone), endsAt: isoInZone(bounds.endsAt, zone), crewUserIds: day.crewUserIds };
}

// ---- Views ---------------------------------------------------------------------------------------

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function milestoneView(m: Milestone, zone: string): Record<string, unknown> {
  return {
    id: m.id, label: m.label, scheduleBp: m.scheduleBp, state: m.state, subtotalCents: m.subtotalCents, taxCents: m.taxCents,
    amountCents: m.amountCents, invoicedAt: m.invoicedAt ? isoInZone(m.invoicedAt.getTime(), zone) : null,
    dueAt: m.dueAt ? isoInZone(m.dueAt.getTime(), zone) : null, dueText: m.dueAt ? dueText(m.dueAt.getTime(), zone) : null, killbillInvoiceId: m.killbillInvoiceId,
    killbillPaymentId: m.killbillPaymentId, documentId: m.documentId,
  };
}

export function funderView(f: Funder, amounts: { subtotalCents: number; taxCents: number; amountCents: number }): Record<string, unknown> {
  return {
    id: f.id, kind: f.kind, name: f.name, email: f.email, bp: f.bp, ...amounts, state: f.state,
    inviteExpiresAt: iso(f.inviteExpiresAt), position: f.position,
  };
}

function pieceView(kind: PieceKind): Record<string, unknown> {
  const [widthM, depthM] = FOOTPRINTS[kind];
  return { kind, label: pieceLabel(kind), widthM, depthM };
}

export async function commissionView(db: Db, c: Commission, now: number): Promise<Record<string, unknown>> {
  const quote = await currentQuote(db, c);
  const hold = await latestHold(db, c.id);
  const day = await installDayOf(db, c.id);
  const funders = await activeFunders(db, c.id);
  const render = await one<{ id: string; state: string; progress: number; preview_sha256: string | null }>(
    "SELECT id, state, progress, preview_sha256 FROM render_jobs WHERE commission_id = $1 ORDER BY created_at DESC LIMIT 1", [c.id], db,
  );
  const amounts = funderAmounts(funders, quote);
  return {
    id: c.id, title: c.title, state: c.state, installationType: c.installationType,
    venue: c.venue, room: c.room, audience: c.audience, notes: c.notes,
    options: { size: c.size, addOns: c.addOns },
    quote: quote ? quoteView(quote, c) : null,
    layout: { version: c.layoutVersion, items: c.layout },
    requiredPieces: requiredPieces(c).map(pieceView),
    hold: hold && hold.status !== "booked" ? holdView(hold, c.venue.timeZone, now) : null,
    installDay: day ? installDayView(day, c.venue.timeZone) : null,
    milestones: (await milestonesOf(db, c)).map((m) => milestoneView(m, c.venue.timeZone)),
    funders: funders.map((f, i) => funderView(f, amounts[i])),
    latestRender: render && { id: render.id, state: render.state, progress: render.progress, previewSha256: render.preview_sha256 },
    clientId: c.clientId,
    createdAt: c.createdAt.toISOString(),
  };
}
