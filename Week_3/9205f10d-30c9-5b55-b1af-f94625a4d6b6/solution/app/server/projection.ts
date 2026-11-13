/**
 * Who may read a request, and the field lists each role gets: the one place the API decides what
 * a response carries for its caller.
 */
import { toAgencyIso } from "../shared/agencyTime.js";
import type { User } from "./auth.js";
import { type Db, many } from "./db.js";
import { notFound } from "./errors.js";
import { type RequestRecord, endsAt } from "./requestStore.js";
import { CLAIMABLE, agencyToday, credentialStatus, dollars, freeCancelUntil } from "./rules.js";

type Audience = "staff" | "client" | "holder" | "interpreter";

function holdsSeat(viewer: User, record: RequestRecord): boolean {
  return record.seats.some((s) => s.interpreterId === viewer.id);
}

function audienceFor(viewer: User, record: RequestRecord): Audience {
  switch (viewer.role) {
    case "coordinator":
    case "billing_admin":
      return "staff";
    case "client_scheduler":
      return "client";
    case "interpreter":
      return holdsSeat(viewer, record) ? "holder" : "interpreter";
  }
}

/** Whether the viewer may read the request at all; everyone else is told it does not exist. */
function canRead(viewer: User, record: RequestRecord): boolean {
  switch (viewer.role) {
    case "coordinator":
    case "billing_admin":
      return true;
    case "client_scheduler":
      return record.organisation.id === viewer.organisation?.id;
    case "interpreter":
      return CLAIMABLE.includes(record.status) || holdsSeat(viewer, record);
  }
}

/** The record when the viewer may read it; otherwise the same not_found as a missing id. */
export function readable(viewer: User, record: RequestRecord | undefined): RequestRecord {
  if (!record || !canRead(viewer, record)) throw notFound();
  return record;
}

interface InterpreterRow {
  id: string;
  display_name: string;
  full_name: string;
  email: string;
  phone: string | null;
  home_area: string | null;
  pay_rate_cents: number | null;
}

interface CredentialRow {
  interpreter_id: string;
  credential_type: string;
  verified_at: Date | null;
  expires_on: string | null;
}

interface InterpreterCard {
  row: InterpreterRow;
  /** Credential codes verified and unexpired today, alphabetical. */
  badges: string[];
}

export async function interpreterCards(db: Db, ids: string[]): Promise<Map<string, InterpreterCard>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const people = await many<InterpreterRow>(
    db,
    "SELECT id, display_name, full_name, email, phone, home_area, pay_rate_cents FROM people WHERE id = ANY($1)",
    [unique],
  );
  const credentials = await many<CredentialRow>(
    db,
    "SELECT interpreter_id, credential_type, verified_at, expires_on FROM credentials WHERE interpreter_id = ANY($1)",
    [unique],
  );
  const today = agencyToday();
  return new Map(
    people.map((row) => {
      const badges = credentials
        .filter((c) => c.interpreter_id === row.id && credentialStatus(c.verified_at, c.expires_on, today) === "verified")
        .map((c) => c.credential_type);
      return [row.id, { row, badges: [...new Set(badges)].sort() }];
    }),
  );
}

function seatInterpreter(audience: Audience, card: InterpreterCard | undefined): Record<string, unknown> | null {
  if (!card) return null;
  const { row, badges } = card;
  switch (audience) {
    case "staff":
      return {
        id: row.id,
        display_name: row.display_name,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        home_area: row.home_area,
        pay_rate: row.pay_rate_cents === null ? null : dollars(row.pay_rate_cents),
        credentials: badges,
      };
    case "client":
      return { display_name: row.display_name, credentials: badges };
    case "holder":
      return { display_name: row.display_name, credentials: badges, phone: row.phone };
    case "interpreter":
      return null;
  }
}

interface HistoryRow {
  request_id: string;
  at: Date;
  actor: string;
  action: string;
  detail: string;
}

/** Projects requests for the viewer, carrying exactly the fields the API publishes for its role. */
export async function projectRequests(db: Db, viewer: User, records: RequestRecord[]): Promise<Record<string, unknown>[]> {
  const cards = await interpreterCards(
    db,
    records.flatMap((r) => r.seats.flatMap((s) => (s.interpreterId ? [s.interpreterId] : []))),
  );
  const staff = viewer.role === "coordinator" || viewer.role === "billing_admin";
  const history = staff
    ? await many<HistoryRow>(
        db,
        "SELECT request_id, at, actor, action, detail FROM history WHERE request_id = ANY($1) ORDER BY id",
        [records.map((r) => r.id)],
      )
    : [];

  return records.map((record) => {
    const audience = audienceFor(viewer, record);
    const base: Record<string, unknown> = {
      id: record.id,
      reference: record.reference,
      setting: record.setting,
      required_credential: record.requiredCredential,
      starts_at: toAgencyIso(record.startsAt),
      ends_at: toAgencyIso(endsAt(record)),
      duration_minutes: record.durationMinutes,
      city: record.city,
      status: record.status,
      team_size: record.teamSize,
      rotation_minutes: record.rotationMinutes,
      seats: record.seats.map((seat) => ({
        id: seat.id,
        label: seat.label,
        status: seat.interpreterId ? "confirmed" : "open",
        interpreter: seat.interpreterId ? seatInterpreter(audience, cards.get(seat.interpreterId)) : null,
      })),
    };
    const consumer = {
      consumer_name: record.consumerName,
      location_address: record.locationAddress,
      notes: record.notes,
    };
    const client = {
      organisation: record.organisation,
      free_cancel_until: toAgencyIso(freeCancelUntil(record.startsAt)),
      ...consumer,
      hourly_rate: dollars(record.hourlyRateCents),
      actual_minutes: record.actualMinutes,
    };
    switch (audience) {
      case "staff":
        return {
          ...base,
          ...client,
          team_reason: record.teamReason,
          history: history
            .filter((h) => h.request_id === record.id)
            .map((h) => ({ at: toAgencyIso(h.at), actor: h.actor, action: h.action, detail: h.detail })),
        };
      case "client":
        return { ...base, ...client };
      case "holder":
        return { ...base, ...consumer };
      case "interpreter":
        return base;
    }
  });
}

export async function projectRequest(db: Db, viewer: User, record: RequestRecord): Promise<Record<string, unknown>> {
  const [projected] = await projectRequests(db, viewer, [record]);
  return projected ?? {};
}
