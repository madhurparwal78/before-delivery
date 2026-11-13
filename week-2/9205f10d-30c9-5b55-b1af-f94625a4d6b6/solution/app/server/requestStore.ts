import type pg from "pg";
import type { Organisation } from "./auth.js";
import { type Db, many } from "./db.js";
import type { CredentialType, RequestStatus, Setting } from "./rules.js";

export type SeatLabel = "A" | "B";

export interface SeatRecord {
  id: string;
  label: SeatLabel;
  interpreterId: string | null;
}

export interface RequestRecord {
  id: string;
  reference: string;
  organisation: Organisation;
  hourlyRateCents: number;
  setting: Setting;
  requiredCredential: CredentialType;
  startsAt: Date;
  durationMinutes: number;
  consumerName: string;
  locationAddress: string;
  city: string;
  notes: string;
  status: RequestStatus;
  teamSize: number | null;
  rotationMinutes: number | null;
  teamReason: string | null;
  actualMinutes: number | null;
  seats: SeatRecord[];
}

interface RequestRow {
  id: string;
  reference: string;
  organisation_id: string;
  organisation_name: string;
  organisation_code: string;
  hourly_rate_cents: number;
  setting: Setting;
  required_credential: CredentialType;
  starts_at: Date;
  duration_minutes: number;
  consumer_name: string;
  location_address: string;
  city: string;
  notes: string;
  status: RequestStatus;
  team_size: number | null;
  rotation_minutes: number | null;
  team_reason: string | null;
  actual_minutes: number | null;
  seats: { id: string; label: SeatLabel; interpreter_id: string | null }[];
}

/** Loads requests matching a WHERE clause on alias `r`, ordered by start time then reference. */
export async function loadRequests(db: Db, where: string, params: unknown[]): Promise<RequestRecord[]> {
  const rows = await many<RequestRow>(
    db,
    `SELECT r.id, r.reference, r.organisation_id, o.name AS organisation_name, o.code AS organisation_code,
            o.hourly_rate_cents, r.setting, r.required_credential, r.starts_at, r.duration_minutes,
            r.consumer_name, r.location_address, r.city, r.notes, r.status, r.team_size, r.rotation_minutes,
            r.team_reason, r.actual_minutes,
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'label', s.label, 'interpreter_id', s.interpreter_id)
                                      ORDER BY s.label)
                      FROM seats s WHERE s.request_id = r.id), '[]'::json) AS seats
     FROM requests r JOIN organisations o ON o.id = r.organisation_id
     WHERE ${where}
     ORDER BY r.starts_at, r.reference`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    organisation: { id: row.organisation_id, name: row.organisation_name, code: row.organisation_code },
    hourlyRateCents: row.hourly_rate_cents,
    setting: row.setting,
    requiredCredential: row.required_credential,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    consumerName: row.consumer_name,
    locationAddress: row.location_address,
    city: row.city,
    notes: row.notes,
    status: row.status,
    teamSize: row.team_size,
    rotationMinutes: row.rotation_minutes,
    teamReason: row.team_reason,
    actualMinutes: row.actual_minutes,
    seats: row.seats.map((s) => ({ id: s.id, label: s.label, interpreterId: s.interpreter_id })),
  }));
}

export async function loadRequest(db: Db, id: string): Promise<RequestRecord | undefined> {
  return (await loadRequests(db, "r.id = $1", [id]))[0];
}

/** Locks the request row for the rest of the transaction, then loads it. */
export async function lockRequest(client: pg.PoolClient, id: string): Promise<RequestRecord | undefined> {
  await client.query("SELECT 1 FROM requests WHERE id = $1 FOR UPDATE", [id]);
  return loadRequest(client, id);
}

export function endsAt(record: RequestRecord): Date {
  return new Date(record.startsAt.getTime() + record.durationMinutes * 60_000);
}

export function confirmedSeats(record: RequestRecord): SeatRecord[] {
  return record.seats.filter((s) => s.interpreterId !== null);
}

export async function addHistory(db: Db, requestId: string, actor: string, action: string, detail = ""): Promise<void> {
  await db.query("INSERT INTO history (request_id, actor, action, detail) VALUES ($1, $2, $3, $4)", [
    requestId,
    actor,
    action,
    detail,
  ]);
}

/** The request's client scheduler: every scheduler of its organisation. */
export async function schedulerEmails(db: Db, organisationId: string): Promise<string[]> {
  const rows = await many<{ email: string }>(
    db,
    "SELECT email FROM people WHERE role = 'client_scheduler' AND organisation_id = $1",
    [organisationId],
  );
  return rows.map((r) => r.email);
}
