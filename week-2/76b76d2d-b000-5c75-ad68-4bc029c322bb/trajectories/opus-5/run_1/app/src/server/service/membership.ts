import { CADENCES, TIERS, TIER_PLANS, planName, type Cadence, type Tier } from '../../shared/domain.ts';
import { one, transaction } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { assertBillingUp } from './guard.ts';
import { torontoDate } from '../domain/time.ts';
import { Validator } from '../http/validate.ts';
import { creditBalance, writeMovement } from '../repo/credit.ts';
import { ensurePatronBillingAccount } from '../repo/accounts.ts';
import {
  changeSubscription,
  createSubscription,
  getSubscription,
  listInvoiceIds,
  payOpenBalance,
  waitForNewInvoice,
  type KbInvoice,
} from '../killbill/client.ts';
import { enqueueMail, nextMailSequence } from '../mail/outbox.ts';
import { membershipChangedEmail, membershipStartedEmail } from '../mail/templates.ts';
import type { SessionAccount } from '../http/context.ts';

export type MembershipRow = {
  id: number;
  account_id: number;
  tier: Tier;
  cadence: Cadence | 'gift';
  plan: string;
  state: string;
  kb_subscription_id: string;
  started_on: string;
  charged_through: string | null;
  ends_on: string | null;
  pending_tier: Tier | null;
  pending_cadence: Cadence | null;
  pending_effective_date: string | null;
};

export type MembershipPayload = {
  tier: Tier;
  cadence: Cadence | 'gift';
  plan: string;
  state: 'active';
  started_on: string;
  charged_through: string | null;
  ends_on: string | null;
  pending_change: { tier: Tier; cadence: Cadence; effective_date: string } | null;
};

export async function activeMembership(accountId: number | null): Promise<MembershipRow | null> {
  if (accountId === null) return null;
  return one<MembershipRow>(
    `select * from memberships where account_id = $1 and state = 'active' order by id desc limit 1`,
    [accountId],
  );
}

export async function activeTier(accountId: number | null): Promise<Tier | null> {
  const membership = await activeMembership(accountId);
  return membership === null ? null : membership.tier;
}

export function membershipPayload(row: MembershipRow | null): MembershipPayload | null {
  if (row === null) return null;
  return {
    tier: row.tier,
    cadence: row.cadence,
    plan: row.plan,
    state: 'active',
    started_on: row.started_on,
    charged_through: row.charged_through,
    ends_on: row.ends_on,
    pending_change:
      row.pending_tier === null || row.pending_cadence === null || row.pending_effective_date === null
        ? null
        : { tier: row.pending_tier, cadence: row.pending_cadence, effective_date: row.pending_effective_date },
  };
}

export function invoicePayload(invoice: KbInvoice): Record<string, unknown> {
  return {
    amount_cents: invoice.amount_cents,
    credit_applied_cents: invoice.credit_applied_cents,
    paid_cents: invoice.amount_cents - invoice.credit_applied_cents,
    items: invoice.items
      .filter((item) => item.type !== 'CBA_ADJ')
      .map((item) => ({ type: item.type, description: item.description, amount_cents: item.amount_cents })),
  };
}

export async function hasLiveVerification(sessionToken: string | null, now: Date): Promise<boolean> {
  if (sessionToken === null) return false;
  const row = await one<{ valid_until: Date }>(
    'select valid_until from stepup_verifications where session_token = $1',
    [sessionToken],
  );
  return row !== null && now.getTime() < row.valid_until.getTime();
}

export async function requireVerification(sessionToken: string | null, now: Date): Promise<void> {
  if (!(await hasLiveVerification(sessionToken, now))) throw new ApiError('stepup_required');
}

function validateTierAndCadence(body: Record<string, unknown>): { tier: Tier; cadence: Cadence } {
  const validator = new Validator();
  const tier = validator.enumValue('tier', body.tier, TIERS);
  const cadence = validator.enumValue('cadence', body.cadence, CADENCES);
  validator.check();
  return { tier, cadence };
}

