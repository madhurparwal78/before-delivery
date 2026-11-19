import type { Milestone } from '../../shared/money.ts';
import type { CreditType, Layer, ProjectStatus, Visibility } from '../../shared/projectStatus.ts';
import type { EnquiryStatus } from '../../shared/enquiryStatus.ts';

export type ConsoleProject = {
  id: string;
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: Visibility;
  position: number;
  thresholds: Record<Layer, number>;
  status: ProjectStatus;
  stems: Array<{ id: string; layer: Layer; format: 'wav' | 'ogg'; bytes: number; duration_ms: number }>;
};

export type ConsoleLink = {
  id: string;
  label: string;
  token: string;
  url: string;
  expires_at: string;
  status: 'active' | 'expired' | 'revoked';
};

export type MailState = 'sent' | 'pending' | 'cancelled';

export type ConsoleProposal = {
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

export type ConsoleEnquiry = {
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
  proposal: ConsoleProposal | null;
};

export type ProductionMonth = {
  month: string;
  label: string;
  capacity: number;
  claimed: number;
  open: boolean;
};

export type QueuedEmail = {
  kind: 'receipt' | 'alert' | 'proposal' | 'month_held' | 'deposit';
  reference: string;
  to: string;
  queued_at: string;
  retry_at: string | null;
};
