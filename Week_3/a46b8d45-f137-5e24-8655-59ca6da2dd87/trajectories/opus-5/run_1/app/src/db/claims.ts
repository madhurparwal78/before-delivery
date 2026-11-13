/**
 * Claims and everything hanging off them: history, photos, the ruling, quote revisions,
 * payment, decline, the confirmation link and the share link.
 */

import type { Ruling } from '../domain/ruling';
import type { QuoteSource } from '../domain/dispatch-promise';
import type { LondonDate } from '../domain/time';
import type { ClaimState } from '../shared/claim-state';
import type { Language } from '../shared/format';
import { query, queryOne, type Transaction } from './pool';

export type ShareLinkState = 'active' | 'withdrawn' | 'ended';
export type QuoteStatus = 'current' | 'void';
export type DeclineReason = 'owner_declined' | 'cannot_send';

export interface ClaimRow {
  reference: string;
  state: ClaimState;
  language: Language | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_postcode: string | null;
  purchase_date: LondonDate | null;
  club_member: boolean | null;
  model_slug: string | null;
  booklet_number: number | null;
  quantity: number | null;
  description: string | null;
  started_at: Date | null;
  confirm_by: Date | null;
  confirmed_at: Date | null;
  dispatched_at: Date | null;
  closed_at: Date | null;
  erased_at: Date | null;
}

export interface RulingRow {
  inside: boolean;
  edition_code: string;
  cover_ends_at: Date;
  cover_ends_on: LondonDate;
  term_months: number | null;
  decided_at: Date;
}

export interface QuoteRow {
  revision: number;
  status: QuoteStatus;
  source: QuoteSource;
  part_line_minor: number;
  carriage_minor: number;
  total_minor: number;
  band: string;
  carriage_valid_until: Date;
  promise_kind: 'same_day' | 'later';
  promise_date: LondonDate;
  quoted_at: Date;
  invoice_id: string;
  stock_quantity: number;
  stock_returned: boolean;
}

export interface PaymentRow {
  paid_minor: number;
  paid_at: Date;
  payment_id: string;
}

export interface DeclineRow {
  reason: DeclineReason;
  charged_minor: number;
  refunded_minor: number;
  declined_at: Date;
}

export interface PhotoRow {
  photo_index: number;
  content_type: string;
  byte_count: number;
}

export interface HistoryRow {
  state: ClaimState;
  at: Date;
}

const CLAIM_COLUMNS = `reference, state, language, owner_name, owner_email, owner_postcode,
                       purchase_date, club_member, model_slug, booklet_number, quantity,
                       description, started_at, confirm_by, confirmed_at, dispatched_at,
                       closed_at, erased_at`;

const QUOTE_COLUMNS = `revision, status, source, part_line_minor, carriage_minor, total_minor,
                       band, carriage_valid_until, promise_kind, promise_date, quoted_at,
                       invoice_id, stock_quantity, stock_returned`;

/** The whole claim as the desk holds it. */
export interface ClaimRecord {
  claim: ClaimRow;
  ruling: RulingRow | null;
  quotes: QuoteRow[];
  payment: PaymentRow | null;
  decline: DeclineRow | null;
  photos: PhotoRow[];
  history: HistoryRow[];
  shareLink: { token: string; state: ShareLinkState } | null;
  noticesPending: number;
}

export async function findClaimRow(reference: string): Promise<ClaimRow | null> {
  return queryOne<ClaimRow>(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE reference = $1`, [reference]);
}

/** Takes the claim row for update, so two moves on one claim can never both succeed. */
export async function lockClaimRow(tx: Transaction, reference: string): Promise<ClaimRow | null> {
  return tx.queryOne<ClaimRow>(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE reference = $1 FOR UPDATE`, [reference]);
}

