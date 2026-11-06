// Draft validation: which members a create or save accepts, and every field rule and holdings
// reconciliation. Decided here and nowhere else.

import {
  addDecimal,
  compareDecimal,
  parseDecimal,
  type Decimal,
} from "../shared/decimal.ts";
import { ROW_KEYS, SHARE_EVENT_KINDS, type RowKey, type ShareEventKind } from "../shared/domain.ts";
import { addCalendarDays, parseCalendarDate, weekStartDate } from "../shared/newyork.ts";
import { rowsOf, type StoredRows } from "./restatementRows.ts";

const CANNOT_CHANGE = "This field cannot be changed here.";

export type DraftMode = "weekly-create" | "correction-create" | "save";

export interface DraftShareEvent {
  kind: ShareEventKind;
  shares: string;
  effectiveDate: string;
}

export type DraftRows = StoredRows;

export interface DraftChanges {
  rows?: DraftRows;
  shareEvents?: DraftShareEvent[];
  accession?: string | null;
  exhibitPage?: number | null;
  correctionReason?: string | null;
}

export interface StoredDraft {
  rows: DraftRows;
  shareEvents: DraftShareEvent[];
  accession: string | null;
  exhibitPage: number | null;
  correctionReason: string | null;
}

export interface DraftContext {
  weekEnding: string;
  isCorrection: boolean;
  /** The current restatement of the week before this one, when there is one. */
  priorRows: DraftRows | null;
  /** Diluted share count in effect before the week: opening count plus every published event, minus the superseded restatement's. */
  sharesBeforeWeek: bigint;
  stored: StoredDraft;
  /** Submit treats a missing row, event field, accession, exhibit page or correction reason as failing. */
  requireComplete: boolean;
}

export interface DraftOutcome {
  fields: Record<string, string>;
  changes: DraftChanges;
}

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const INTEGER_PATTERN = /^[1-9]\d{0,14}$/;
const ETH_PATTERN = /^\d{1,18}(\.\d{1,18})?$/;
const EVENT_ATTRIBUTES = ["kind", "shares", "effective_date", "id"];
const SHARED_MEMBERS = ["rows", "share_events", "accession", "exhibit_page"];

