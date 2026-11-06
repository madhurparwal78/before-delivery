import { DateTime } from 'luxon';
import { query, withTransaction, recordKbAccount } from './database';
import type { PoolClient } from 'pg';
import type { KillBillClient, KbInvoice } from './killbill';
import type { OutboxService } from './outbox';
import type { Config } from '../config';
import { ApiError } from '../http/errors';
import { tierRank, type Tier, type Cadence, type Locale } from '../domain/model';
import { dateOnly, torontoTz } from '../time';
import { membershipStartedEmail, membershipChangedEmail, emailText, emailHtml } from '../mail/templates';
import { kbSafe } from './kb-safe';
import { nextMovementId } from './finance';

export interface MembershipView {
  tier: Tier;
  cadence: Cadence | 'gift';
  plan: string;
  state: 'active';
  started_on: string;
  charged_through: string;
  ends_on: string | null;
  pending_change: { tier: Tier; cadence: Cadence; effective_date: string } | null;
}

export interface InvoiceView {
  amount_cents: number;
  credit_applied_cents: number;
  paid_cents: number;
  items: { type: string; description: string; amount_cents: number }[];
}

interface MembershipRow {
  account_id: number;
  tier: Tier;
  cadence: string;
  plan: string;
  state: string;
  started_on: Date;
  charged_through: Date;
  ends_on: Date | null;
  pending_tier: Tier | null;
  pending_cadence: string | null;
  pending_effective_date: Date | null;
  gift: boolean;
  kb_account_id: string | null;
  kb_subscription_id: string | null;
}

