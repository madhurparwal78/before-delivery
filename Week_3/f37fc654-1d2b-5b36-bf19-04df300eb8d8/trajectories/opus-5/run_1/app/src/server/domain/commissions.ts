import { randomUUID } from 'node:crypto';
import { env } from '../env.js';
import { query, type Queryable } from '../db/pool.js';
import { notFound } from '../http/errors.js';
import {
  computeQuote,
  splitAcrossFunders,
  splitAcrossMilestones,
  type QuoteAmounts,
} from '../../shared/money.js';
import {
  MILESTONE_SCHEDULE,
  findVenue,
  requiredPieces,
  type AddOn,
  type Audience,
  type DoorWall,
  type InstallationType,
  type MilestoneKey,
  type SizeOption,
  type Venue,
} from '../../shared/seed.js';
import type { CommissionState } from '../../shared/states.js';
import type { LayoutItem } from '../../shared/placement.js';
import {
  addDays,
  endOfDaySecond,
  isoUtc,
  isoWithVenueOffset,
  localDate,
} from '../../shared/venue-time.js';

export interface CommissionRow {
  id: string;
  client_id: string;
  brief_id: string | null;
  title: string;
  state: CommissionState;
  installation_type: InstallationType;
  venue_id: string;
  width_m: number;
  depth_m: number;
  door_wall: DoorWall;
  audience: Audience;
  notes: string;
  size_option: SizeOption;
  add_ons: AddOn[];
  layout_version: number;
  layout_items: LayoutItem[];
  signature_name: string | null;
  signed_at: Date | null;
  contract_version: number;
  maintenance_plan: string | null;
  maintenance_subscription_id: string | null;
  created_at: Date;
}

