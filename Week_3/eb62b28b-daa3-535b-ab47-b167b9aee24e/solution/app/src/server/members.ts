// Member records: reading, the published views and the profile fields.

import { Sex, type AccountState, type BillingProjection, type Cadence, type Membership, type MemberView } from "../shared/api";
import { isIsoDate, isTimeZone, localDate, wholeSeconds, type TimeZone } from "../shared/time";
import { isServed, stateCheckCopy, US_STATES } from "./catalog";
import { isUniqueViolation, one, pool, type Db } from "./db";
import { conflict, invalid, notFound } from "./errors";
import { isOneOf, isRecord, text, nullableText, type JsonBody } from "./fields";
import { hashPassword } from "./sessions";

export interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  sex: Sex | null;
  state: string | null;
  time_zone: TimeZone | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  gate_notes: string | null;
  account_state: AccountState;
  erases_at: Date | null;
  membership_state: Membership["state"];
  cadence: Cadence | null;
  renewal_date: string | null;
  plus_until: string | null;
  pending_cadence: Cadence | null;
  pending_from: string | null;
  killbill_account_id: string | null;
  killbill_subscription_id: string | null;
  membership_before_closure: unknown;
  seed_receipt_number: number | null;
  thread_state: "open" | "handled";
  killbill_scrub_needed: boolean;
}

// A member who still has their personal data, which is every member but one being erased.
export interface LiveMember extends MemberRow {
  email: string;
  date_of_birth: string;
  sex: Sex;
  state: string;
  time_zone: TimeZone;
}

export function isLive(row: MemberRow): row is LiveMember {
  return row.account_state === "active" || row.account_state === "closing";
}

const SELECT_MEMBER = "SELECT m.*, p.name, p.email FROM members m JOIN people p ON p.id = m.id";

export async function memberRow(db: Db, id: string): Promise<MemberRow | undefined> {
  return one<MemberRow>(db, `${SELECT_MEMBER} WHERE m.id = $1`, [id]);
}

export async function requireMemberRow(db: Db, id: string): Promise<MemberRow> {
  const row = await memberRow(db, id);
  if (!row) throw notFound();
  return row;
}

export async function liveMemberOr404(id: string): Promise<LiveMember> {
  const row = await memberRow(pool, id);
  if (!row || !isLive(row)) throw notFound();
  return row;
}

export async function allMembers(query: string | null): Promise<MemberRow[]> {
  const sql = query
    ? `${SELECT_MEMBER} WHERE p.name ILIKE $1 OR p.email ILIKE $1 ORDER BY p.name`
    : `${SELECT_MEMBER} ORDER BY p.name`;
  return (await pool.query<MemberRow>(sql, query ? [`%${query}%`] : [])).rows;
}

export function membershipView(row: MemberRow): Membership {
  return {
    state: row.membership_state,
    cadence: row.cadence,
    renewalDate: row.renewal_date,
    plusUntil: row.plus_until,
    pendingCadence: row.pending_cadence,
    pendingFrom: row.pending_from,
  };
}

export function memberView(row: MemberRow): MemberView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.date_of_birth,
    sex: row.sex,
    state: row.state,
    timeZone: row.time_zone,
    address: row.address_line1 === null
      ? null
      : { line1: row.address_line1, line2: row.address_line2 ?? "", city: row.city ?? "", postalCode: row.postal_code ?? "" },
    gateNotes: row.gate_notes,
    accountState: row.account_state,
    erasesAt: row.erases_at ? wholeSeconds(row.erases_at) : null,
    membership: membershipView(row),
  };
}