async function recordMembershipInvoice(
  accountId: number,
  accountNumber: string | null,
  invoice: KbInvoice,
  reference: string,
): Promise<void> {
  await transaction(async (tx) => {
    await tx.query(
      `insert into membership_invoices(account_id, kb_invoice_id, amount_cents, credit_applied_cents)
         values($1,$2,$3,$4) on conflict (kb_invoice_id) do nothing`,
      [accountId, invoice.invoice_id, invoice.amount_cents, invoice.credit_applied_cents],
    );
    if (invoice.credit_applied_cents > 0 && accountNumber !== null) {
      await writeMovement(tx, {
        accountNumber,
        kind: 'spend',
        amountCents: invoice.credit_applied_cents,
        reference,
      });
    }
  });
}

export async function joinMembership(input: {
  account: SessionAccount;
  sessionToken: string | null;
  body: Record<string, unknown>;
  now: Date;
}): Promise<{ membership: MembershipPayload; invoice: Record<string, unknown> }> {
  const existing = await activeMembership(input.account.id);
  if (existing !== null) throw new ApiError('already_member');
  const { tier, cadence } = validateTierAndCadence(input.body);
  const balance = await creditBalance(input.account.number);
  if (balance > 0) await requireVerification(input.sessionToken, input.now);
  assertBillingUp();

  const kbAccountId = await ensurePatronBillingAccount(input.account);
  const known = new Set(await listInvoiceIds(kbAccountId));
  const subscriptionId = await createSubscription(kbAccountId, planName(tier, cadence));
  const invoice = await waitForNewInvoice(kbAccountId, known);
  if (invoice !== null) await payOpenBalance(kbAccountId, invoice);
  const subscription = await getSubscription(subscriptionId);

  const accountNumber = input.account.number;
  if (invoice !== null) {
    await recordMembershipInvoice(input.account.id, accountNumber, invoice, `membership ${planName(tier, cadence)}`);
  }

  const amountCents = invoice?.amount_cents ?? 0;
  const row = await transaction(async (tx) => {
    const created = await tx.one<MembershipRow>(
      `insert into memberships(account_id, tier, cadence, plan, state, kb_subscription_id, started_on, charged_through)
         values($1,$2,$3,$4,'active',$5,$6,$7) returning *`,
      [
        input.account.id,
        tier,
        cadence,
        planName(tier, cadence),
        subscriptionId,
        subscription.start_date.slice(0, 10),
        subscription.charged_through,
      ],
    );
    if (accountNumber !== null) {
      const sequence = await nextMailSequence(tx, `membership-started:${accountNumber}:`);
      await enqueueMail(
        tx,
        membershipStartedEmail({
          account_number: accountNumber,
          email: input.account.email,
          locale: input.account.locale,
          tier,
          cadence,
          amount_cents: amountCents,
          next_date: subscription.charged_through ?? subscription.start_date.slice(0, 10),
          sequence,
        }),
      );
    }
    return created!;
  });

  return {
    membership: membershipPayload(row)!,
    invoice: invoice === null
      ? { amount_cents: 0, credit_applied_cents: 0, paid_cents: 0, items: [] }
      : invoicePayload(invoice),
  };
}

export async function startGiftMembership(input: {
  account: SessionAccount;
  tier: Tier;
  now: Date;
}): Promise<MembershipPayload> {
  const existing = await activeMembership(input.account.id);
  if (existing !== null) throw new ApiError('already_member');
  const kbAccountId = await ensurePatronBillingAccount(input.account);
  const subscriptionId = await createSubscription(kbAccountId, planName(input.tier, 'gift'));
  const subscription = await getSubscription(subscriptionId);
  const accountNumber = input.account.number;
  const row = await transaction(async (tx) => {
    const created = await tx.one<MembershipRow>(
      `insert into memberships(account_id, tier, cadence, plan, state, kb_subscription_id, started_on, charged_through, ends_on)
         values($1,$2,'gift',$3,'active',$4,$5,$6,$6) returning *`,
      [
        input.account.id,
        input.tier,
        planName(input.tier, 'gift'),
        subscriptionId,
        subscription.start_date.slice(0, 10),
        subscription.charged_through,
      ],
    );
    if (accountNumber !== null) {
      const sequence = await nextMailSequence(tx, `membership-started:${accountNumber}:`);
      await enqueueMail(
        tx,
        membershipStartedEmail({
          account_number: accountNumber,
          email: input.account.email,
          locale: input.account.locale,
          tier: input.tier,
          cadence: 'gift',
          amount_cents: 0,
          next_date: subscription.charged_through ?? subscription.start_date.slice(0, 10),
          sequence,
        }),
      );
    }
    return created!;
  });
  return membershipPayload(row)!;
}

