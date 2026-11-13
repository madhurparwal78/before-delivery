import { AGENCY_TZ, centsToMoney, agencyDateKey, type CredentialCode, type Role, type Setting } from "../shared/domain.js";
import type { DbCredential, DbOrganisation, DbPerson, DbRequest, DbSeat } from "./db_types.js";

export type PublicCredential = {
  id: string;
  credential_type: CredentialCode;
  status: "uploaded" | "verified" | "expired";
  expires_on: string | null;
  uploaded_at: string;
  file_name: string | null;
};

export type PublicSeatInterpreter =
  | { id: string; display_name: string; full_name: string; email: string; phone: string; home_area: string; pay_rate: string; credentials: CredentialCode[] }
  | { display_name: string; credentials: CredentialCode[]; phone?: string }
  | { display_name: string; credentials: CredentialCode[] };

export type PublicSeat = {
  id: string;
  label: "A" | "B";
  status: "open" | "confirmed";
  interpreter: PublicSeatInterpreter | null;
};

export type PublicRequest = {
  id: string;
  reference: string;
  setting: Setting;
  required_credential: CredentialCode;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  city: string;
  status: DbRequest["status"];
  team_size: 1 | 2;
  rotation_minutes: number;
  seats: PublicSeat[];
  organisation?: { id: string; name: string; code: string } | undefined;
  free_cancel_until?: string | undefined;
  consumer_name?: string | undefined;
  location_address?: string | undefined;
  notes?: string | undefined;
  hourly_rate?: string | undefined;
  actual_minutes?: number | undefined;
  team_reason?: string | undefined;
  history?: Array<{ at: string; actor: string; action: string; detail: string }> | undefined;
};

export type Viewer = {
  person: DbPerson;
  organisation: DbOrganisation | null;
  /** interpreters with a confirmed seat on the request being projected */
  holdsSeatOn?: boolean | undefined;
  credentials?: PublicCredential[] | undefined;
  allInterpreters?: Map<string, { credentials: CredentialCode[] }> | undefined;
  history?: Array<{ at: string; actor: string; action: string; detail: string }> | undefined;
};

export function projectCredential(row: DbCredential): PublicCredential {
  return {
    id: row.id,
    credential_type: row.credential_type,
    status: row.status,
    expires_on: row.expires_on ? row.expires_on.toISOString().slice(0, 10) : null,
    uploaded_at: instantIso(row.uploaded_at),
    file_name: row.file_name,
  };
}

export function instantIso(d: Date): string {
  const offset = tzOffset(d);
  const shifted = new Date(d.getTime() + offset * 60_000);
  const iso = shifted.toISOString();
  // drop the Z and any milliseconds, then attach the agency offset
  const trimmed = iso.replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
  return `${trimmed}${offsetStr(offset)}`;
}

function tzOffset(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, timeZoneName: "longOffset" }).formatToParts(d);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return -300;
  const [, sign, hh, mm] = m;
  const v = Number(hh) * 60 + Number(mm);
  return sign === "-" ? -v : v;
}

function offsetStr(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

export function projectRequest(
  req: DbRequest,
  org: DbOrganisation,
  seats: Array<{ seat: DbSeat; interpreter: DbPerson | null }>,
  viewer: Viewer,
): PublicRequest {
  const base: PublicRequest = {
    id: req.id,
    reference: req.reference,
    setting: req.setting,
    required_credential: req.required_credential,
    starts_at: instantIso(req.starts_at),
    ends_at: instantIso(new Date(req.starts_at.getTime() + req.duration_minutes * 60_000)),
    duration_minutes: req.duration_minutes,
    city: req.city,
    status: req.status,
    team_size: req.team_size,
    rotation_minutes: req.rotation_minutes,
    seats: seats.map(({ seat, interpreter }) => projectSeat(seat, interpreter, viewer)),
  };
  const role = viewer.person.role;
  const scheduler = role === "client_scheduler" && viewer.organisation?.id === req.organisation_id;
  if (scheduler || role === "coordinator" || role === "billing_admin") {
    base.organisation = { id: org.id, name: org.name, code: org.code };
    base.free_cancel_until = instantIso(req.free_cancel_until);
    base.consumer_name = req.consumer_name;
    base.location_address = req.location_address;
    base.notes = req.notes;
    base.hourly_rate = centsToMoney(org.hourly_rate_cents);
    base.actual_minutes = req.actual_minutes ?? undefined;
  }
  if (role === "coordinator" || role === "billing_admin") {
    base.team_reason = req.team_reason ?? undefined;
    base.history = viewer.history ?? [];
  }
  if (role === "interpreter" && viewer.holdsSeatOn) {
    base.consumer_name = req.consumer_name;
    base.location_address = req.location_address;
    base.notes = req.notes;
  }
  return base;
}

/** The interpreter field of a confirmed seat, per caller. */
export function projectSeat(seat: DbSeat, interpreter: DbPerson | null, viewer: Viewer): PublicSeat {
  if (seat.status === "open" || !interpreter) {
    return { id: seat.id, label: seat.label, status: "open", interpreter: null };
  }
  const role = viewer.person.role;
  const credentials = (viewer.allInterpreters?.get(interpreter.id)?.credentials ?? []).slice().sort();
  if (role === "coordinator" || role === "billing_admin") {
    return {
      id: seat.id,
      label: seat.label,
      status: "confirmed",
      interpreter: {
        id: interpreter.id,
        display_name: interpreter.display_name,
        full_name: interpreter.full_name,
        email: interpreter.email,
        phone: interpreter.phone ?? "",
        home_area: interpreter.home_area ?? "",
        pay_rate: centsToMoney(interpreter.pay_rate_cents ?? 0),
        credentials,
      },
    };
  }
  if (role === "client_scheduler") {
    return {
      id: seat.id,
      label: seat.label,
      status: "confirmed",
      interpreter: { display_name: interpreter.display_name, credentials },
    };
  }
  if (role === "interpreter" && viewer.holdsSeatOn) {
    return {
      id: seat.id,
      label: seat.label,
      status: "confirmed",
      interpreter: viewer.person.id === interpreter.id
        ? { display_name: interpreter.display_name, credentials, phone: interpreter.phone ?? "" }
        : { display_name: interpreter.display_name, credentials, phone: interpreter.phone ?? "" },
    };
  }
  // any other interpreter sees the seat as taken
  return { id: seat.id, label: seat.label, status: "confirmed", interpreter: null };
}

export function projectUser(person: DbPerson, org: DbOrganisation | null): Record<string, unknown> {
  return {
    id: person.id,
    role: person.role,
    display_name: person.display_name,
    email: person.email,
    organisation: person.role === "client_scheduler" && org
      ? { id: org.id, name: org.name, code: org.code }
      : null,
  };
}

/** Alphabetical list of credential codes verified and unexpired today in agency time. */
export function credentialBadges(
  interpreterId: string,
  credentials: DbCredential[],
  today = new Date(),
): CredentialCode[] {
  const dayKey = agencyDateKey(today);
  const out = new Set<CredentialCode>();
  for (const c of credentials) {
    if (c.interpreter_id !== interpreterId) continue;
    if (c.status !== "verified") continue;
    if (!c.expires_on) continue;
    if (c.expires_on.toISOString().slice(0, 10) >= dayKey) out.add(c.credential_type);
  }
  return [...out].sort();
}