export function billingProjection(row: MemberRow): BillingProjection {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    accountState: row.account_state,
    membership: membershipView(row),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_COPY = "Use at least 12 characters.";
export const OPTIONS_COPY = "Choose one of the options.";
export const EMAIL_COPY = "Enter a valid email address.";
export const NAME_COPY = "Enter your full name.";

export function isValidEmail(email: string): boolean {
  return EMAIL.test(email);
}

export function isLongEnoughPassword(password: string): boolean {
  return [...password].length >= 12;
}

export interface NewMemberFields {
  name: string;
  email: string;
  password: string;
  dateOfBirth: string;
  sex: Sex;
  state: string;
  timeZone: TimeZone;
}

function isAdult(dateOfBirth: string, today: string): boolean {
  const eighteenthBirthday = `${String(Number(dateOfBirth.slice(0, 4)) + 18).padStart(4, "0")}${dateOfBirth.slice(4)}`;
  return eighteenthBirthday <= today;
}

// The fields every new member gives; the result is a checked record or a 422 naming each bad field.
export function readNewMember(body: JsonBody, now: Date): NewMemberFields {
  const fields: Record<string, string> = {};
  const name = text(body, "name").trim();
  const email = text(body, "email").trim();
  const password = text(body, "password");
  const dateOfBirth = text(body, "dateOfBirth");
  const state = text(body, "state");
  const sex = body["sex"];
  const timeZone = body["timeZone"];
  if (!name) fields["name"] = NAME_COPY;
  if (!isValidEmail(email)) fields["email"] = EMAIL_COPY;
  if (!isLongEnoughPassword(password)) fields["password"] = PASSWORD_COPY;
  if (!isIsoDate(dateOfBirth)) fields["dateOfBirth"] = "Enter the date as YYYY-MM-DD.";
  if (!isOneOf(Sex.options, sex)) fields["sex"] = OPTIONS_COPY;
  if (!isTimeZone(timeZone)) fields["timeZone"] = OPTIONS_COPY;
  if (!US_STATES.some((entry) => entry.code === state)) fields["state"] = OPTIONS_COPY;
  else if (!isServed(state)) fields["state"] = stateCheckCopy(state);
  if (!isOneOf(Sex.options, sex) || !isTimeZone(timeZone) || Object.keys(fields).length > 0) throw invalid(fields);
  if (!isAdult(dateOfBirth, localDate(now, timeZone))) throw invalid({ dateOfBirth: "Members must be 18 or older." });
  return { name, email, password, dateOfBirth, sex, state, timeZone };
}

export interface Profile {
  phone: string | null;
  line1: string | null;
  line2: string;
  city: string;
  postalCode: string;
  gateNotes: string | null;
}

export function readProfile(body: JsonBody): Profile {
  const address = isRecord(body["address"]) ? body["address"] : {};
  const line1 = nullableText(address, "line1");
  const postalCode = text(address, "postalCode");
  if ((line1 !== null || postalCode !== "") && !/^\d{5}$/.test(postalCode)) throw invalid({ postalCode: "Enter a 5-digit ZIP code." });
  return {
    phone: nullableText(body, "phone"),
    line1,
    line2: text(address, "line2"),
    city: text(address, "city"),
    postalCode,
    gateNotes: nullableText(body, "gateNotes"),
  };
}

export async function emailIsTaken(db: Db, email: string): Promise<boolean> {
  return (await one(db, "SELECT 1 FROM people WHERE lower(email) = lower($1)", [email])) !== undefined;
}

export const emailTaken = (): Error => conflict("email_taken", "An account with this email already exists.");

export async function insertMember(db: Db, id: string, fields: NewMemberFields, profile: Profile | null): Promise<void> {
  try {
    await db.query("INSERT INTO people (id, role, name, email, password_hash) VALUES ($1, 'member', $2, $3, $4)", [
      id,
      fields.name,
      fields.email,
      await hashPassword(fields.password),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw emailTaken();
    throw error;
  }
  await db.query(
    `INSERT INTO members (id, phone, date_of_birth, sex, state, time_zone, address_line1, address_line2, city, postal_code, gate_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id, profile?.phone ?? null, fields.dateOfBirth, fields.sex, fields.state, fields.timeZone,
      profile?.line1 ?? null, profile?.line2 ?? null, profile?.city ?? null, profile?.postalCode ?? null, profile?.gateNotes ?? null,
    ],
  );
}

export async function saveProfile(id: string, profile: Profile): Promise<void> {
  await pool.query(
    `UPDATE members SET phone = $2, address_line1 = $3, address_line2 = $4, city = $5, postal_code = $6, gate_notes = $7 WHERE id = $1`,
    [id, profile.phone, profile.line1, profile.line2, profile.city, profile.postalCode, profile.gateNotes],
  );
}