export async function loadClaim(reference: string): Promise<ClaimRecord | null> {
  const claim = await findClaimRow(reference);
  if (claim === null) return null;
  return assemble(claim, {
    ruling: await queryOne<RulingRow>(
      `SELECT inside, edition_code, cover_ends_at, cover_ends_on, term_months, decided_at
         FROM claim_rulings WHERE reference = $1`,
      [reference],
    ),
    quotes: await query<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS} FROM quote_revisions WHERE reference = $1 ORDER BY revision DESC`,
      [reference],
    ),
    payment: await queryOne<PaymentRow>(
      'SELECT paid_minor, paid_at, payment_id FROM claim_payments WHERE reference = $1',
      [reference],
    ),
    decline: await queryOne<DeclineRow>(
      'SELECT reason, charged_minor, refunded_minor, declined_at FROM claim_declines WHERE reference = $1',
      [reference],
    ),
    photos: await query<PhotoRow>(
      'SELECT photo_index, content_type, byte_count FROM claim_photos WHERE reference = $1 ORDER BY photo_index',
      [reference],
    ),
    history: await query<HistoryRow>(
      'SELECT state, at FROM claim_history WHERE reference = $1 ORDER BY id',
      [reference],
    ),
    shareLink: await queryOne<{ token: string; state: ShareLinkState }>(
      `SELECT token, state FROM share_links WHERE reference = $1 ORDER BY created_at DESC LIMIT 1`,
      [reference],
    ),
    noticesPending: Number(
      (
        await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM notice_queue WHERE reference = $1 AND state = 'waiting'`,
          [reference],
        )
      )?.count ?? '0',
    ),
  });
}

function assemble(claim: ClaimRow, rest: Omit<ClaimRecord, 'claim'>): ClaimRecord {
  return { claim, ...rest };
}

export function currentQuote(record: ClaimRecord): QuoteRow | null {
  return record.quotes.find((quote) => quote.status === 'current') ?? null;
}

export function voidQuotes(record: ClaimRecord): QuoteRow[] {
  return record.quotes.filter((quote) => quote.status === 'void');
}

export interface NewClaim {
  reference: string;
  language: Language;
  name: string;
  email: string;
  postcode: string;
  purchaseDate: LondonDate;
  clubMember: boolean;
  modelSlug: string;
  bookletNumber: number;
  quantity: number;
  description: string;
  startedAt: Date;
  confirmBy: Date;
}

