// Legacy feedback import (brief: Business rules › Legacy import): header, skip reasons in order, matching.
import type { ImportOutcome, SkipReason } from "../../shared/api.js";
import { collapseWhitespace, splitsSurrogatePair } from "../../shared/noteText.js";
import { readCsv } from "./csv.js";
import { isCalendarDate } from "./time.js";

const IMPORT_HEADER = ["contact_email", "contact_name", "company_name", "feedback", "received_on"];
const MAX_IMPORT_ROWS = 2000;
const TITLE_LENGTH = 60;
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
]);

export interface ImportRow { line: number; email: string; contactName: string; companyName: string; feedback: string; receivedOn: string }

/** Reads the pasted CSV into rows, or names the problem with the header or the row count. */
export function readImport(csv: string): { rows: ImportRow[] } | { problem: string } {
  const [header, ...records] = readCsv(csv);
  const names = header?.fields.map((f) => f.trim().toLowerCase()) ?? [];
  if (names.length !== IMPORT_HEADER.length || names.some((n, i) => n !== IMPORT_HEADER[i])) {
    return { problem: "The CSV header does not match the legacy feedback format." };
  }
  if (records.length > MAX_IMPORT_ROWS) return { problem: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` };
  return { rows: records.map(({ line, fields }) => ({
    line,
    email: fields[0] ?? "", contactName: fields[1] ?? "", companyName: fields[2] ?? "", feedback: fields[3] ?? "", receivedOn: fields[4] ?? "",
  })) };
}

export const normalEmail = (email: string): string => email.trim().toLowerCase();
export const emailDomain = (email: string): string => (email.split("@")[1] ?? "").replace(/^www\./, "");
/** The duplicate key of a note: its feedback with whitespace collapsed, and its received date (blank is its own value). */
export const duplicateKey = (text: string, receivedOn: string | null): string => `${collapseWhitespace(text)}\u0000${receivedOn ?? ""}`;

function skipReason(row: ImportRow): SkipReason | null {
  const email = row.email.trim();
  if (email === "") return "missing_email";
  const at = email.split("@");
  if (at.length !== 2 || !(at[1] ?? "").includes(".")) return "invalid_email";
  if (row.feedback.trim() === "") return "missing_feedback";
  const date = row.receivedOn.trim();
  if (date !== "" && !isCalendarDate(date)) return "invalid_date";
  return null;
}

function noteTitle(feedback: string): string {
  if (feedback.length <= TITLE_LENGTH) return feedback;
  const cut = splitsSurrogatePair(feedback, TITLE_LENGTH) ? TITLE_LENGTH - 1 : TITLE_LENGTH;
  return `${feedback.slice(0, cut)}…`;
}

/** What the workspace already holds, as far as the file's rows can touch it. */
export interface ImportWorld {
  contacts: Map<string, { id: string; companyId: string | null }>;
  companiesByDomain: Map<string, string>;
  noteKeys: Map<string, Set<string>>;
}

export type Ref = { existing: string } | { created: number };

export interface PlannedRow { line: number; outcome: ImportOutcome; reason: SkipReason | null; note: number | null }
export interface ImportPlan {
  rows: PlannedRow[];
  contacts: { email: string; name: string; company: Ref | null }[];
  companies: { name: string; domain: string }[];
  notes: { contact: Ref; title: string; feedback: string; receivedOn: string | null }[];
}

export function planImport(rows: readonly ImportRow[], world: ImportWorld): ImportPlan {
  const plan: ImportPlan = { rows: [], contacts: [], companies: [], notes: [] };
  const contacts = new Map<string, Ref>([...world.contacts].map(([email, c]) => [email, { existing: c.id }]));
  const companies = new Map<string, Ref>([...world.companiesByDomain].map(([domain, id]) => [domain, { existing: id }]));
  const keys = new Map<string, Set<string>>();
  for (const [email, c] of world.contacts) keys.set(email, world.noteKeys.get(c.id) ?? new Set());

  for (const row of rows) {
    const reason = skipReason(row);
    const email = normalEmail(row.email);
    const feedback = collapseWhitespace(row.feedback);
    const receivedOn = row.receivedOn.trim() === "" ? null : row.receivedOn.trim();
    const key = duplicateKey(feedback, receivedOn);
    if (reason !== null || keys.get(email)?.has(key)) {
      plan.rows.push({ line: row.line, outcome: "skipped", reason: reason ?? "duplicate", note: null });
      continue;
    }
    let contact = contacts.get(email);
    const outcome: ImportOutcome = contact ? "matched" : "created";
    if (!contact) {
      const domain = emailDomain(email);
      let company: Ref | null = null;
      if (!PERSONAL_DOMAINS.has(domain)) {
        company = companies.get(domain) ?? { created: plan.companies.push({ name: row.companyName.trim() || domain, domain }) - 1 };
        companies.set(domain, company);
      }
      contact = { created: plan.contacts.push({ email, name: row.contactName.trim() || (email.split("@")[0] ?? ""), company }) - 1 };
      contacts.set(email, contact);
      keys.set(email, new Set());
    }
    keys.get(email)?.add(key);
    plan.notes.push({ contact, title: noteTitle(feedback), feedback, receivedOn });
    plan.rows.push({ line: row.line, outcome, reason: null, note: plan.notes.length - 1 });
  }
  return plan;
}
