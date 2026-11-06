import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { query, withTransaction } from './database';
import type { KillBillClient } from './killbill';
import { ApiError } from '../http/errors';
import { kbSafe } from './kb-safe';
import { goodwillMinCents, goodwillMaxCents } from '../domain/model';
import { iso, torontoTz } from '../time';
import { enquiryRef } from '../domain/ids';
import { enquiryReplyEmail, emailText, emailHtml } from '../mail/templates';
import type { OutboxService } from './outbox';
import type { Config } from '../config';
import { nextSequence } from './membership';

/** Movement ids come from the one sequence; each movement writes two rows. */
export async function nextMovementId(client: PoolClient): Promise<number> {
  const res = await client.query<{ id: number }>(`SELECT nextval('credit_movement_seq')::int AS id`);
  return res.rows[0].id;
}

/** The one goodwill rule: a Kill Bill account credit, one paired ledger
 * movement, one audit entry, and the balance equals the ledger sum. */
export async function issueGoodwillCredit(
  deps: { cfg: Config; kb: KillBillClient; outbox: OutboxService },
  input: { accountNumber: string; amountCents: number; reason: string; actorEmail: string },
): Promise<{
  credit: {
    account_number: string;
    amount_cents: number;
    currency: 'CAD';
    balance_cents: number;
    movement_id: number;
    audit_id: number;
  };
}> {
  const { kb } = deps;
  if (input.amountCents < goodwillMinCents || input.amountCents > goodwillMaxCents) {
    throw new ApiError('validation', {
      fields: { amount_cents: 'Enter a credit between $1.00 and $500.00.' },
    });
  }
  const account = await query<{ id: number; number: string; name: string; email: string; locale: string }>(
    `SELECT id, number, name, email, locale FROM accounts WHERE number = $1 AND role = 'patron'`,
    [input.accountNumber],
  );
  if (account.rows.length === 0) throw new ApiError('not_found');
  const patron = account.rows[0];

  const kbAccountId = await (async () => {
    const existing = await kb.getAccountByExternalKey(patron.number);
    if (existing) return existing.accountId;
    const { ensureKbAccount } = await import('./membership');
    return ensureKbAccount(kb, {
      number: patron.number, name: patron.name,
      email: patron.email, locale: patron.locale === 'fr' ? 'fr' : 'en',
    });
  })();

  let balance = 0;
  let movementId = 0;
  let auditId = 0;
  let kbCreditInvoiceId: string | null = null;
  try {
    await withTransaction(async (client) => {
    // One credit at a time per account: the paired rows stay consistent.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [patron.number]);
    const creditInvoice = await kbSafe(kb.createCredit(kbAccountId, `GOODWILL ${input.accountNumber}`, input.amountCents));
    kbCreditInvoiceId = creditInvoice;
    movementId = await nextMovementId(client);
    await client.query(
      `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
       VALUES ($1,$2,'member-credit',$3,'goodwill',$4)`,
      [movementId, patron.number, input.amountCents, input.accountNumber],
    );
    await client.query(
      `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
       VALUES ($1,$2,'goodwill-expense',$3,'goodwill',$4)`,
      [movementId, patron.number, -input.amountCents, input.accountNumber],
    );
    const balanceRes = await client.query<{ balance: string }>(
      `SELECT COALESCE(sum(amount_cents),0)::text AS balance FROM credit_ledger
       WHERE account_number=$1 AND ledger_account='member-credit'`,
      [patron.number],
    );
    balance = Number(balanceRes.rows[0].balance);
    const audit = await client.query<{ id: number }>(
      `INSERT INTO audit_log (actor, action, target, amount_cents, reason)
       VALUES ($1,'goodwill-credit',$2,$3,$4) RETURNING id`,
      [input.actorEmail, patron.number, input.amountCents, input.reason],
    );
    auditId = audit.rows[0].id;
    });
  } catch (err) {
    // A credit that outlived its failed flow is balanced back out.
    if (kbCreditInvoiceId) {
      await kb.reverseCredit(kbAccountId, `GOODWILL COMPENSATION ${input.accountNumber}`, input.amountCents)
        .catch(() => undefined);
    }
    throw err;
  }

  return {
    credit: {
      account_number: input.accountNumber,
      amount_cents: input.amountCents,
      currency: 'CAD',
      balance_cents: balance,
      movement_id: movementId,
      audit_id: auditId,
    },
  };
}

