/** Types shared across API modules. */
import { Pool } from 'pg';
import { Config } from '../config';
import { S3 } from '../storage/s3';

export interface AppDeps {
  config: Config;
  pool: Pool;
  s3: S3;
}

export interface Household {
  id: string;
  name: string;
  currency: string;
  planning_name: string;
  planning_email: string;
  planning_password_hash: string;
  other_name: string;
  other_email: string;
  other_password_hash: string | null;
  other_joined_at: Date | null;
  created_at: Date;
}

export interface PlanVersionRow {
  id: string;
  household_id: string;
  number: number;
  status: 'draft' | 'adopted';
  effective_from: string;
  exchange_zone: string;
  first_exchange_at: string;
  base_pattern: string;
  base_anchor: string;
  split_planning_bp: number;
  split_other_bp: number;
  max_consecutive_nights: number | null;
  body: string;
  etag: string;
}

export interface SwapRow {
  id: string;
  household_id: string;
  nights_start: string;
  nights_end: string;
  makeup_start: string | null;
  makeup_end: string | null;
  to_parent: 'planning' | 'other';
  created_by: 'planning' | 'other';
  note: string | null;
  state: string;
  sent_at: Date | null;
  answer_by: Date | null;
  answer_zone: string | null;
  answered_at: Date | null;
  decline_reason: string | null;
  reminder_at: Date | null;
  reminded_at: Date | null;
  etag: string;
  created_at: Date;
}

export interface CostRow {
  id: string;
  household_id: string;
  description: string;
  category: string;
  note: string | null;
  amount_minor: string;
  incurred_at: string;
  custody_day: string;
  paid_by: 'planning' | 'other';
  version_id: string;
  agreed_split_bp: number | null;
  split_planning_bp: number;
  split_other_bp: number;
  share_planning: string;
  share_other: string;
  owed_minor: string;
  state: string;
  sent_at: Date | null;
  answer_by: Date | null;
  answer_zone: string | null;
  answered_at: Date | null;
  decline_reason: string | null;
  reminder_at: Date | null;
  reminded_at: Date | null;
  etag: string;
  created_at: Date;
}

export interface ReceiptRow {
  id: string;
  household_id: string;
  cost_id: string;
  content_type: string;
  bytes: string;
  sha256: string;
  filename: string;
  object_key: string;
  stored_at: Date;
}

export interface RecordRow {
  id: string;
  household_id: string;
  year: number;
  state: string;
  attempts: number;
  steps_done: number;
  waiting_on: string | null;
  failure: string | null;
  year_digest: string | null;
  pdf_bytes: string | null;
  pdf_sha256: string | null;
  requested_at: Date;
  stored_at: Date | null;
  worker_lease_until: Date | null;
  worker_fence: string;
}

export interface ShareLinkRow {
  id: string;
  household_id: string;
  token: string;
  label: string;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
}

export interface NoticeRow {
  id: string;
  household_id: string;
  kind: string;
  to_email: string;
  subject: string;
  link: string;
  status: string;
  attempts: number;
  queued_at: Date;
  sent_at: Date | null;
  attempt_failed_at: Date | null;
}