export interface QuoteRow {
  id: string;
  commission_id: string;
  lines: { label: string; amountCents: number }[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  issued_at: Date;
  valid_until: Date;
}

export interface FunderRow {
  id: string;
  commission_id: string;
  position: number;
  kind: 'client' | 'sponsor';
  name: string;
  email: string | null;
  bp: number;
  state: string;
  subtotal_cents: number;
  tax_cents: number;
  amount_cents: number;
  invite_token_hash: string | null;
  invite_expires_at: Date | null;
  accepted_user_id: string | null;
  accepted_at: Date | null;
  due_at: Date | null;
  killbill_invoice_id: string | null;
  killbill_invoice_number: string | null;
  killbill_payment_id: string | null;
  paid_at: Date | null;
  document_id: string | null;
}

export interface MilestoneRow {
  id: string;
  commission_id: string;
  milestone_key: MilestoneKey;
  label: string;
  schedule_bp: number;
  position: number;
  state: string;
  subtotal_cents: number;
  tax_cents: number;
  amount_cents: number;
  invoiced_at: Date | null;
  due_at: Date | null;
  killbill_invoice_id: string | null;
  killbill_invoice_number: string | null;
  killbill_payment_id: string | null;
  paid_at: Date | null;
  document_id: string | null;
}

export interface HoldRow {
  id: string;
  commission_id: string;
  venue_id: string;
  hold_date: string;
  expires_at: Date;
  released_at: Date | null;
  booked_at: Date | null;
}

export interface InstallDayRow {
  id: string;
  commission_id: string;
  venue_id: string;
  install_date: string;
  starts_at: Date;
  ends_at: Date;
  crew_user_ids: string[];
  confirmed_at: Date | null;
}

export async function findCommission(id: string): Promise<CommissionRow | null> {
  if (!isUuid(id)) return null;
  const result = await query<CommissionRow>('SELECT * FROM commissions WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function venueOf(commission: CommissionRow): Venue {
  const venue = findVenue(commission.venue_id);
  if (!venue) throw notFound();
  return venue;
}

export async function currentQuote(commissionId: string): Promise<QuoteRow | null> {
  const result = await query<QuoteRow>(
    'SELECT * FROM quotes WHERE commission_id = $1 AND is_current ORDER BY issued_at DESC LIMIT 1',
    [commissionId],
  );
  return result.rows[0] ?? null;
}

export async function listFunders(commissionId: string): Promise<FunderRow[]> {
  const result = await query<FunderRow>(
    'SELECT * FROM funders WHERE commission_id = $1 ORDER BY position',
    [commissionId],
  );
  return result.rows;
}

export async function listMilestones(commissionId: string): Promise<MilestoneRow[]> {
  const result = await query<MilestoneRow>(
    'SELECT * FROM milestones WHERE commission_id = $1 ORDER BY position',
    [commissionId],
  );
  return result.rows;
}

/** The latest hold, whether or not it has ended. */
export async function latestHold(commissionId: string): Promise<HoldRow | null> {
  const result = await query<HoldRow>(
    `SELECT * FROM holds
      WHERE commission_id = $1 AND released_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [commissionId],
  );
  return result.rows[0] ?? null;
}

export async function installDayOf(commissionId: string): Promise<InstallDayRow | null> {
  const result = await query<InstallDayRow>(
    'SELECT * FROM install_days WHERE commission_id = $1 ORDER BY created_at DESC LIMIT 1',
    [commissionId],
  );
  return result.rows[0] ?? null;
}

/** A hold is active while server time is strictly before its expiry. */
export function holdIsActive(hold: HoldRow, now: Date = new Date()): boolean {
  return hold.booked_at === null && hold.released_at === null && now.getTime() < hold.expires_at.getTime();
}

export function quoteAmountsOf(quote: QuoteRow): QuoteAmounts {
  return {
    lines: quote.lines,
    subtotalCents: quote.subtotal_cents,
    taxCents: quote.tax_cents,
    totalCents: quote.total_cents,
  };
}

/**
 * A quote's validity: the issue instant plus QUOTE_TTL_SECONDS when it is set,
 * otherwise 23:59:59 venue-local on the 14th day after its venue-local issue date.
 */
export function quoteValidUntil(issuedAt: Date, venue: Venue): Date {
  if (env.quoteTtlSeconds !== null) {
    return new Date(issuedAt.getTime() + env.quoteTtlSeconds * 1000);
  }
  const issueDate = localDate(issuedAt, venue.timeZone);
  return endOfDaySecond(addDays(issueDate, 14), venue.timeZone);
}

/**
 * A quote is usable through the second validUntil itself, and is refused from
 * the next second on, so the comparison is made in whole seconds.
 */
export function quoteIsUsable(quote: QuoteRow, now: Date = new Date()): boolean {
  return Math.floor(now.getTime() / 1000) <= Math.floor(quote.valid_until.getTime() / 1000);
}

/** The due instant of a milestone or share: 23:59:59 venue-local, 14 days on. */
export function dueInstantFrom(trigger: Date, venue: Venue): Date {
  const triggerDate = localDate(trigger, venue.timeZone);
  return endOfDaySecond(addDays(triggerDate, 14), venue.timeZone);
}

export function computeQuoteFor(commission: CommissionRow, venue: Venue): QuoteAmounts {
  return computeQuote(commission.installation_type, commission.size_option, commission.add_ons, venue.taxRateBp);
}

/** Issue a new current quote, replacing any earlier one. */
export async function issueQuote(
  tx: Queryable,
  commission: CommissionRow,
  venue: Venue,
): Promise<QuoteRow> {
  const amounts = computeQuoteFor(commission, venue);
  const issuedAt = new Date();
  const validUntil = quoteValidUntil(issuedAt, venue);
  await tx.query('UPDATE quotes SET is_current = false WHERE commission_id = $1 AND is_current', [
    commission.id,
  ]);
  const result = await tx.query<QuoteRow>(
    `INSERT INTO quotes (id, commission_id, lines, subtotal_cents, tax_cents, total_cents, issued_at, valid_until, is_current)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING *`,
    [
      randomUUID(),
      commission.id,
      JSON.stringify(amounts.lines),
      amounts.subtotalCents,
      amounts.taxCents,
      amounts.totalCents,
      issuedAt,
      validUntil,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('quote insert produced no row');
  await writeShares(tx, commission.id, amounts);
  return row;
}

/** Make sure the lead client funder exists, holding the whole share. */
export async function ensureLeadFunder(
  tx: Queryable,
  commissionId: string,
  clientName: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO funders (id, commission_id, position, kind, name, email, bp, state)
     VALUES ($1, $2, 0, 'client', $3, NULL, 10000, 'lead')
     ON CONFLICT (commission_id, position) DO NOTHING`,
    [randomUUID(), commissionId, clientName],
  );
}

export async function ensureMilestoneRows(tx: Queryable, commissionId: string): Promise<void> {
  for (const [index, milestone] of MILESTONE_SCHEDULE.entries()) {
    await tx.query(
      `INSERT INTO milestones (id, commission_id, milestone_key, label, schedule_bp, position, state)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
       ON CONFLICT (commission_id, milestone_key) DO NOTHING`,
      [randomUUID(), commissionId, milestone.key, milestone.label, milestone.scheduleBp, index],
    );
  }
}

/**
 * Apply the two-stage split: the quote across the funders in list order, then
 * the lead client's part across the payment schedule. Amounts already invoiced
 * keep the figures their invoice was raised with.
 */
export async function writeShares(
  tx: Queryable,
  commissionId: string,
  amounts: QuoteAmounts,
): Promise<void> {
  const fundersResult = await tx.query<FunderRow>(
    'SELECT * FROM funders WHERE commission_id = $1 ORDER BY position',
    [commissionId],
  );
  const funders = fundersResult.rows;
  if (funders.length === 0) return;

  const parts = splitAcrossFunders(amounts, funders.map((f) => f.bp));
  for (const [index, funder] of funders.entries()) {
    const part = parts[index];
    if (!part) continue;
    if (funder.killbill_invoice_id !== null) continue;
    await tx.query(
      `UPDATE funders SET subtotal_cents = $2, tax_cents = $3, amount_cents = $4 WHERE id = $1`,
      [funder.id, part.subtotalCents, part.taxCents, part.amountCents],
    );
  }

  const leadPart = parts[0];
  if (!leadPart) return;
  const milestoneParts = splitAcrossMilestones(leadPart);
  const milestonesResult = await tx.query<MilestoneRow>(
    'SELECT * FROM milestones WHERE commission_id = $1 ORDER BY position',
    [commissionId],
  );
  for (const [index, milestone] of milestonesResult.rows.entries()) {
    const part = milestoneParts[index];
    if (!part) continue;
    if (milestone.killbill_invoice_id !== null) continue;
    await tx.query(
      `UPDATE milestones SET subtotal_cents = $2, tax_cents = $3, amount_cents = $4 WHERE id = $1`,
      [milestone.id, part.subtotalCents, part.taxCents, part.amountCents],
    );
  }
}

export async function setState(
  tx: Queryable,
  commissionId: string,
  state: CommissionState,
): Promise<void> {
  await tx.query('UPDATE commissions SET state = $2, updated_at = now() WHERE id = $1', [
    commissionId,
    state,
  ]);
}

export function requiredPiecesOf(commission: CommissionRow): string[] {
  return requiredPieces(commission.installation_type, commission.add_ons);
}

/** The shape the API answers with for one commission. */
export interface CommissionShape {
  id: string;
  title: string;
  state: CommissionState;
  installationType: InstallationType;
  venue: Venue;
  room: { widthM: number; depthM: number; doorWall: DoorWall };
  audience: Audience;
  notes: string;
  options: { size: SizeOption; addOns: AddOn[] };
  quote: {
    quoteId: string;
    lines: { label: string; amountCents: number }[];
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    issuedAt: string;
    validUntil: string;
  } | null;
  layout: { version: number; items: LayoutItem[] };
  requiredPieces: string[];
  hold: HoldShape | null;
  installDay: InstallDayShape | null;
  milestones: MilestoneShape[];
  funders: FunderShape[];
  clientId: string;
  createdAt: string;
}

export interface HoldShape {
  holdId: string;
  date: string;
  expiresAt: string;
  secondsRemaining: number;
  serverTime: string;
  status: 'held' | 'expired' | 'booked';
}

export interface InstallDayShape {
  id: string;
  date: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  crewUserIds: string[];
  confirmedAt: string | null;
}

export interface MilestoneShape {
  id: string;
  label: string;
  milestoneKey: MilestoneKey;
  scheduleBp: number;
  state: string;
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
  invoicedAt: string | null;
  dueAt: string | null;
  killbillInvoiceId: string | null;
  killbillPaymentId: string | null;
  documentId: string | null;
}

export interface FunderShape {
  id: string;
  kind: 'client' | 'sponsor';
  name: string;
  email: string | null;
  bp: number;
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
  state: string;
  inviteExpiresAt: string | null;
  position: number;
  dueAt: string | null;
  killbillInvoiceId: string | null;
  documentId: string | null;
}

export function shapeHold(hold: HoldRow, venue: Venue, now = new Date()): HoldShape {
  const status: HoldShape['status'] =
    hold.booked_at !== null ? 'booked' : holdIsActive(hold, now) ? 'held' : 'expired';
  const remaining = Math.max(
    0,
    Math.floor((hold.expires_at.getTime() - now.getTime()) / 1000),
  );
  return {
    holdId: hold.id,
    date: hold.hold_date,
    expiresAt: isoWithVenueOffset(hold.expires_at, venue.timeZone),
    secondsRemaining: status === 'held' ? remaining : 0,
    serverTime: isoUtc(now),
    status,
  };
}

export function shapeInstallDay(day: InstallDayRow, venue: Venue): InstallDayShape {
  return {
    id: day.id,
    date: day.install_date,
    startsAt: isoWithVenueOffset(day.starts_at, venue.timeZone),
    endsAt: isoWithVenueOffset(day.ends_at, venue.timeZone),
    venueName: venue.name,
    crewUserIds: day.crew_user_ids,
    confirmedAt: day.confirmed_at ? isoUtc(day.confirmed_at) : null,
  };
}

export function shapeMilestone(row: MilestoneRow, venue: Venue): MilestoneShape {
  return {
    id: row.id,
    label: row.label,
    milestoneKey: row.milestone_key,
    scheduleBp: row.schedule_bp,
    state: row.state,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    amountCents: row.amount_cents,
    invoicedAt: row.invoiced_at ? isoUtc(row.invoiced_at) : null,
    dueAt: row.due_at ? isoWithVenueOffset(row.due_at, venue.timeZone) : null,
    killbillInvoiceId: row.killbill_invoice_id,
    killbillPaymentId: row.killbill_payment_id,
    documentId: row.document_id,
  };
}

export function shapeFunder(row: FunderRow, venue: Venue): FunderShape {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    email: row.email,
    bp: row.bp,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    amountCents: row.amount_cents,
    state: row.state,
    inviteExpiresAt: row.invite_expires_at ? isoUtc(row.invite_expires_at) : null,
    position: row.position,
    dueAt: row.due_at ? isoWithVenueOffset(row.due_at, venue.timeZone) : null,
    killbillInvoiceId: row.killbill_invoice_id,
    documentId: row.document_id,
  };
}

export async function shapeCommission(commission: CommissionRow): Promise<CommissionShape> {
  const venue = venueOf(commission);
  const [quote, milestones, funders, hold, installDay] = await Promise.all([
    currentQuote(commission.id),
    listMilestones(commission.id),
    listFunders(commission.id),
    latestHold(commission.id),
    installDayOf(commission.id),
  ]);
  const now = new Date();
  return {
    id: commission.id,
    title: commission.title,
    state: commission.state,
    installationType: commission.installation_type,
    venue,
    room: {
      widthM: Number(commission.width_m),
      depthM: Number(commission.depth_m),
      doorWall: commission.door_wall,
    },
    audience: commission.audience,
    notes: commission.notes,
    options: { size: commission.size_option, addOns: commission.add_ons },
    quote: quote
      ? {
          quoteId: quote.id,
          lines: quote.lines,
          subtotalCents: quote.subtotal_cents,
          taxCents: quote.tax_cents,
          totalCents: quote.total_cents,
          issuedAt: isoUtc(quote.issued_at),
          validUntil: isoWithVenueOffset(quote.valid_until, venue.timeZone),
        }
      : null,
    layout: { version: commission.layout_version, items: commission.layout_items },
    requiredPieces: requiredPiecesOf(commission),
    hold: hold && hold.booked_at === null ? shapeHold(hold, venue, now) : null,
    installDay: installDay ? shapeInstallDay(installDay, venue) : null,
    milestones: milestones.map((m) => shapeMilestone(m, venue)),
    funders: funders.map((f) => shapeFunder(f, venue)),
    clientId: commission.client_id,
    createdAt: isoUtc(commission.created_at),
  };
}

export function milestoneByKey(
  milestones: readonly MilestoneRow[],
  key: MilestoneKey,
): MilestoneRow | undefined {
  return milestones.find((m) => m.milestone_key === key);
}