export interface CreditBalance {
  balance_cents: number;
  movements: {
    id: number;
    kind: string;
    amount_cents: number;
    reference: string;
    at: string;
  }[];
}

/** The balance is the sum of the member-credit rows. */
export async function creditBalance(accountNumber: string): Promise<CreditBalance> {
  const res = await query<{ balance: string }>(
    `SELECT COALESCE(sum(amount_cents),0)::text AS balance FROM credit_ledger
     WHERE account_number=$1 AND ledger_account='member-credit'`,
    [accountNumber],
  );
  const movements = await query<{ id: number; kind: string; amount_cents: number; reference: string; created_at: Date }>(
    `SELECT movement_id AS id, kind, amount_cents, reference, created_at FROM credit_ledger
     WHERE account_number=$1 AND ledger_account='member-credit'
     ORDER BY movement_id DESC`,
    [accountNumber],
  );
  return {
    balance_cents: Number(res.rows[0].balance),
    movements: movements.rows.map(m => ({
      id: m.id,
      kind: m.kind,
      amount_cents: m.amount_cents,
      reference: m.reference,
      at: iso(DateTime.fromJSDate(m.created_at)),
    })),
  };
}

export interface Reconciliation {
  date: string;
  timezone: 'America/Toronto';
  window_start: string;
  window_end: string;
  local: {
    admission_cents: number;
    gst_cents: number;
    qst_cents: number;
    uplift_cents: number;
    gift_cents: number;
    membership_cents: number;
    credit_spent_cents: number;
    refunds_cents: number;
    net_payments_cents: number;
  };
  killbill: {
    payments_cents: number;
    refunds_cents: number;
    net_payments_cents: number;
  };
  difference_cents: number;
  status: 'matched' | 'mismatch' | 'accepted';
  accepted_difference_cents: number | null;
}

/** The one business-day rule: Toronto local midnight to local midnight. */
export function businessDayWindow(date: string): { start: DateTime; end: DateTime } {
  const start = DateTime.fromISO(`${date}T00:00:00`, { zone: torontoTz });
  return { start, end: start.plus({ days: 1 }) };
}

