/** Shared row shapes used by route modules. */

export interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  credit_type: string;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: string;
  position: number;
  bed_threshold: number;
  pulse_threshold: number;
  lead_threshold: number;
  stinger_threshold: number;
  status: string;
}

export interface StemRow {
  id: string;
  project_id: string;
  layer: string;
  format: string;
  bytes: number;
  duration_ms: number;
}

export interface LinkRow {
  id: string;
  project_id: string;
  label: string;
  token: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface ProposalRow {
  enquiry_id: string;
  token: string;
  producer_name: string;
  producer_email: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  production_month: string;
  m1_cents: number;
  m2_cents: number;
  m3_cents: number;
  m4_cents: number;
  sent_at: string;
  expires_at: string;
  accepted_at: string | null;
  kb_account_id: string | null;
  kb_deposit_invoice_id: string | null;
  kb_deposit_invoice_number: string | null;
  kb_deposit_item_date: string | null;
  kb_deposit_amount_cents: number | null;
  payment_id: string | null;
  paid_at: string | null;
  production_started_at: string | null;
  invoiced_milestones: number[];
  kb_milestone_invoice_ids: string[];
  kb_milestone_invoice_numbers: string[];
  kb_milestone_item_dates: string[];
  enquiry_status: string;
  enquiry_reference?: string;
}

export interface OperatorRow {
  id: string;
  email: string;
  password_hash: string;
}
