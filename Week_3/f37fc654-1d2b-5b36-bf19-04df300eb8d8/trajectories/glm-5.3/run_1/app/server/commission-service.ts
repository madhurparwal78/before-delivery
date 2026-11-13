import crypto from 'node:crypto';
import type { Config } from './config.js';
import type { DbClient } from './db.js';
import * as dates from './domain/dates.js';
import * as money from './domain/money.js';
import * as sm from './domain/state-machine.js';
import { MILESTONE_SCHEDULE, VENUES } from './domain/seed.js';
import type { AddOn, Audience, DoorWall, InstallationType, Size } from './domain/seed.js';
import type { CommissionState } from './domain/state-machine.js';

export type DbClientAlias = DbClient;

export interface CommissionRow {
  id: string;
  brief_id: string | null;
  client_id: string;
  title: string;
  installation_type: InstallationType;
  venue_id: string;
  width_m: string;
  depth_m: string;
  door_wall: DoorWall;
  audience: Audience;
  notes: string | null;
  size: Size;
  add_ons: AddOn[];
  state: CommissionState;
  created_at: Date;
}

export interface VenueRow {
  id: string;
  name: string;
  address: string;
  city: string;
  time_zone: string;
  tax_rate_bp: number;
}

export interface MilestoneRow {
  id: string;
  commission_id: string;
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
  killbill_payment_id: string | null;
  document_id: string | null;
  quote_id: string | null;
}

export interface FunderRow {
  id: string;
  commission_id: string;
  kind: 'client' | 'sponsor';
  position: number;
  name: string | null;
  email: string | null;
  bp: number;
  subtotal_cents: number | null;
  tax_cents: number | null;
  amount_cents: number | null;
  state: string;
  app_user_id: string | null;
  invite_token_hash: string | null;
  invite_expires_at: Date | null;
  killbill_invoice_id: string | null;
  killbill_payment_id: string | null;
  document_id: string | null;
  due_at: Date | null;
  accepted_at: Date | null;
}