export async function reconciliationFor(
  kb: KillBillClient,
  date: string,
): Promise<Reconciliation> {
  const { start, end } = businessDayWindow(date);

  const bookings = await query<{
    admission_cents: number; gst_cents: number; qst_cents: number; uplift_cents: number;
    credit_applied_cents: number; paid_cents: number;
  }>(
    `SELECT admission_cents, gst_cents, qst_cents, uplift_cents, credit_applied_cents, paid_cents
     FROM bookings WHERE paid_at >= $1 AND paid_at < $2`,
    [start.toJSDate(), end.toJSDate()],
  );
  const gifts = await query<{ price_cents: number; credit_applied_cents: number }>(
    `SELECT price_cents, credit_applied_cents FROM gifts WHERE created_at >= $1 AND created_at < $2`,
    [start.toJSDate(), end.toJSDate()],
  );
  const membershipInvoices = await query<{ amount_cents: number; credit_applied_cents: number }>(
    `SELECT amount_cents, credit_applied_cents FROM membership_invoices
     WHERE created_at >= $1 AND created_at < $2`,
    [start.toJSDate(), end.toJSDate()],
  );
  const refunds = await query<{ total: string | null }>(
    `SELECT sum(refunded_cents)::text AS total FROM booking_refunds
     WHERE refunded_at >= $1 AND refunded_at < $2`,
    [start.toJSDate(), end.toJSDate()],
  );

  let admission = 0;
  let gst = 0;
  let qst = 0;
  let uplift = 0;
  let creditSpent = 0;
  for (const b of bookings.rows) {
    admission += b.admission_cents;
    gst += b.gst_cents;
    qst += b.qst_cents;
    uplift += b.uplift_cents;
    creditSpent += b.credit_applied_cents;
  }
  let giftCents = 0;
  for (const g of gifts.rows) {
    giftCents += g.price_cents;
    creditSpent += g.credit_applied_cents;
  }
  let membershipCents = 0;
  for (const m of membershipInvoices.rows) {
    membershipCents += m.amount_cents;
    creditSpent += m.credit_applied_cents;
  }
  const refundsCents = Number(refunds.rows[0].total ?? 0);

  const localNet = admission + gst + qst + uplift + giftCents + membershipCents - creditSpent - refundsCents;

  // Kill Bill figures: successful PURCHASE and REFUND amounts in the window.
  const accounts = await query<{ kb_account_id: string }>(
    'SELECT kb_account_id FROM kb_accounts',
  );
  let kbPayments = 0;
  let kbRefunds = 0;
  for (const account of accounts.rows) {
    const tx = await kb.accountTransactions(account.kb_account_id, start.toUTC().toISO() as string, end.toUTC().toISO() as string);
    kbPayments += tx.paymentsCents;
    kbRefunds += tx.refundsCents;
  }
  const kbNet = kbPayments - kbRefunds;
  const difference = kbNet - localNet;

  const acceptance = await query<{ difference_cents: number }>(
    'SELECT difference_cents FROM reconciliation_acceptances WHERE date = $1',
    [date],
  );
  const accepted = acceptance.rows[0];
  let status: Reconciliation['status'];
  if (difference === 0) status = 'matched';
  else if (accepted && accepted.difference_cents === difference) status = 'accepted';
  else status = 'mismatch';

  return {
    date,
    timezone: 'America/Toronto',
    window_start: iso(start),
    window_end: iso(end),
    local: {
      admission_cents: admission,
      gst_cents: gst,
      qst_cents: qst,
      uplift_cents: uplift,
      gift_cents: giftCents,
      membership_cents: membershipCents,
      credit_spent_cents: creditSpent,
      refunds_cents: refundsCents,
      net_payments_cents: localNet,
    },
    killbill: {
      payments_cents: kbPayments,
      refunds_cents: kbRefunds,
      net_payments_cents: kbNet,
    },
    difference_cents: difference,
    status,
    accepted_difference_cents: accepted ? accepted.difference_cents : null,
  };
}

