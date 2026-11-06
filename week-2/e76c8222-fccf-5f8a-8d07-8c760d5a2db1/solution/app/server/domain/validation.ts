// Field validation; every failing field is reported together.
import { CREDENTIAL_TYPES, SETTINGS, type CredentialType, type Setting } from "../../shared/domain.js";
import { isCalendarDate } from "../../shared/time.js";
import { invalid } from "../errors.js";

const MINUTE = 60_000;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** An ISO 8601 time with an offset, or null. */
function instant(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const length = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.trim().length >= min && value.length <= max;

export interface RequestFields {
  title: string;
  setting: Setting;
  location: string;
  start: Date;
  end: Date;
  consumerId: string;
  notes: string;
}

/** Create and patch validation. `loggedAfter` requests start in the past (≤ 14 days); others in the future. */
export function requestFields(
  input: Record<string, unknown>,
  loggedAfter: boolean,
  consumerIds: ReadonlySet<string>,
  now: Date,
  extra: Record<string, string> = {},
): RequestFields {
  const fields: Record<string, string> = { ...extra };
  if (!length(input.title, 1, 120)) fields.title = "Enter a title of 1 to 120 characters.";
  const setting = SETTINGS.find((s) => s === input.setting);
  if (!setting) fields.setting = "Choose Medical, Legal, Education or Community.";
  if (!length(input.location, 1, 200)) fields.location = "Enter a location of 1 to 200 characters.";
  const start = instant(input.start);
  const end = instant(input.end);
  if (!start) fields.start = "Enter the start as a date and time, for example 2026-10-27T14:00.";
  if (!end) fields.end = "Enter the end as a date and time, for example 2026-10-27T15:00.";
  if (start && end) {
    const minutes = (end.getTime() - start.getTime()) / MINUTE;
    if (minutes <= 0) fields.end = "The end must be after the start.";
    else if (minutes < 30 || minutes > 600) fields.end = "A request lasts from 30 minutes to 10 hours.";
  }
  if (start && !loggedAfter && start.getTime() <= now.getTime()) fields.start = "The start must be in the future.";
  if (start && loggedAfter && (start.getTime() > now.getTime() || start.getTime() < now.getTime() - 14 * 24 * 60 * MINUTE)) {
    fields.start = "A request logged after the fact must have started within the last 14 days.";
  }
  const consumerId = typeof input.consumer_id === "string" ? input.consumer_id : "";
  if (!consumerIds.has(consumerId)) fields.consumer_id = "Choose a Deaf consumer.";
  const notes = input.notes ?? "";
  if (typeof notes !== "string" || notes.length > 2000) fields.notes = "Notes can be at most 2000 characters.";
  if (Object.keys(fields).length || !setting || !start || !end || typeof notes !== "string") throw invalid(fields);
  return { title: String(input.title).trim(), setting, location: String(input.location).trim(), start, end, consumerId, notes };
}

interface TimesheetFields {
  actualStart: Date;
  actualEnd: Date;
  signatureName: string;
}

export function timesheetFields(input: Record<string, unknown>): TimesheetFields {
  const fields: Record<string, string> = {};
  const actualStart = instant(input.actual_start);
  const actualEnd = instant(input.actual_end);
  if (!actualStart) fields.actual_start = "Enter the actual start, for example 2026-10-27T14:00.";
  if (!actualEnd) fields.actual_end = "Enter the actual end, for example 2026-10-27T15:10.";
  if (actualStart && actualEnd) {
    const minutes = (actualEnd.getTime() - actualStart.getTime()) / MINUTE;
    if (minutes <= 0) fields.actual_end = "The actual end must be after the actual start.";
    else if (minutes > 12 * 60) fields.actual_end = "A timesheet covers at most 12 hours.";
  }
  if (!length(input.signature_name, 2, 120)) fields.signature_name = "Sign with your name, 2 to 120 characters.";
  if (Object.keys(fields).length || !actualStart || !actualEnd) throw invalid(fields);
  return { actualStart, actualEnd, signatureName: String(input.signature_name).trim() };
}

interface CredentialFields {
  type: CredentialType;
  number: string;
  expiresOn: string;
}

/** Credential fields and the scan part; a missing scan is reported with the other fields. */
export function credentialFields<T>(input: Record<string, string>, scan: T | undefined): CredentialFields & { scan: T } {
  const fields: Record<string, string> = {};
  const type = CREDENTIAL_TYPES.find((t) => t === input.type);
  if (!type) fields.type = "Choose NIC, CDI, SC:L or EIPA-4.0.";
  const number = (input.number ?? "").trim();
  if (number.length < 1 || number.length > 40) fields.number = "Enter the credential number, 1 to 40 characters.";
  const expiresOn = (input.expires_on ?? "").trim();
  if (!isCalendarDate(expiresOn)) fields.expires_on = "Enter the expiry date as YYYY-MM-DD, for example 2027-06-30.";
  if (scan === undefined) fields.scan = "Choose a scan of the credential.";
  if (Object.keys(fields).length || !type || scan === undefined) throw invalid(fields);
  return { type, number, expiresOn, scan };
}
