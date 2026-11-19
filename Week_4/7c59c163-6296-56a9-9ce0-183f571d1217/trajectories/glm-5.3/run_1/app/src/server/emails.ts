import type { AppConfig } from './config.js';
import type { Pool } from './db.js';
import { formatMoney, formatMonth, monthName } from './money.js';

export interface EmailPayload {
  template: string;
  member_id?: string;
  deposit_id?: string;
  refund_id?: string;
  invite_token?: string;
  venue_id?: string;
  month?: string;
}

export interface RenderedEmail {
  to: string;
  subject: string;
  text: string;
}

export async function renderEmail(pool: Pool, config: AppConfig, payload: EmailPayload): Promise<RenderedEmail | null> {
  switch (payload.template) {
    case 'deposit_receipt': {
      if (!payload.deposit_id) return null;
      const res = await pool.query(
        `SELECT d.*, m.email, m.display_name, v.name AS venue_name, v.time_zone FROM deposits d
         JOIN members m ON m.id = d.member_id JOIN venues v ON v.id = d.venue_id WHERE d.id = $1`,
        [payload.deposit_id]
      );
      const row = res.rows[0] as { email: string; amount_cents: number; card_last4: string; id: string; created_at: Date; time_zone: string } | undefined;
      if (!row) return null;
      const balances = await pool.query(
        `SELECT COALESCE(SUM(amount_cents),0) AS available FROM journal_legs WHERE account = $1`,
        [`member:${payload.member_id}:available`]
      );
      const available = Number((balances.rows[0] as { available: string }).available);
      const localTime = new Intl.DateTimeFormat('en-US', { timeZone: row.time_zone, dateStyle: 'medium', timeStyle: 'short' }).format(row.created_at);
      return {
        to: row.email,
        subject: `Deposit received — ${formatMoney(row.amount_cents)}`,
        text: [
          `Amount: ${formatMoney(row.amount_cents)}`,
          `Card ending: ${row.card_last4}`,
          `Deposit id: ${row.id}`,
          `Time: ${localTime}`,
          `New available balance: ${formatMoney(available)}`,
        ].join('\n'),
      };
    }
    case 'refund_issued': {
      if (!payload.refund_id) return null;
      const res = await pool.query(
        `SELECT r.*, m.email FROM refunds r JOIN members m ON m.id = r.member_id WHERE r.id = $1`,
        [payload.refund_id]
      );
      const row = res.rows[0] as { email: string; amount_cents: number } | undefined;
      if (!row) return null;
      return { to: row.email, subject: `Refund issued — ${formatMoney(row.amount_cents)}`, text: `Your refund of ${formatMoney(row.amount_cents)} has been issued.` };
    }
    case 'plan_payment_failed': {
      const row = await builderMember(pool, payload.member_id);
      if (!row) return null;
      return { to: row.email, subject: `Payment failed — your ${capitalize(row.plan)} plan`, text: `Your last plan payment failed. Pay the outstanding balance to keep your rate.` };
    }
    case 'plan_final_notice': {
      const row = await builderMember(pool, payload.member_id);
      if (!row) return null;
      return { to: row.email, subject: `Final notice — your ${capitalize(row.plan)} plan`, text: `This is the final notice for your unpaid plan invoice.` };
    }
    case 'plan_downgraded': {
      const row = await builderMember(pool, payload.member_id);
      if (!row) return null;
      return { to: row.email, subject: `Your plan is now Sandbox`, text: `Your plan is downgraded to Sandbox until the outstanding invoice is paid.` };
    }
    case 'plan_active': {
      const row = await builderMember(pool, payload.member_id);
      if (!row) return null;
      return { to: row.email, subject: `Your ${capitalize(row.plan)} plan is active again`, text: `Your plan is active again.` };
    }
    case 'statement_ready': {
      if (!payload.member_id || !payload.month) return null;
      const res = await pool.query(`SELECT email FROM members WHERE id = $1`, [payload.member_id]);
      const row = res.rows[0] as { email: string } | undefined;
      if (!row) return null;
      return {
        to: row.email,
        subject: `Your ${monthName(payload.month)} statement is ready`,
        text: `Your statement is ready: ${config.publicUrl}/statements`,
      };
    }
    case 'invite': {
      if (!payload.invite_token) return null;
      const res = await pool.query(
        `SELECT i.email, v.name FROM invites i JOIN venues v ON v.id = i.venue_id WHERE i.token = $1`,
        [payload.invite_token]
      );
      const row = res.rows[0] as { email: string; name: string } | undefined;
      if (!row) return null;
      return {
        to: row.email,
        subject: `You're invited to ${row.name}`,
        text: `Accept your invite: ${config.publicUrl}/invites/${payload.invite_token}`,
      };
    }
    default:
      return null;
  }
}

async function builderMember(pool: Pool, memberId: string | undefined): Promise<{ email: string; plan: string } | null> {
  if (!memberId) return null;
  const res = await pool.query(
    `SELECT m.email, COALESCE(b.plan, 'sandbox') AS plan FROM members m LEFT JOIN builder_billing b ON b.member_id = m.id WHERE m.id = $1`,
    [memberId]
  );
  const row = res.rows[0] as { email: string; plan: string } | undefined;
  return row ?? null;
}

function capitalize(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function currentVenueMonth(timeZone: string): string {
  return formatMonth(new Date(), timeZone);
}
