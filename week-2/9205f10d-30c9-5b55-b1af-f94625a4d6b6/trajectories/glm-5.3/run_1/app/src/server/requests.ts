import type { Pool } from "pg";
import {
  AGENCY_TZ, agencyDateKey, cancellationCutoff, defaultTeamSize, derivedStatus, isCredentialCode, isSetting,
  wallToInstant, windowsOverlap, weekMonday,
  type CredentialCode, type RequestStatus, type Setting,
} from "../shared/domain.js";
import { ApiError, notFound } from "./errors.js";
import type { Ctx } from "./http.js";
import type { DbCredential, DbOrganisation, DbPerson, DbRequest, DbSeat } from "./db_types.js";
import { credentialBadges, projectRequest, projectSeat, instantIso, type PublicRequest } from "./projection.js";
import { MailQueue } from "./mail.js";
import type { Config } from "./config.js";

export type App = {
  pool: Pool;
  mail: MailQueue;
  config: Config;
};

export type AuthedCtx = Ctx & {
  viewer: DbPerson;
  organisation: DbOrganisation | null;
};

type SeatRow = { seat: DbSeat; interpreter: DbPerson | null };
type RequestRow = { request: DbRequest; organisation: DbOrganisation };

/** Who may read this request, and with which extra fields. */
export function canReadRequest(person: DbPerson, orgId: string | null, request: DbRequest, holdsConfirmedSeat: boolean): boolean {
  switch (person.role) {
    case "coordinator":
    case "billing_admin":
      return true;
    case "client_scheduler":
      return orgId === request.organisation_id;
    case "interpreter":
      if (request.status === "submitted" || request.status === "half_staffed") return true;
      return holdsConfirmedSeat;
  }
}