export async function membershipRow(accountId: number): Promise<MembershipRow | null> {
  const res = await query<MembershipRow>(
    `SELECT account_id, tier, cadence, plan, state, started_on, charged_through, ends_on,
            pending_tier, pending_cadence, pending_effective_date, gift,
            kb_account_id::text AS kb_account_id, kb_subscription_id::text AS kb_subscription_id
     FROM memberships WHERE account_id = $1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

export function membershipView(row: MembershipRow): MembershipView {
  return {
    tier: row.tier,
    cadence: row.cadence as Cadence | 'gift',
    plan: row.plan,
    state: 'active',
    started_on: dateOnly(DateTime.fromJSDate(row.started_on)),
    charged_through: dateOnly(DateTime.fromJSDate(row.charged_through)),
    ends_on: row.ends_on ? dateOnly(DateTime.fromJSDate(row.ends_on)) : null,
    pending_change: row.pending_tier && row.pending_cadence && row.pending_effective_date
      ? {
          tier: row.pending_tier,
          cadence: row.pending_cadence as Cadence,
          effective_date: dateOnly(DateTime.fromJSDate(row.pending_effective_date)),
        }
      : null,
  };
}

/** The next billing date for a plan: the day the first period ends. */
function chargedThroughFrom(plan: string, start: DateTime): DateTime {
  if (plan.endsWith('-annual')) return start.plus({ years: 1 });
  if (plan.endsWith('-monthly')) return start.plus({ months: 1 });
  return start.plus({ months: 12 });
}

/** Ensures the patron has a Kill Bill account and external payment method. */
export async function ensureKbAccount(
  kb: KillBillClient,
  account: { number: string; name: string; email: string; locale: Locale },
): Promise<string> {
  const existing = await kb.getAccountByExternalKey(account.number);
  if (existing) return existing.accountId;
  const created = await kbSafe(kb.createAccount({
    externalKey: account.number,
    name: account.name,
    email: account.email,
    locale: account.locale,
  }));
  await recordKbAccount(created.accountId, account.number);
  await kbSafe(kb.addExternalPaymentMethod(created.accountId));
  return created.accountId;
}

function invoiceView(invoice: KbInvoice, paidCents: number): InvoiceView {
  return {
    amount_cents: invoice.amountCents,
    credit_applied_cents: invoice.creditAppliedCents,
    paid_cents: paidCents,
    items: invoice.items.map(i => ({
      type: i.itemType,
      description: i.description,
      amount_cents: i.amountCents,
    })),
  };
}

/** The next sequence number for an outbox key family. */
export async function nextSequence(client: PoolClient, key: string): Promise<number> {
  const res = await client.query<{ n: number }>('SELECT n FROM outbox_seq WHERE key = $1 FOR UPDATE', [key]);
  if (res.rows.length === 0) {
    await client.query('INSERT INTO outbox_seq (key, n) VALUES ($1, 1)', [key]);
    return 1;
  }
  const n = res.rows[0].n + 1;
  await client.query('UPDATE outbox_seq SET n = $2 WHERE key = $1', [key, n]);
  return n;
}

export interface MembershipDeps {
  cfg: Config;
  kb: KillBillClient;
  outbox: OutboxService;
}

export interface PatronAccount {
  id: number;
  number: string;
  name: string;
  email: string;
  locale: Locale;
}

/**
 * The one join rule: one Kill Bill subscription on the published plan; the
 * first invoice amount is read from Kill Bill.
 */
export async function joinMembership(
  deps: MembershipDeps,
  account: PatronAccount,
  tier: Tier,
  cadence: Cadence,
): Promise<{ membership: MembershipView; invoice: InvoiceView }> {
  const { kb, outbox } = deps;
  if (await membershipRow(account.id)) throw new ApiError('already_member');

  const plan = `${tier}-${cadence}`;
  const startedOn = DateTime.now().setZone(torontoTz).startOf('day');
  const chargedThrough = chargedThroughFrom(plan, startedOn);

  return withTransaction(async (client) => {
    const kbAccountId = await ensureKbAccount(kb, account);
    const before = await kbSafe(kb.accountInvoices(kbAccountId));
    const lastNumber = before.length > 0 ? before[before.length - 1].invoiceNumber : '0';
    const sub = await kbSafe(kb.createSubscription(kbAccountId, plan));
    const invoice = await kbSafe(kb.waitForNewInvoice(kbAccountId, lastNumber));
    if (!invoice) throw new ApiError('billing_unavailable');
    const payNow = Math.max(0, invoice.amountCents - invoice.creditAppliedCents);
    if (payNow > 0) {
      await kbSafe(kb.payInvoice(invoice.id, kbAccountId, payNow));
    }
    await client.query(
      `INSERT INTO memberships (account_id, tier, cadence, plan, state, started_on, charged_through, gift, kb_account_id, kb_subscription_id)
       VALUES ($1,$2,$3,$4,'active',$5,$6,false,$7,$8)`,
      [account.id, tier, cadence, plan, startedOn.toJSDate(), chargedThrough.toJSDate(), kbAccountId, sub.subscriptionId],
    );
    await client.query(
      `INSERT INTO membership_invoices (account_number, invoice_number, amount_cents, credit_applied_cents)
       VALUES ($1,$2,$3,$4)`,
      [account.number, invoice.number, invoice.amountCents, invoice.creditAppliedCents],
    );
    if (invoice.creditAppliedCents > 0) {
      const movementId = await nextMovementId(client);
      await client.query(
        `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
         VALUES ($1,$2,'member-credit',$3,'spend',$4)`,
        [movementId, account.number, -invoice.creditAppliedCents, invoice.number],
      );
      await client.query(
        `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
         VALUES ($1,$2,'credit-redeemed',$3,'spend',$4)`,
        [movementId, account.number, invoice.creditAppliedCents, invoice.number],
      );
    }
    const email = membershipStartedEmail(account.locale, {
      accountNumber: account.number,
      tier,
      cadence,
      amountCents: invoice.amountCents,
      nextDate: dateOnly(chargedThrough),
    });
    const seq = await nextSequence(client, `membership-started:${account.number}`);
    outbox.enqueueInTx(client, {
      messageKey: `membership-started:${account.number}:${seq}`,
      kind: 'membership-started',
      to: account.email,
      subject: email.subject,
      bodyText: emailText(email.lines),
      html: emailHtml(email.lines),
      locale: account.locale,
    });
    return {
      membership: {
        tier, cadence, plan, state: 'active' as const,
        started_on: dateOnly(startedOn),
        charged_through: dateOnly(chargedThrough),
        ends_on: null,
        pending_change: null,
      },
      invoice: invoiceView(invoice, payNow),
    };
  });
}

export interface ChangeOutcome {
  membership: MembershipView;
  effective: 'immediate' | 'end-of-term';
  effective_date: string;
  invoice: InvoiceView | null;
}

/**
 * The one tier-change rule: a higher tier takes effect immediately with the
 * prorated Kill Bill invoice; anything else takes effect at the end of the
 * term with nothing charged today.
 */
export async function changeMembership(
  deps: MembershipDeps,
  account: PatronAccount,
  tier: Tier,
  cadence: Cadence,
): Promise<ChangeOutcome> {
  const { kb, outbox } = deps;
  const row = await membershipRow(account.id);
  if (!row) throw new ApiError('not_member');
  if (row.gift) throw new ApiError('gift_membership_locked');

  const toPlan = `${tier}-${cadence}`;
  if (row.plan === toPlan && !row.pending_tier) throw new ApiError('no_change');
  if (row.pending_tier) {
    throw new ApiError('change_pending', {
      params: { date: dateOnly(DateTime.fromJSDate(row.pending_effective_date as Date)) },
    });
  }

  const higher = tierRank[tier] > tierRank[row.tier];
  const kbAccountId = row.kb_account_id as string;
  const kbSubscriptionId = row.kb_subscription_id as string;
  const today = DateTime.now().setZone(torontoTz);

  if (higher) {
    return withTransaction(async (client) => {
      const before = await kbSafe(kb.accountInvoices(kbAccountId));
      const lastNumber = before.length > 0 ? before[before.length - 1].invoiceNumber : '0';
      await kbSafe(kb.changePlan(kbSubscriptionId, toPlan, 'IMMEDIATE'));
      const invoice = await kbSafe(kb.waitForNewInvoice(kbAccountId, lastNumber));
      if (!invoice) throw new ApiError('billing_unavailable');
      const payNow = Math.max(0, invoice.amountCents - invoice.creditAppliedCents);
      if (payNow > 0) {
        await kbSafe(kb.payInvoice(invoice.id, kbAccountId, payNow));
      }
      const chargedThrough = chargedThroughFrom(toPlan, today.startOf('day'));
      await client.query(
        `UPDATE memberships SET tier=$2, cadence=$3, plan=$4, charged_through=$5 WHERE account_id=$1`,
        [account.id, tier, cadence, toPlan, chargedThrough.toJSDate()],
      );
      await client.query(
        `INSERT INTO membership_invoices (account_number, invoice_number, amount_cents, credit_applied_cents)
         VALUES ($1,$2,$3,$4)`,
        [account.number, invoice.number, invoice.amountCents, invoice.creditAppliedCents],
      );
      if (invoice.creditAppliedCents > 0) {
        const movementId = await nextMovementId(client);
        await client.query(
          `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
           VALUES ($1,$2,'member-credit',$3,'spend',$4)`,
          [movementId, account.number, -invoice.creditAppliedCents, invoice.number],
        );
        await client.query(
          `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
           VALUES ($1,$2,'credit-redeemed',$3,'spend',$4)`,
          [movementId, account.number, invoice.creditAppliedCents, invoice.number],
        );
      }
      const email = membershipChangedEmail(account.locale, {
        fromTier: row.tier,
        fromCadence: row.cadence as Cadence,
        toTier: tier,
        toCadence: cadence,
        effectiveDate: dateOnly(today),
        chargeCents: invoice.amountCents,
      });
      const seq = await nextSequence(client, `membership-changed:${account.number}`);
      outbox.enqueueInTx(client, {
        messageKey: `membership-changed:${account.number}:${seq}`,
        kind: 'membership-changed',
        to: account.email,
        subject: email.subject,
        bodyText: emailText(email.lines),
        html: emailHtml(email.lines),
        locale: account.locale,
      });
      return {
        membership: {
          tier, cadence, plan: toPlan, state: 'active' as const,
          started_on: dateOnly(DateTime.fromJSDate(row.started_on)),
          charged_through: dateOnly(chargedThrough),
          ends_on: null,
          pending_change: null,
        },
        effective: 'immediate' as const,
        effective_date: dateOnly(today),
        invoice: invoiceView(invoice, payNow),
      };
    });
  }

  const effectiveDate = dateOnly(DateTime.fromJSDate(row.charged_through));
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE memberships SET pending_tier=$2, pending_cadence=$3, pending_effective_date=$4 WHERE account_id=$1`,
      [account.id, tier, cadence, row.charged_through],
    );
    const email = membershipChangedEmail(account.locale, {
      fromTier: row.tier,
      fromCadence: row.cadence as Cadence,
      toTier: tier,
      toCadence: cadence,
      effectiveDate,
      chargeCents: 0,
    });
    const seq = await nextSequence(client, `membership-changed:${account.number}`);
    outbox.enqueueInTx(client, {
      messageKey: `membership-changed:${account.number}:${seq}`,
      kind: 'membership-changed',
      to: account.email,
      subject: email.subject,
      bodyText: emailText(email.lines),
      html: emailHtml(email.lines),
      locale: account.locale,
    });
    const updated = (await membershipRow(account.id)) as MembershipRow;
    return {
      membership: membershipView(updated),
      effective: 'end-of-term' as const,
      effective_date: effectiveDate,
      invoice: null,
    };
  });
}