export async function changeMembership(input: {
  account: SessionAccount;
  sessionToken: string | null;
  body: Record<string, unknown>;
  now: Date;
}): Promise<{
  membership: MembershipPayload;
  effective: 'immediate' | 'end-of-term';
  effective_date: string;
  invoice: Record<string, unknown> | null;
}> {
  const current = await activeMembership(input.account.id);
  if (current === null) throw new ApiError('not_member');
  const { tier, cadence } = validateTierAndCadence(input.body);
  if (current.cadence === 'gift') throw new ApiError('gift_membership_locked');
  if (current.pending_effective_date !== null) {
    throw new ApiError('change_pending', { args: { date: current.pending_effective_date } });
  }
  if (current.tier === tier && current.cadence === cadence) throw new ApiError('no_change');
  await requireVerification(input.sessionToken, input.now);
  assertBillingUp();

  const kbAccountId = await ensurePatronBillingAccount(input.account);
  const immediate = TIER_PLANS[tier].rank > TIER_PLANS[current.tier].rank;
  const known = new Set(await listInvoiceIds(kbAccountId));
  await changeSubscription(current.kb_subscription_id, planName(tier, cadence), immediate ? 'IMMEDIATE' : 'END_OF_TERM');
  const invoice = immediate ? await waitForNewInvoice(kbAccountId, known) : null;
  if (invoice !== null) await payOpenBalance(kbAccountId, invoice);
  const subscription = await getSubscription(current.kb_subscription_id);
  const accountNumber = input.account.number;
  if (invoice !== null) {
    await recordMembershipInvoice(input.account.id, accountNumber, invoice, `membership ${planName(tier, cadence)}`);
  }

  const effectiveDate = immediate
    ? torontoDate(input.now)
    : current.charged_through ?? subscription.charged_through ?? torontoDate(input.now);
  const amountCents = invoice?.amount_cents ?? 0;

  const row = await transaction(async (tx) => {
    const updated = immediate
      ? await tx.one<MembershipRow>(
          `update memberships set tier=$2, cadence=$3, plan=$4, charged_through=$5,
             pending_tier=null, pending_cadence=null, pending_effective_date=null
             where id = $1 returning *`,
          [current.id, tier, cadence, planName(tier, cadence), subscription.charged_through],
        )
      : await tx.one<MembershipRow>(
          `update memberships set pending_tier=$2, pending_cadence=$3, pending_effective_date=$4
             where id = $1 returning *`,
          [current.id, tier, cadence, effectiveDate],
        );
    if (accountNumber !== null) {
      const sequence = await nextMailSequence(tx, `membership-changed:${accountNumber}:`);
      await enqueueMail(
        tx,
        membershipChangedEmail({
          account_number: accountNumber,
          email: input.account.email,
          locale: input.account.locale,
          from: { tier: current.tier, cadence: current.cadence },
          to: { tier, cadence },
          effective_date: effectiveDate,
          amount_cents: amountCents,
          sequence,
        }),
      );
    }
    return updated!;
  });

  return {
    membership: membershipPayload(row)!,
    effective: immediate ? 'immediate' : 'end-of-term',
    effective_date: effectiveDate,
    invoice: invoice === null ? null : invoicePayload(invoice),
  };
}

