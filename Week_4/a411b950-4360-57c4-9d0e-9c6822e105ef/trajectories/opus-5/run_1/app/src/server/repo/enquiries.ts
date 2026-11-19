import { query, type Queryable } from '../db/pool.ts';
import { readTimeStatus, type EnquiryStatus } from '../../shared/enquiryStatus.ts';
import { splitMilestones, type Milestone } from '../../shared/money.ts';
import { readMailStates, type MailState } from '../services/mail.ts';

export type MilestoneInvoiceRecord = {
  invoice_number: string;
  killbill_invoice_id: string;
  invoice_date: string;
  amount_cents: number;
};

export type EnquiryRow = {
  id: string;
  reference: string;
  version: number;
  received_at: Date;
  status: EnquiryStatus;
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferred_month: string | null;
  project_slug: string;
  attachment_id: string | null;
  attachment_filename: string | null;
  attachment_bytes: number | null;
  attachment_key: string | null;
  triage_notes: string;
  fit_score: number | null;
  rate_floor_cents: string | null;
  proposal_id: string | null;
  proposal_token: string | null;
  producer_name: string | null;
  producer_email: string | null;
  proposal_project_title: string | null;
  scope: string | null;
  fee_cents: string | null;
  production_month: string | null;
  proposal_expires_at: Date | null;
  killbill_account_id: string | null;
  deposit_invoice_id: string | null;
  deposit_invoice_number: string | null;
  deposit_amount_cents: string | null;
  deposit_balance_cents: string | null;
  deposit_invoice_date: string | null;
  deposit_payment_id: string | null;
  deposit_paid_at: Date | null;
  milestone_invoices: Record<string, MilestoneInvoiceRecord>;
};

export const ENQUIRY_COLUMNS = `e.id, e.reference, e.version, e.received_at, e.status, e.name, e.email, e.studio,
  e.brief, e.preferred_month, e.project_slug, e.attachment_id, e.attachment_filename, e.attachment_bytes,
  e.attachment_key, e.triage_notes, e.fit_score, e.rate_floor_cents,
  pr.id AS proposal_id, pr.token AS proposal_token, pr.producer_name, pr.producer_email,
  pr.project_title AS proposal_project_title, pr.scope, pr.fee_cents, pr.production_month,
  pr.expires_at AS proposal_expires_at, pr.killbill_account_id, pr.deposit_invoice_id,
  pr.deposit_invoice_number, pr.deposit_amount_cents, pr.deposit_balance_cents, pr.deposit_invoice_date,
  pr.deposit_payment_id, pr.deposit_paid_at, pr.milestone_invoices`;

export const ENQUIRY_FROM = `FROM enquiries e LEFT JOIN proposals pr ON pr.enquiry_id = e.id`;

export type ProposalJson = {
  token: string;
  url: string;
  producer_name: string;
  producer_email: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  production_month: string;
  milestones: Milestone[];
  expires_at: string;
  email: MailState | null;
  held_email: MailState | null;
  deposit_email: MailState | null;
  invoiced_milestones: number[];
};

export type EnquiryJson = {
  id: string;
  reference: string;
  version: number;
  received_at: string;
  status: EnquiryStatus;
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferred_month: string | null;
  project_slug: string;
  attachment: { filename: string; bytes: number; url: string } | null;
  receipt: MailState | null;
  triage_notes: string;
  fit_score: number | null;
  rate_floor_cents: number | null;
  proposal: ProposalJson | null;
};

export function invoicedMilestoneNumbers(row: EnquiryRow): number[] {
  return Object.keys(row.milestone_invoices ?? {})
    .map((key) => Number(key))
    .sort((left, right) => left - right);
}

export function enquiryReadTimeStatus(row: EnquiryRow, now: Date): EnquiryStatus {
  return readTimeStatus(row.status, row.proposal_expires_at, now);
}

export async function serializeEnquiries(
  rows: readonly EnquiryRow[],
  now: Date,
  client?: Queryable,
): Promise<EnquiryJson[]> {
  const runner = client ?? { query };
  const states = await readMailStates(
    runner,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const mail = states.get(row.id) ?? {};
    return {
      id: row.id,
      reference: row.reference,
      version: row.version,
      received_at: row.received_at.toISOString(),
      status: enquiryReadTimeStatus(row, now),
      name: row.name,
      email: row.email,
      studio: row.studio,
      brief: row.brief,
      preferred_month: row.preferred_month,
      project_slug: row.project_slug,
      attachment:
        row.attachment_id === null
          ? null
          : {
              filename: row.attachment_filename ?? '',
              bytes: row.attachment_bytes ?? 0,
              url: `/api/console/enquiries/${row.id}/attachment`,
            },
      receipt: mail.receipt ?? null,
      triage_notes: row.triage_notes,
      fit_score: row.fit_score,
      rate_floor_cents: row.rate_floor_cents === null ? null : Number(row.rate_floor_cents),
      proposal:
        row.proposal_id === null
          ? null
          : {
              token: row.proposal_token as string,
              url: `/p/${row.proposal_token as string}`,
              producer_name: row.producer_name as string,
              producer_email: row.producer_email as string,
              project_title: row.proposal_project_title as string,
              scope: row.scope as string,
              fee_cents: Number(row.fee_cents),
              production_month: row.production_month as string,
              milestones: splitMilestones(Number(row.fee_cents)),
              expires_at: (row.proposal_expires_at as Date).toISOString(),
              email: mail.proposal ?? null,
              held_email: mail.month_held ?? null,
              deposit_email: mail.deposit ?? null,
              invoiced_milestones: invoicedMilestoneNumbers(row),
            },
    };
  });
}

export async function readEnquiryRow(id: string, client?: Queryable): Promise<EnquiryRow | null> {
  const runner = client ?? { query };
  const result = await runner.query<EnquiryRow>(
    `SELECT ${ENQUIRY_COLUMNS} ${ENQUIRY_FROM} WHERE e.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function readEnquiryRowByToken(token: string, client?: Queryable): Promise<EnquiryRow | null> {
  const runner = client ?? { query };
  const result = await runner.query<EnquiryRow>(
    `SELECT ${ENQUIRY_COLUMNS} ${ENQUIRY_FROM} WHERE pr.token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}

/** Locks the enquiry record so each write sees and replaces one version at a time. */
export async function lockEnquiry(client: Queryable, id: string): Promise<EnquiryRow | null> {
  const locked = await client.query<{ id: string }>(`SELECT id FROM enquiries WHERE id = $1 FOR UPDATE`, [id]);
  if (locked.rows[0] === undefined) return null;
  return readEnquiryRow(id, client);
}

export async function bumpVersion(client: Queryable, id: string): Promise<number> {
  const result = await client.query<{ version: number }>(
    `UPDATE enquiries SET version = version + 1 WHERE id = $1 RETURNING version`,
    [id],
  );
  return (result.rows[0] as { version: number }).version;
}

export async function serializeEnquiryById(id: string, now: Date, client?: Queryable): Promise<EnquiryJson> {
  const row = await readEnquiryRow(id, client);
  if (row === null) throw new Error('The enquiry disappeared while it was being written');
  const serialized = await serializeEnquiries([row], now, client);
  return serialized[0] as EnquiryJson;
}
