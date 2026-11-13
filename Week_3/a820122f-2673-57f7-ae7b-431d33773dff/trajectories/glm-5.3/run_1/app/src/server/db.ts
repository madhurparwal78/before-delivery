import { Pool, type QueryResultRow } from "pg";

export interface VesselRow extends QueryResultRow {
  id: string;
  owner_id: string;
  name: string;
  kind: "workboat" | "survey_boat" | "coaster" | "charter_yacht";
  initial_offset_minutes: number;
}

export interface CrewRow extends QueryResultRow {
  id: string;
  vessel_id: string;
  name: string;
  rank: string;
  email: string;
  passcode_hash: string;
}

export interface OwnerRow extends QueryResultRow {
  id: string;
  name: string;
  email: string;
  passcode_hash: string;
}

export interface ClockChangeRow extends QueryResultRow {
  id: string;
  vessel_id: string;
  changes_at_utc: string;
  old_offset_minutes: number;
  new_offset_minutes: number;
  fix_id: string | null;
}

export interface FixRow extends QueryResultRow {
  id: string;
  vessel_id: string;
  at_utc: string;
  latitude: number;
  longitude: number;
}

export interface WatchEntryRow extends QueryResultRow {
  id: string;
  crew_id: string;
  entry_key: string;
  start_utc: string;
  end_utc: string;
  kind: "rest" | "work";
  ship_date: string;
  late: boolean;
  applied: boolean;
  received_at_utc: string;
  applied_order: number;
}

export interface RotaWatchRow extends QueryResultRow {
  id: string;
  vessel_id: string;
  crew_id: string;
  label: string;
  start_time: string;
  end_time: string;
  from_date: string;
  to_date: string;
}

export interface RuleSetRow extends QueryResultRow {
  id: string;
  vessel_id: string;
  rule_set: "flag_exception";
  effective_from_utc: string;
  effective_until_utc: string;
  flag_reference: string;
}

export interface NoteRow extends QueryResultRow {
  id: string;
  crew_id: string;
  ship_date: string;
  text: string;
  event_id: string | null;
  author_role: "owner_master" | "crew";
  created_at_utc: string;
}

export interface EventRow extends QueryResultRow {
  id: string;
  vessel_id: string;
  crew_id: string;
  kind: "drill" | "call_out";
  start_utc: string;
  end_utc: string;
  description: string;
}

export interface DayStateRow extends QueryResultRow {
  crew_id: string;
  ship_date: string;
  state: "open" | "closed" | "signed" | "countersigned";
  signed_at_utc: string | null;
  countersigned_at_utc: string | null;
}

export interface MonthRow extends QueryResultRow {
  crew_id: string;
  month: string;
  state: "open" | "awaiting_archive" | "sealed";
  record_key: string | null;
  record_sha256: string | null;
  copy_key: string | null;
  sealed_at_utc: string | null;
}

export interface BreachRow extends QueryResultRow {
  id: string;
  crew_id: string;
  rule: RuleName;
  window_hours: 24 | 168;
  window_start_utc: string;
  window_end_utc: string;
  rule_set: "standard" | "flag_exception";
  rest_hours: number;
  recorded_at_utc: string;
}

export interface InspectionLinkRow extends QueryResultRow {
  id: string;
  vessel_id: string;
  token: string;
  from_date: string;
  to_date: string;
  expires_at_utc: string;
  state: "active" | "expired" | "revoked";
}

export interface SessionRow extends QueryResultRow {
  id: string;
  person_id: string;
  role: "owner_master" | "crew";
  expires_at: Date;
}

export type RuleName =
  | "rest_24h"
  | "rest_periods"
  | "six_hour_block"
  | "fourteen_hour_gap"
  | "rest_168h"
  | "three_period_days";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, values);
  return result.rows as T[];
}