export interface QuoteRow {
  id: string;
  commission_id: string;
  lines: money.QuoteLine[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  issued_at: Date;
  valid_until: Date;
  current: boolean;
}

export interface HoldRow {
  id: string;
  commission_id: string;
  venue_id: string;
  date: string;
  expires_at: Date;
  created_at: Date;
  state: string;
  ended_email_sent: boolean;
}

export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function venueById(id: string): VenueRow {
  const v = VENUES.find((x: { id: string }) => x.id === id);
  if (!v) throw new DomainError(404, 'not_found', 'venue not found');
  return { id: v.id, name: v.name, address: v.address, city: v.city, time_zone: v.timeZone, tax_rate_bp: v.taxRateBp };
}

export async function getCommission(tx: DbClient, id: string): Promise<CommissionRow | null> {
  const res = await tx.query(`SELECT * FROM commissions WHERE id = $1`, [id]);
  const row = res.rows[0] as CommissionRow | undefined;
  return row ?? null;
}

export async function getFunders(tx: DbClient, commissionId: string): Promise<FunderRow[]> {
  const res = await tx.query(`SELECT * FROM funders WHERE commission_id = $1 ORDER BY position`, [commissionId]);
  return res.rows as FunderRow[];
}

export async function getMilestones(tx: DbClient, commissionId: string): Promise<MilestoneRow[]> {
  const res = await tx.query(`SELECT * FROM milestones WHERE commission_id = $1 ORDER BY position`, [commissionId]);
  return res.rows as MilestoneRow[];
}

export async function currentQuote(tx: DbClient, commissionId: string): Promise<QuoteRow | null> {
  const res = await tx.query(`SELECT * FROM quotes WHERE commission_id = $1 AND current ORDER BY issued_at DESC LIMIT 1`, [commissionId]);
  const row = res.rows[0] as QuoteRow | undefined;
  return row ?? null;
}

export async function latestHold(tx: DbClient, commissionId: string): Promise<HoldRow | null> {
  const res = await tx.query(`SELECT * FROM holds WHERE commission_id = $1 ORDER BY created_at DESC LIMIT 1`, [commissionId]);
  const row = res.rows[0] as HoldRow | undefined;
  return row ?? null;
}

/** Issues a fresh quote for the commission and stores it as current. */
export async function issueQuote(tx: DbClient, cfg: Config, commission: CommissionRow): Promise<QuoteRow> {
  const venue = venueById(commission.venue_id);
  const amounts = money.quoteAmounts(commission.installation_type, commission.size, commission.add_ons, venue.tax_rate_bp);
  const id = crypto.randomUUID();
  const issuedAt = new Date();
  const validUntil =
    cfg.quoteTtlSeconds === null ? dates.quoteValidUntil(issuedAt, venue.time_zone) : new Date(issuedAt.getTime() + cfg.quoteTtlSeconds * 1000);
  await tx.query(`UPDATE quotes SET current = false WHERE commission_id = $1`, [commission.id]);
  await tx.query(
    `INSERT INTO quotes (id, commission_id, lines, subtotal_cents, tax_cents, total_cents, issued_at, valid_until, current)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
    [id, commission.id, JSON.stringify(amounts.lines), amounts.subtotalCents, amounts.taxCents, amounts.totalCents, issuedAt, validUntil],
  );
  return {
    id,
    commission_id: commission.id,
    lines: amounts.lines,
    subtotal_cents: amounts.subtotalCents,
    tax_cents: amounts.taxCents,
    total_cents: amounts.totalCents,
    issued_at: issuedAt,
    valid_until: validUntil,
    current: true,
  };
}

/** Creates the four milestones with amounts split from the current quote. */
export async function createMilestones(tx: DbClient, commissionId: string): Promise<MilestoneRow[]> {
  const ids = MILESTONE_SCHEDULE.map(() => crypto.randomUUID());
  for (let i = 0; i < MILESTONE_SCHEDULE.length; i++) {
    const entry = MILESTONE_SCHEDULE[i];
    if (!entry) throw new Error('schedule entry missing');
    await tx.query(
      `INSERT INTO milestones (id, commission_id, label, schedule_bp, position, state, subtotal_cents, tax_cents, amount_cents)
       VALUES ($1, $2, $3, $4, $5, 'scheduled', 0, 0, 0)`,
      [ids[i], commissionId, entry.label, entry.bp, i],
    );
  }
  return getMilestones(tx, commissionId);
}

/** Recomputes milestone and funder amounts from the current quote via the one splitting rule. */
export async function recomputeAmounts(tx: DbClient, commission: CommissionRow): Promise<void> {
  const quote = await currentQuote(tx, commission.id);
  if (!quote) return;
  const funders = await getFunders(tx, commission.id);
  const milestones = await getMilestones(tx, commission.id);
  if (funders.length === 0 || milestones.length === 0) return;
  const { funders: fParts, milestones: mParts } = money.splitAmounts(
    quote.subtotal_cents,
    quote.tax_cents,
    funders.map((f) => ({ funderId: f.id, bp: f.bp })),
    milestones.map((m) => ({ milestoneId: m.id, bp: m.schedule_bp })),
  );
  for (const f of funders) {
    const part = fParts.get(f.id);
    if (!part) continue;
    const paid = f.state === 'paid';
    await tx.query(
      `UPDATE funders SET subtotal_cents = $2, tax_cents = $3, amount_cents = $4 WHERE id = $1`,
      [f.id, paid ? f.subtotal_cents : part.subtotalCents, paid ? f.tax_cents : part.taxCents, paid ? f.amount_cents : part.amountCents],
    );
  }
  for (const m of milestones) {
    const part = mParts.get(m.id);
    if (!part) continue;
    const locked = m.state !== 'scheduled';
    await tx.query(
      `UPDATE milestones SET subtotal_cents = $2, tax_cents = $3, amount_cents = $4 WHERE id = $1`,
      [m.id, locked ? m.subtotal_cents : part.subtotalCents, locked ? m.tax_cents : part.taxCents, locked ? m.amount_cents : part.amountCents],
    );
  }
}

export async function setState(tx: DbClient, commissionId: string, state: CommissionState): Promise<void> {
  await tx.query(`UPDATE commissions SET state = $2, updated_at = now() WHERE id = $1`, [commissionId, state]);
}

// --- Holds ---

export async function holdStatus(tx: DbClient, hold: HoldRow): Promise<'held' | 'expired' | 'booked'> {
  if (hold.state === 'booked') return 'booked';
  if (hold.state === 'released') return 'expired';
  const now = Date.now();
  return now < hold.expires_at.getTime() ? 'held' : 'expired';
}

/** Ends an expired hold, releasing the day and returning the commission to placed. */
export async function expireHolds(tx: DbClient, commission: CommissionRow): Promise<void> {
  const hold = await latestHold(tx, commission.id);
  if (!hold) return;
  const status = await holdStatus(tx, hold);
  if (status !== 'expired') return;
  await tx.query(`UPDATE holds SET state = 'expired' WHERE id = $1`, [hold.id]);
  if (commission.state === 'held') {
    await setState(tx, commission.id, 'placed');
  }
}