export async function insertClaim(tx: Transaction, claim: NewClaim): Promise<void> {
  await tx.query(
    `INSERT INTO claims (reference, state, language, owner_name, owner_email, owner_postcode,
                         purchase_date, club_member, model_slug, booklet_number, quantity,
                         description, started_at, confirm_by)
     VALUES ($1, 'started', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      claim.reference,
      claim.language,
      claim.name,
      claim.email,
      claim.postcode,
      claim.purchaseDate,
      claim.clubMember,
      claim.modelSlug,
      claim.bookletNumber,
      claim.quantity,
      claim.description,
      claim.startedAt,
      claim.confirmBy,
    ],
  );
}

export async function recordHistory(tx: Transaction, reference: string, state: ClaimState, at: Date): Promise<void> {
  await tx.query('INSERT INTO claim_history (reference, state, at) VALUES ($1, $2, $3)', [reference, state, at]);
}

export async function insertPhoto(
  tx: Transaction,
  reference: string,
  index: number,
  contentType: string,
  byteCount: number,
): Promise<void> {
  await tx.query(
    'INSERT INTO claim_photos (reference, photo_index, content_type, byte_count) VALUES ($1, $2, $3, $4)',
    [reference, index, contentType, byteCount],
  );
}

export async function insertConfirmLink(
  tx: Transaction,
  token: string,
  reference: string,
  confirmBy: Date,
): Promise<void> {
  await tx.query('INSERT INTO confirm_links (token, reference, confirm_by) VALUES ($1, $2, $3)', [
    token,
    reference,
    confirmBy,
  ]);
}

export interface ConfirmLinkRow {
  token: string;
  reference: string;
  confirm_by: Date;
  used_at: Date | null;
}

/** A share token is never accepted here, because the two kinds live in different tables. */
export async function lockConfirmLink(tx: Transaction, token: string): Promise<ConfirmLinkRow | null> {
  return tx.queryOne<ConfirmLinkRow>(
    'SELECT token, reference, confirm_by, used_at FROM confirm_links WHERE token = $1 FOR UPDATE',
    [token],
  );
}

export async function markConfirmLinkUsed(tx: Transaction, token: string, at: Date): Promise<void> {
  await tx.query('UPDATE confirm_links SET used_at = $2 WHERE token = $1', [token, at]);
}

export async function confirmLinkFor(reference: string): Promise<ConfirmLinkRow | null> {
  return queryOne<ConfirmLinkRow>(
    'SELECT token, reference, confirm_by, used_at FROM confirm_links WHERE reference = $1 ORDER BY confirm_by DESC LIMIT 1',
    [reference],
  );
}

export async function insertShareLink(tx: Transaction, token: string, reference: string, at: Date): Promise<void> {
  await tx.query(`INSERT INTO share_links (token, reference, state, created_at) VALUES ($1, $2, 'active', $3)`, [
    token,
    reference,
    at,
  ]);
}

/** A new link replaces the old one, which stops working at once. */
export async function withdrawShareLinks(tx: Transaction, reference: string): Promise<void> {
  await tx.query(`UPDATE share_links SET state = 'withdrawn' WHERE reference = $1 AND state = 'active'`, [reference]);
}

export async function endShareLinks(tx: Transaction, reference: string): Promise<void> {
  await tx.query(`UPDATE share_links SET state = 'ended' WHERE reference = $1 AND state = 'active'`, [reference]);
}

export interface ShareLinkRow {
  token: string;
  reference: string;
  state: ShareLinkState;
}

/** The claim's newest share link, whatever state it is in. */
export async function latestShareLink(reference: string): Promise<{ token: string; state: ShareLinkState } | null> {
  return queryOne<{ token: string; state: ShareLinkState }>(
    'SELECT token, state FROM share_links WHERE reference = $1 ORDER BY created_at DESC LIMIT 1',
    [reference],
  );
}

export async function findShareLink(token: string): Promise<ShareLinkRow | null> {
  return queryOne<ShareLinkRow>('SELECT token, reference, state FROM share_links WHERE token = $1', [token]);
}

export async function setClaimState(tx: Transaction, reference: string, state: ClaimState): Promise<void> {
  await tx.query('UPDATE claims SET state = $2 WHERE reference = $1', [reference, state]);
}

/** The instant a move was stored. The state itself always comes from the state machine. */
export async function markConfirmedAt(tx: Transaction, reference: string, at: Date): Promise<void> {
  await tx.query('UPDATE claims SET confirmed_at = $2 WHERE reference = $1', [reference, at]);
}

export async function markDispatchedAt(tx: Transaction, reference: string, at: Date): Promise<void> {
  await tx.query('UPDATE claims SET dispatched_at = $2 WHERE reference = $1', [reference, at]);
}

export async function markClosedAt(tx: Transaction, reference: string, at: Date): Promise<void> {
  await tx.query('UPDATE claims SET closed_at = $2 WHERE reference = $1', [reference, at]);
}

export async function insertRuling(tx: Transaction, reference: string, ruling: Ruling, decidedAt: Date): Promise<void> {
  await tx.query(
    `INSERT INTO claim_rulings (reference, inside, edition_code, cover_ends_at, cover_ends_on, term_months, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [reference, ruling.inside, ruling.edition, ruling.coverEndsAt, ruling.coverEndsOn, ruling.termMonths, decidedAt],
  );
}

export async function setIdentifiedPart(
  tx: Transaction,
  reference: string,
  modelSlug: string,
  bookletNumber: number,
  quantity: number,
): Promise<void> {
  await tx.query(
    'UPDATE claims SET model_slug = $2, booklet_number = $3, quantity = $4 WHERE reference = $1',
    [reference, modelSlug, bookletNumber, quantity],
  );
}

export interface NewQuote {
  reference: string;
  revision: number;
  source: QuoteSource;
  partLineMinor: number;
  carriageMinor: number;
  totalMinor: number;
  band: string;
  carriageValidUntil: Date;
  promiseKind: 'same_day' | 'later';
  promiseDate: LondonDate;
  quotedAt: Date;
  invoiceId: string;
  stockQuantity: number;
}

export async function insertQuote(tx: Transaction, quote: NewQuote): Promise<void> {
  await tx.query(
    `INSERT INTO quote_revisions (reference, revision, status, source, part_line_minor, carriage_minor,
                                  total_minor, band, carriage_valid_until, promise_kind, promise_date,
                                  quoted_at, invoice_id, stock_quantity)
     VALUES ($1, $2, 'current', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      quote.reference,
      quote.revision,
      quote.source,
      quote.partLineMinor,
      quote.carriageMinor,
      quote.totalMinor,
      quote.band,
      quote.carriageValidUntil,
      quote.promiseKind,
      quote.promiseDate,
      quote.quotedAt,
      quote.invoiceId,
      quote.stockQuantity,
    ],
  );
}

export async function lockQuotes(tx: Transaction, reference: string): Promise<QuoteRow[]> {
  return tx.query<QuoteRow>(
    `SELECT ${QUOTE_COLUMNS} FROM quote_revisions WHERE reference = $1 ORDER BY revision DESC FOR UPDATE`,
    [reference],
  );
}

export async function markQuoteVoid(tx: Transaction, reference: string, revision: number): Promise<void> {
  await tx.query(`UPDATE quote_revisions SET status = 'void' WHERE reference = $1 AND revision = $2`, [
    reference,
    revision,
  ]);
}

/**
 * Each revision puts its units back at most once, so a void followed by a decline never
 * returns the same units twice.
 */
export async function claimStockReturn(tx: Transaction, reference: string, revision: number): Promise<boolean> {
  const rows = await tx.query<{ revision: number }>(
    `UPDATE quote_revisions SET stock_returned = true
      WHERE reference = $1 AND revision = $2 AND source = 'bin' AND stock_returned = false
      RETURNING revision`,
    [reference, revision],
  );
  return rows.length === 1;
}

export async function insertPayment(
  tx: Transaction,
  reference: string,
  paidMinor: number,
  paidAt: Date,
  paymentId: string,
): Promise<void> {
  await tx.query(
    'INSERT INTO claim_payments (reference, paid_minor, paid_at, payment_id) VALUES ($1, $2, $3, $4)',
    [reference, paidMinor, paidAt, paymentId],
  );
}

export async function paymentFor(tx: Transaction, reference: string): Promise<PaymentRow | null> {
  return tx.queryOne<PaymentRow>('SELECT paid_minor, paid_at, payment_id FROM claim_payments WHERE reference = $1', [
    reference,
  ]);
}

export async function insertDecline(
  tx: Transaction,
  reference: string,
  reason: DeclineReason,
  chargedMinor: number,
  refundedMinor: number,
  declinedAt: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO claim_declines (reference, reason, charged_minor, refunded_minor, declined_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [reference, reason, chargedMinor, refundedMinor, declinedAt],
  );
}

export interface QueueEntry {
  reference: string;
  state: ClaimState;
  modelName: string | null;
  confirmedAt: Date | null;
}

/** Newest confirmation first, then started claims newest first. */
export async function listQueue(state: ClaimState | null): Promise<QueueEntry[]> {
  const rows = await query<{
    reference: string;
    state: ClaimState;
    model_name: string | null;
    confirmed_at: Date | null;
  }>(
    `SELECT c.reference, c.state, m.name AS model_name, c.confirmed_at
       FROM claims c
       LEFT JOIN models m ON m.slug = c.model_slug
      WHERE ($1::text IS NULL OR c.state = $1)
      ORDER BY c.confirmed_at DESC NULLS LAST, c.started_at DESC NULLS LAST, c.reference`,
    [state],
  );
  return rows.map((row) => ({
    reference: row.reference,
    state: row.state,
    modelName: row.model_name,
    confirmedAt: row.confirmed_at,
  }));
}

/** Every claim of one owner, matched by email in any letter case. */
export async function referencesForOwner(tx: Transaction, email: string): Promise<string[]> {
  const rows = await tx.query<{ reference: string }>(
    'SELECT reference FROM claims WHERE lower(owner_email) = lower($1) ORDER BY reference FOR UPDATE',
    [email],
  );
  return rows.map((row) => row.reference);
}

/**
 * Erasing a claim leaves its `claims` row holding only the reference, the state and the
 * erasure instant, and deletes every other row that holds the reference.
 */
export async function eraseClaimRows(tx: Transaction, reference: string, at: Date): Promise<void> {
  await tx.query(
    `UPDATE claims SET state = 'erased', erased_at = $2, language = NULL, owner_name = NULL,
                       owner_email = NULL, owner_postcode = NULL, purchase_date = NULL,
                       club_member = NULL, model_slug = NULL, booklet_number = NULL,
                       quantity = NULL, description = NULL, started_at = NULL, confirm_by = NULL,
                       confirmed_at = NULL, dispatched_at = NULL, closed_at = NULL
      WHERE reference = $1`,
    [reference, at],
  );
  for (const table of [
    'claim_history',
    'claim_photos',
    'claim_rulings',
    'quote_revisions',
    'claim_payments',
    'claim_declines',
    'confirm_links',
    'share_links',
    'idempotency_records',
    'reference_locks',
    'notice_queue',
  ]) {
    await tx.query(`DELETE FROM ${table} WHERE reference = $1`, [reference]);
  }
}
