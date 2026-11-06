import { query } from '../db.js';
import { errors } from './errors.js';
import { serialiseCase, amountString, decimalCents } from '../domain/case-body.js';
import { formatInstant, businessDateInZone, businessMonthInZone, monthLabel, shiftMonth, dateStr, hoursBetween, firstOfNextMonthUtc, localMidnightUtc } from '../domain/time.js';
import { isValidLei, normaliseLei } from '../domain/names.js';
import { errors as e } from './errors.js';
import { config } from '../config.js';
import { initials, maskIdentity } from '../../shared/util.js';
import { csvDocument, REGULATOR_HEADER } from '../domain/csv.js';
import { feeLines, feeTotal } from '../domain/fees.js';

// Shared response builders used by several endpoint modules.

export async function caseById(id: string): Promise<Record<string, unknown> | null> {
  const r = await query(`SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = $1`, [id]);
  return r.rows[0] ?? null;
}

export function caseView(row: Record<string, unknown>, role: string, now = new Date(), digests: unknown[] = []): Record<string, unknown> {
  return serialiseCase(row as never, { role, now, digests });
}

export function invalid(fields: Record<string, string>): never {
  throw e.invalid(fields);
}

export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function isStr(value: unknown): value is string {
  return typeof value === 'string';
}

export function codePoints(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}

export function codePointTrim(value: string): string {
  return value.trim();
}

export type CaseRecord = {
  id: string; workspace_slug: string; reference: string; created_at: Date; created_by_kind: string; created_by_name: string;
  asset: string; amount_digits: string; amount_scale: number; destination_address: string; sending_address: string; wallet: string;
  counterparty_id: string | null; counterparty_name_as_sent: string | null; counterparty_lei: string | null; counterparty_jurisdiction: string | null;
  counterparty_network: string | null; counterparty_current_name: string | null; customer_id: string;
  originator_name: string | null; originator_identity: string | null; originator_dob: Date | null; beneficiary_name: string | null;
  fiat_value_cents: string; currency: string; path: string; status: string;
  data_sent_channel: string | null; data_sent_at: Date | null; answer_due_at: Date | null;
  answer_decision: string | null; answer_at: Date | null; answer_late: boolean | null; answer_via: string | null;
  ownership_required: boolean; ownership_confirmed_on: Date | null; ownership_recorded_at: Date | null; ownership_recorded_by: string | null;
  release_reason: string | null; release_reason_by: string | null; release_reason_at: Date | null;
  outcome: string | null; closed_at: Date | null; archived: boolean; archived_at: Date | null;
  erased: boolean; erasure_due_at: Date | null; erasure_status: string; erased_at: Date | null;
  decided_jurisdiction: string; decided_threshold_cents: string | null; decided_threshold_currency: string | null;
  decided_rule_since: Date | null; decided_rate_cents: string; decided_confirmation_limit: string;
  decided_counterparty_name: string | null; decided_counterparty_rule: string | null; decided_review_accepted_at: Date | null;
  review_decision: string | null; review_reason: string | null; review_decided_by: string | null; review_decided_at: Date | null;
};

export const OPEN_STATUSES = ['awaiting_ownership', 'in_review', 'awaiting_answer', 'accepted', 'rejected', 'no_response', 'cleared'];

export function nowInstant(): Date {
  return new Date();
}

export function workspaceNow(ws: { time_zone: string }): { today: string; now: string } {
  const now = new Date();
  return { today: businessDateInZone(now, ws.time_zone), now: formatInstant(now) };
}

export { query, errors, isValidLei, normaliseLei, serialiseCase, amountString, decimalCents, formatInstant, businessDateInZone, businessMonthInZone, localMidnightUtc, monthLabel, shiftMonth, dateStr, hoursBetween, firstOfNextMonthUtc, config, initials, maskIdentity, csvDocument, REGULATOR_HEADER, feeLines, feeTotal };