export async function loadRequest(pool: Pool, id: string): Promise<RequestRow | null> {
  const { rows } = await pool.query<DbRequest & { org_name: string; org_code: string; hourly_rate_cents: number }>(
    `SELECT r.*, o.name AS org_name, o.code AS org_code, o.hourly_rate_cents
       FROM request r JOIN organisation o ON o.id = r.organisation_id
      WHERE r.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const organisation: DbOrganisation = {
    id: r.organisation_id,
    name: r.org_name,
    code: r.org_code,
    hourly_rate_cents: r.hourly_rate_cents,
  };
  const request: DbRequest = {
    id: r.id,
    reference: r.reference,
    organisation_id: r.organisation_id,
    setting: r.setting,
    required_credential: r.required_credential,
    starts_at: r.starts_at,
    duration_minutes: r.duration_minutes,
    city: r.city,
    consumer_name: r.consumer_name,
    location_address: r.location_address,
    notes: r.notes,
    status: r.status,
    team_size: r.team_size,
    team_reason: r.team_reason,
    rotation_minutes: r.rotation_minutes,
    actual_minutes: r.actual_minutes,
    free_cancel_until: r.free_cancel_until,
    created_by: r.created_by,
    created_at: r.created_at,
  };
  return { request, organisation };
}

export async function loadSeats(pool: Pool, requestId: string): Promise<SeatRow[]> {
  type Row = DbSeat & {
    interp_id: string | null;
    display_name: string | null;
    full_name: string | null;
    email: string | null;
    password_hash: string | null;
    interp_role: DbPerson["role"] | null;
    interp_phone: string | null;
    interp_home: string | null;
    interp_pay: number | null;
    interp_org: string | null;
  };
  const { rows } = await pool.query<Row>(
    `SELECT s.*, p.id AS interp_id, p.display_name, p.full_name, p.email, p.password_hash,
            p.role AS interp_role, p.phone AS interp_phone, p.home_area AS interp_home,
            p.pay_rate_cents AS interp_pay, p.organisation_id AS interp_org
       FROM seat s LEFT JOIN person p ON p.id = s.interpreter_id
      WHERE s.request_id = $1 ORDER BY s.label`,
    [requestId],
  );
  return rows.map((row) => {
    const interpreter: DbPerson | null = row.interp_id && row.email && row.password_hash
      ? {
          id: row.interp_id,
          role: row.interp_role ?? "interpreter",
          display_name: row.display_name ?? "",
          full_name: row.full_name ?? "",
          email: row.email,
          password_hash: row.password_hash,
          phone: row.interp_phone ?? null,
          home_area: row.interp_home ?? null,
          pay_rate_cents: row.interp_pay ?? null,
          organisation_id: row.interp_org ?? null,
        }
      : null;
    const seat: DbSeat = {
      id: row.id,
      request_id: row.request_id,
      label: row.label,
      status: row.status,
      interpreter_id: row.interpreter_id,
      confirmed_at: row.confirmed_at,
    };
    return { seat, interpreter };
  });
}

export async function loadAllCredentials(pool: Pool): Promise<DbCredential[]> {
  const { rows } = await pool.query<DbCredential>("SELECT * FROM credential");
  return rows;
}

export async function loadHistory(pool: Pool, requestId: string): Promise<Array<{ at: string; actor: string; action: string; detail: string }>> {
  const { rows } = await pool.query<{ at: Date; actor_name: string; action: string; detail: string }>(
    "SELECT at, actor_name, action, detail FROM history_entry WHERE request_id = $1 ORDER BY at, id",
    [requestId],
  );
  return rows.map((r) => ({
    at: instantIso(r.at),
    actor: r.actor_name,
    action: r.action,
    detail: r.detail,
  }));
}

export async function viewerHoldsSeat(pool: Pool, requestId: string, personId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM seat WHERE request_id = $1 AND interpreter_id = $2 AND status = 'confirmed'",
    [requestId, personId],
  );
  return rowCount === 1;
}

export async function projectForViewer(
  app: App,
  auth: AuthedCtx,
  requestRow: RequestRow,
  seats: SeatRow[],
): Promise<PublicRequest> {
  const { pool } = app;
  const { viewer } = auth;
  const credentials = await loadAllCredentials(pool);
  const allInterpreters = new Map<string, { credentials: CredentialCode[] }>();
  for (const { interpreter } of seats) {
    if (interpreter) allInterpreters.set(interpreter.id, { credentials: credentialBadges(interpreter.id, credentials) });
  }
  const holdsSeatOn = viewer.role === "interpreter"
    ? seats.some((s) => s.seat.interpreter_id === viewer.id && s.seat.status === "confirmed")
    : false;
  const history = viewer.role === "coordinator" || viewer.role === "billing_admin"
    ? await loadHistory(pool, requestRow.request.id)
    : undefined;
  return projectRequest(requestRow.request, requestRow.organisation, seats, {
    person: viewer,
    organisation: auth.organisation,
    holdsSeatOn,
    allInterpreters,
    history,
  });
}

/* --------------------------------------------------------------- searches */

export function searchMatch(haystacks: string[], q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

export function requestVisibleTo(viewer: DbPerson, orgId: string | null, request: DbRequest): boolean {
  if (viewer.role === "coordinator" || viewer.role === "billing_admin") return true;
  if (viewer.role === "client_scheduler") return orgId === request.organisation_id;
  return false;
}

/* ------------------------------------------------------------ formatting */

export function fmtAgencyDate(instant: string): string {
  const d = new Date(instant);
  return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, month: "short", day: "numeric" }).format(d);
}

export function fmtAgencyTime(instant: string): string {
  const d = new Date(instant);
  return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, hour: "numeric", minute: "2-digit" }).format(d);
}

export function fmtAgencyCutoff(instant: string): string {
  const d = new Date(instant);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_TZ, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(d);
}

/* --------------------------------------------------------- request create */

export type RequestInput = {
  setting?: unknown;
  starts_at?: unknown;
  duration_minutes?: unknown;
  consumer_name?: unknown;
  location_address?: unknown;
  city?: unknown;
  notes?: unknown;
  required_credential?: unknown;
};

export function validateRequestFields(
  body: RequestInput,
  requireAll: boolean,
): { ok: true; value: { setting: Setting; startsAt: string; duration: number; consumer: string; address: string; city: string; notes: string; credential: CredentialCode } } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const setting = body.setting;
  if (setting === undefined && requireAll) fields["setting"] = "Choose a setting.";
  else if (setting !== undefined && !isSetting(setting)) fields["setting"] = "Choose Medical, Education or Legal.";

  const starts = body.starts_at;
  let startsAt: string | null = null;
  if (typeof starts !== "string") {
    if (requireAll || starts !== undefined) fields["starts_at"] = "Enter the date and time.";
  } else {
    startsAt = wallToInstant(starts);
    if (startsAt === null) fields["starts_at"] = "Enter a date and time in the agency time zone.";
    else if (startsAt !== null && new Date(startsAt).getTime() <= Date.now()) {
      fields["starts_at"] = "Enter a start time in the future.";
    }
  }

  const dur = body.duration_minutes;
  let duration = 0;
  if (typeof dur !== "number" || !Number.isInteger(dur)) {
    if (requireAll || dur !== undefined) fields["duration_minutes"] = "Enter the duration in minutes.";
  } else if (dur < 30 || dur > 480) {
    fields["duration_minutes"] = "Duration must be between 30 and 480 minutes.";
  } else {
    duration = dur;
  }

  const consumer = body.consumer_name;
  if (typeof consumer !== "string" || consumer.length < 1 || consumer.length > 120) {
    if (requireAll || consumer !== undefined) fields["consumer_name"] = "Enter the consumer's name (1 to 120 characters).";
  }

  const address = body.location_address;
  if (typeof address !== "string" || address.length < 1 || address.length > 200) {
    if (requireAll || address !== undefined) fields["location_address"] = "Enter the street address (1 to 200 characters).";
  }

  const city = body.city;
  if (typeof city !== "string" || city.length < 1 || city.length > 80) {
    if (requireAll || city !== undefined) fields["city"] = "Enter the city (1 to 80 characters).";
  }

  const notes = body.notes;
  if (notes !== undefined && (typeof notes !== "string" || notes.length > 2000)) {
    fields["notes"] = "Notes are limited to 2,000 characters.";
  }

  const cred = body.required_credential;
  let credential: CredentialCode | undefined;
  if (cred === undefined || cred === "") {
    if (requireAll) {
      const s = typeof setting === "string" && isSetting(setting) ? setting : null;
      if (s) credential = s === "medical" ? "NIC" : s === "education" ? "EIPA" : "SC:L";
      else credential = "NIC";
    }
  } else if (!isCredentialCode(cred)) {
    fields["required_credential"] = "Choose NIC, CDI, SC:L or EIPA.";
  } else {
    credential = cred;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  const settingValue = typeof setting === "string" && isSetting(setting)
    ? setting
    : null;
  const finalCred = credential ?? (settingValue === null ? null : (settingValue === "medical" ? "NIC" : settingValue === "education" ? "EIPA" : "SC:L"));
  if (requireAll && settingValue === null) return { ok: false, fields: { setting: "Choose a setting." } };
  if (requireAll && finalCred === null) return { ok: false, fields: { setting: "Choose a setting." } };
  return {
    ok: true,
    value: {
      setting: (settingValue ?? (typeof body.setting === "string" ? body.setting as Setting : "medical")) as Setting,
      startsAt: startsAt ?? "",
      duration,
      consumer: typeof consumer === "string" ? consumer : "",
      address: typeof address === "string" ? address : "",
      city: typeof city === "string" ? city : "",
      notes: typeof notes === "string" ? notes : "",
      credential: (finalCred ?? "NIC") as CredentialCode,
    },
  };
}

export function statusLabel(status: RequestStatus): string {
  switch (status) {
    case "draft": return "Draft";
    case "submitted": return "Open seat";
    case "half_staffed": return "Half-staffed";
    case "staffed": return "Staffed";
    case "completed": return "Completed";
    case "invoiced": return "Invoiced";
    case "cancelled_early": return "Cancelled";
    case "cancelled_late": return "Cancelled (late fee)";
  }
}

export { defaultTeamSize, derivedStatus, cancellationCutoff, weekMonday, agencyDateKey, windowsOverlap };