function allowedMembers(mode: DraftMode, isCorrection: boolean): string[] {
  if (mode === "weekly-create") return [...SHARED_MEMBERS, "week_ending"];
  if (mode === "correction-create") return [...SHARED_MEMBERS, "supersedes", "correction_reason"];
  return isCorrection ? [...SHARED_MEMBERS, "version", "correction_reason"] : [...SHARED_MEMBERS, "version"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimalOf(rows: DraftRows, key: RowKey): Decimal | null {
  const value = rows[key];
  return value === null ? null : parseDecimal(value);
}

function validateRowValue(key: RowKey, value: unknown): string | null {
  if (typeof value !== "string") return "Enter the value as text.";
  if (key === "diluted-shares") return INTEGER_PATTERN.test(value) ? null : "Enter a whole number of shares greater than zero, up to 15 digits.";
  return ETH_PATTERN.test(value) ? null : "Enter a number of zero or more with at most 18 decimal places.";
}

function rowsFrom(value: unknown, fields: Record<string, string>): DraftRows | undefined {
  if (!isRecord(value)) {
    fields["rows"] = "Enter the six exhibit rows.";
    return undefined;
  }
  const rows = rowsOf({});
  for (const [name, entry] of Object.entries(value)) {
    const key = ROW_KEYS.find((candidate) => candidate === name);
    if (!key) {
      fields[`rows.${name}`] = CANNOT_CHANGE;
    } else if (entry !== null) {
      const problem = validateRowValue(key, entry);
      if (problem) fields[`rows.${key}`] = problem;
      else if (typeof entry === "string") rows[key] = entry;
    }
  }
  return rows;
}

function eventsFrom(value: unknown, context: DraftContext, fields: Record<string, string>): DraftShareEvent[] | undefined {
  if (!Array.isArray(value)) {
    fields["share_events"] = "Enter the share-count events as a list.";
    return undefined;
  }
  const monday = weekStartDate(context.weekEnding);
  const events: DraftShareEvent[] = [];
  value.forEach((entry: unknown, index) => {
    const at = `share_events.${index}`;
    if (!isRecord(entry)) {
      fields[at] = "Enter the event as an object.";
      return;
    }
    for (const name of Object.keys(entry)) {
      if (!EVENT_ATTRIBUTES.includes(name)) fields[`${at}.${name}`] = CANNOT_CHANGE;
    }
    const kind = SHARE_EVENT_KINDS.find((candidate) => candidate === entry["kind"]);
    if (!kind) fields[`${at}.kind`] = "Choose an event type.";
    const shares = entry["shares"];
    if (typeof shares !== "string" || !INTEGER_PATTERN.test(shares)) fields[`${at}.shares`] = "Enter a whole number of shares greater than zero, up to 15 digits.";
    const effective = entry["effective_date"];
    if (typeof effective !== "string" || !parseCalendarDate(effective)) {
      fields[`${at}.effective_date`] = "Enter the effective date as YYYY-MM-DD.";
    } else if (effective < monday || effective > context.weekEnding) {
      fields[`${at}.effective_date`] = `Enter a date from ${monday} to ${context.weekEnding}.`;
    }
    if (kind && typeof shares === "string" && typeof effective === "string" && !fields[`${at}.shares`] && !fields[`${at}.effective_date`]) {
      events.push({ kind, shares, effectiveDate: effective });
    }
  });
  return events;
}

function signedShares(event: DraftShareEvent): bigint {
  const amount = BigInt(event.shares);
  return event.kind === "buyback" ? -amount : amount;
}

/** The count after every event, applied in effective-date order (ties in request order); flags the first event reaching zero. */
function checkRunningCount(events: DraftShareEvent[], context: DraftContext, fields: Record<string, string>): bigint | null {
  const ordered = events.map((event, index) => ({ event, index })).sort((a, b) => a.event.effectiveDate.localeCompare(b.event.effectiveDate) || a.index - b.index);
  let count = context.sharesBeforeWeek;
  for (const { event, index } of ordered) {
    count += signedShares(event);
    if (count <= 0n) {
      fields[`share_events.${index}.shares`] = "The diluted share count must stay above zero after this event.";
      return null;
    }
  }
  return count;
}

function mustEqual(fields: Record<string, string>, key: RowKey, actual: Decimal, expected: Decimal, why: string): void {
  if (compareDecimal(actual, expected) !== 0) fields[`rows.${key}`] = why;
}

function reconcileRows(rows: DraftRows, context: DraftContext, expectedShares: bigint | null, fields: Record<string, string>): void {
  const beginning = decimalOf(rows, "beginning-balance");
  const acquired = decimalOf(rows, "eth-acquired");
  const rewards = decimalOf(rows, "staking-rewards");
  const ending = decimalOf(rows, "ending-balance");
  const cumulative = decimalOf(rows, "cumulative-staking-rewards");
  const shares = rows["diluted-shares"];
  const prior = context.priorRows;
  const priorEnding = prior ? decimalOf(prior, "ending-balance") : null;
  const priorCumulative = prior ? decimalOf(prior, "cumulative-staking-rewards") : null;
  if (beginning && priorEnding && !fields["rows.beginning-balance"]) {
    mustEqual(fields, "beginning-balance", beginning, priorEnding, "Must equal the prior week's ending balance.");
  }
  if (beginning && acquired && rewards && ending && !fields["rows.ending-balance"]) {
    mustEqual(fields, "ending-balance", ending, addDecimal(addDecimal(beginning, acquired), rewards), "Must equal the beginning balance plus ETH acquired plus staking rewards.");
  }
  if (cumulative && rewards && priorCumulative && !fields["rows.cumulative-staking-rewards"]) {
    mustEqual(fields, "cumulative-staking-rewards", cumulative, addDecimal(priorCumulative, rewards), "Must equal the prior week's cumulative staking rewards plus this week's staking rewards.");
  }
  if (shares && expectedShares !== null && !fields["rows.diluted-shares"] && BigInt(shares) !== expectedShares) {
    fields["rows.diluted-shares"] = "Must equal the diluted share count in effect on the week-ending date.";
  }
}

function checkComplete(rows: DraftRows, accession: string | null, exhibitPage: number | null, reason: string | null, context: DraftContext, fields: Record<string, string>): void {
  for (const key of ROW_KEYS) {
    if (rows[key] === null && !fields[`rows.${key}`]) fields[`rows.${key}`] = "Enter a value.";
  }
  if (accession === null) fields["accession"] = "Enter the accession number.";
  if (exhibitPage === null) fields["exhibit_page"] = "Enter the exhibit page.";
  if (context.isCorrection && reason === null) fields["correction_reason"] = "Enter the reason for the correction.";
}

export function validateDraft(input: Record<string, unknown>, mode: DraftMode, context: DraftContext): DraftOutcome {
  const fields: Record<string, string> = {};
  const changes: DraftChanges = {};
  const allowed = allowedMembers(mode, context.isCorrection);
  for (const name of Object.keys(input)) {
    if (!allowed.includes(name)) fields[name] = CANNOT_CHANGE;
  }
  if (mode === "weekly-create" && "week_ending" in input) {
    const asked = input["week_ending"];
    if (typeof asked !== "string" || !parseCalendarDate(asked)) fields["week_ending"] = "Enter the week ending as YYYY-MM-DD.";
  }
  if ("rows" in input) {
    const rows = rowsFrom(input["rows"], fields);
    if (rows) changes.rows = rows;
  }
  if ("share_events" in input) {
    const events = eventsFrom(input["share_events"], context, fields);
    if (events) changes.shareEvents = events;
  }
  if ("accession" in input) {
    const accession = input["accession"];
    if (accession === null) changes.accession = null;
    else if (typeof accession === "string" && ACCESSION_PATTERN.test(accession)) changes.accession = accession;
    else fields["accession"] = "Enter the accession as ten digits, a dash, two digits, a dash and six digits.";
  }
  if ("exhibit_page" in input) {
    const page = input["exhibit_page"];
    if (page === null) changes.exhibitPage = null;
    else if (typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= 500) changes.exhibitPage = page;
    else fields["exhibit_page"] = "Enter a page from 1 to 500.";
  }
  if ("correction_reason" in input && allowed.includes("correction_reason")) {
    const reason = input["correction_reason"];
    if (reason === null) changes.correctionReason = null;
    else if (typeof reason === "string" && reason.length >= 10 && reason.length <= 500) changes.correctionReason = reason;
    else fields["correction_reason"] = "Enter a reason of 10 to 500 characters.";
  }
  const rows = changes.rows ?? context.stored.rows;
  const events = changes.shareEvents ?? context.stored.shareEvents;
  if (changes.rows || changes.shareEvents || context.requireComplete) {
    const expected = checkRunningCount(events, context, fields);
    reconcileRows(rows, context, expected, fields);
  }
  if (context.requireComplete) {
    const accession = changes.accession === undefined ? context.stored.accession : changes.accession;
    const page = changes.exhibitPage === undefined ? context.stored.exhibitPage : changes.exhibitPage;
    const reason = changes.correctionReason === undefined ? context.stored.correctionReason : changes.correctionReason;
    checkComplete(rows, accession, page, reason, context, fields);
  }
  return { fields, changes };
}

/** `version` on a save, clear or withdraw: a positive integer. */
export function claimedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function nextSunday(sunday: string): string {
  return addCalendarDays(sunday, 7);
}