export async function acceptReconciliation(
  kb: KillBillClient,
  date: string,
  reason: string,
  actorEmail: string,
): Promise<Reconciliation> {
  const current = await reconciliationFor(kb, date);
  if (current.difference_cents === 0) throw new ApiError('nothing_to_accept');
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO reconciliation_acceptances (date, difference_cents, reason)
       VALUES ($1,$2,$3)
       ON CONFLICT (date) DO UPDATE SET difference_cents=$2, reason=$3, accepted_at=now()`,
      [date, current.difference_cents, reason],
    );
    await client.query(
      `INSERT INTO audit_log (actor, action, target, amount_cents, reason)
       VALUES ($1,'reconciliation-accept',$2,$3,$4)`,
      [actorEmail, date, current.difference_cents, reason],
    );
  });
  return reconciliationFor(kb, date);
}

/** A patron-supplied cell that begins with a formula character gets a leading apostrophe. */
export function neutraliseCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function csvField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\r') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function dollars(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}

/**
 * The one CSV rule: the published header, one row per booking, gift,
 * membership invoice and refund in the window, and formula-neutralised
 * patron text.
 */
export async function reconciliationCsv(kb: KillBillClient, date: string): Promise<string> {
  const { start, end } = businessDayWindow(date);
  const rows: string[][] = [];
  const header = 'kind,reference,occurred_at,patron_name,note,admission,gst,qst,uplift,gift,membership,credit_spent,paid,refunded'.split(',');

  const bookings = await query<{
    ref: string; paid_at: Date; admission_cents: number; gst_cents: number; qst_cents: number;
    uplift_cents: number; credit_applied_cents: number; guest_name: string | null; account_name: string | null;
    note: string;
  }>(
    `SELECT b.ref, b.paid_at, b.admission_cents, b.gst_cents, b.qst_cents, b.uplift_cents,
            b.credit_applied_cents, b.guest_name,
            (SELECT a.name FROM accounts a WHERE a.id = b.account_id) AS account_name,
            b.note
     FROM bookings b
     WHERE b.paid_at >= $1 AND b.paid_at < $2
     ORDER BY b.paid_at, b.ref`,
    [start.toJSDate(), end.toJSDate()],
  );
  for (const b of bookings.rows) {
    const paid = b.admission_cents + b.gst_cents + b.qst_cents + b.uplift_cents - b.credit_applied_cents;
    rows.push([
      'booking', b.ref, DateTime.fromJSDate(b.paid_at).setZone(torontoTz).toISO({ suppressMilliseconds: true }) ?? '',
      neutraliseCell(b.guest_name ?? b.account_name ?? ''), neutraliseCell(b.note),
      dollars(b.admission_cents), dollars(b.gst_cents), dollars(b.qst_cents), dollars(b.uplift_cents),
      '0.00', '0.00', dollars(b.credit_applied_cents), dollars(paid), '0.00',
    ]);
  }

  const gifts = await query<{ ref: string; created_at: Date; price_cents: number; credit_applied: number; purchaser_name: string }>(
    `SELECT g.ref, g.created_at, g.price_cents, 0 AS credit_applied, g.purchaser_name
     FROM gifts g WHERE g.created_at >= $1 AND g.created_at < $2
     ORDER BY g.created_at, g.ref`,
    [start.toJSDate(), end.toJSDate()],
  );
  for (const g of gifts.rows) {
    const paid = g.price_cents - g.credit_applied;
    rows.push([
      'gift', g.ref, DateTime.fromJSDate(g.created_at).setZone(torontoTz).toISO({ suppressMilliseconds: true }) ?? '',
      neutraliseCell(g.purchaser_name), '',
      '0.00', '0.00', '0.00', '0.00', dollars(g.price_cents), '0.00',
      dollars(g.credit_applied), dollars(paid), '0.00',
    ]);
  }

  const membershipInvoices = await query<{
    account_number: string; created_at: Date; amount_cents: number; credit_applied_cents: number; account_name: string;
  }>(
    `SELECT m.account_number, m.created_at, m.amount_cents, m.credit_applied_cents,
            (SELECT a.name FROM accounts a WHERE a.number = m.account_number) AS account_name
     FROM membership_invoices m
     WHERE m.created_at >= $1 AND m.created_at < $2 AND m.amount_cents > 0
     ORDER BY m.created_at, m.account_number`,
    [start.toJSDate(), end.toJSDate()],
  );
  for (const m of membershipInvoices.rows) {
    const paid = m.amount_cents - m.credit_applied_cents;
    rows.push([
      'membership', m.account_number, DateTime.fromJSDate(m.created_at).setZone(torontoTz).toISO({ suppressMilliseconds: true }) ?? '',
      neutraliseCell(m.account_name), '',
      '0.00', '0.00', '0.00', '0.00', '0.00', dollars(m.amount_cents),
      dollars(m.credit_applied_cents), dollars(paid), '0.00',
    ]);
  }

  const refunds = await query<{
    ref: string; refunded_at: Date; refunded_cents: number; guest_name: string | null; account_name: string | null; note: string;
  }>(
    `SELECT b.ref, b.refunded_at, r.refunded_cents, b.guest_name,
            (SELECT a.name FROM accounts a WHERE a.id = b.account_id) AS account_name,
            b.note
     FROM booking_refunds r JOIN bookings b ON b.ref = r.booking_ref
     WHERE r.refunded_at >= $1 AND r.refunded_at < $2
     ORDER BY r.refunded_at, b.ref`,
    [start.toJSDate(), end.toJSDate()],
  );
  for (const r of refunds.rows) {
    rows.push([
      'refund', r.ref, DateTime.fromJSDate(r.refunded_at).setZone(torontoTz).toISO({ suppressMilliseconds: true }) ?? '',
      neutraliseCell(r.guest_name ?? r.account_name ?? ''), neutraliseCell(r.note),
      '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', dollars(r.refunded_cents),
    ]);
  }

  rows.sort((a, b) => {
    if (a[0] !== b[0]) {
      // Occurred-at instants sort by actual time, not by their ISO spelling.
      const ta = DateTime.fromISO(a[2], { setZone: true }).toMillis();
      const tb = DateTime.fromISO(b[2], { setZone: true }).toMillis();
      if (ta !== tb) return ta - tb;
    }
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });

  const lines = rows.map(r => r.map(csvField).join(','));
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  amount_cents: number | null;
  reason: string;
}

export async function auditList(): Promise<AuditEntry[]> {
  const res = await query<{
    id: number; at: Date; actor: string; action: string; target: string;
    amount_cents: number | null; reason: string;
  }>(
    `SELECT id, at, actor, action, target, amount_cents, reason FROM audit_log ORDER BY id DESC LIMIT 500`,
  );
  return res.rows.map(r => ({
    id: Number(r.id),
    at: iso(DateTime.fromJSDate(r.at)),
    actor: r.actor,
    action: r.action,
    target: r.target,
    amount_cents: r.amount_cents,
    reason: r.reason,
  }));
}

export interface EnquiryView {
  ref: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  locale: string;
  state: 'open' | 'answered';
  received_at: string;
}

export async function createEnquiry(input: {
  name: string; email: string; subject: string; message: string; locale: string;
}): Promise<{ ref: string }> {
  const ref = enquiryRef();
  await query(
    `INSERT INTO enquiries (ref, name, email, subject, message, locale, state)
     VALUES ($1,$2,$3,$4,$5,$6,'open')`,
    [ref, input.name, input.email, input.subject, input.message, input.locale],
  );
  return { ref };
}

export async function listEnquiries(): Promise<EnquiryView[]> {
  const res = await query<{
    ref: string; name: string; email: string; subject: string; message: string;
    locale: string; state: string; received_at: Date;
  }>(
    `SELECT ref, name, email, subject, message, locale, state, received_at
     FROM enquiries ORDER BY received_at DESC`,
  );
  return res.rows.map(e => ({
    ref: e.ref,
    name: e.name,
    email: e.email,
    subject: e.subject,
    message: e.message,
    locale: e.locale,
    state: e.state as 'open' | 'answered',
    received_at: iso(DateTime.fromJSDate(e.received_at)),
  }));
}

export async function replyEnquiry(
  outbox: OutboxService,
  ref: string,
  body: string,
  actorEmail: string,
): Promise<{ reply: { enquiry_ref: string; queued_at: string }; enquiry: { ref: string; state: string } }> {
  const found = await query<{ ref: string; email: string; subject: string; locale: string }>(
    'SELECT ref, email, subject, locale FROM enquiries WHERE ref = $1',
    [ref],
  );
  const enquiry = found.rows[0];
  if (!enquiry) throw new ApiError('not_found');
  const locale = enquiry.locale === 'fr' ? 'fr' : 'en';
  const email = enquiryReplyEmail(locale, ref, enquiry.subject, body);
  const queuedAt = DateTime.now();
  await withTransaction(async (client) => {
    const seq = await nextSequence(client, `enquiry-reply:${ref}`);
    outbox.enqueueInTx(client, {
      messageKey: `enquiry-reply:${ref}:${seq}`,
      kind: 'enquiry-reply',
      to: enquiry.email,
      subject: email.subject,
      bodyText: emailText(email.lines),
      html: emailHtml(email.lines),
      locale,
    });
    await client.query(`UPDATE enquiries SET state='answered' WHERE ref=$1`, [ref]);
    await client.query(
      `INSERT INTO audit_log (actor, action, target, amount_cents, reason)
       VALUES ($1,'enquiry-reply',$2,NULL,$3)`,
      [actorEmail, ref, enquiry.subject],
    );
  });
  return {
    reply: { enquiry_ref: ref, queued_at: iso(queuedAt) },
    enquiry: { ref, state: 'answered' },
  };
}
