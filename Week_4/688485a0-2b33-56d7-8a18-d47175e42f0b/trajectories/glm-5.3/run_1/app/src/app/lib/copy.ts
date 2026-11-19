import { JsonObj, JsonValue, displayNumber, displayValue } from "shared/values";

/**
 * Copy strings for feedback regions (the published copy in Feedback states).
 */

export function plural(n: number, noun: string): string {
  return `${displayNumber(n)} ${noun}${n === 1 ? "" : "s"}`;
}

export const queryStatus = {
  pending: "Running query",
  refused: "Query not run",
  result: (matched: number, shown: number): string =>
    matched === 0 ? "No documents matched" : `${plural(matched, "document")} matched, ${plural(shown, "document")} shown`,
};

export const planText = {
  firstLine: (plan: { kind: string; index: string | null }): string =>
    plan.kind === "index" && plan.index !== null ? `Used index ${plan.index}` : "Full scan",
  secondLine: (examined: number, returned: number): string =>
    `Examined ${plural(examined, "document")}, returned ${displayNumber(returned)}`,
};

export function fieldError(field: string): string {
  const names: Record<string, string> = { Filter: "Filter", Projection: "Projection", Sort: "Sort" };
  return `${names[field] ?? field} is not valid JSON`;
}

export const copy = {
  unknownOperator: (op: string): string => `Unknown operator ${op}`,
  invalidProjection: "Projection cannot mix inclusion and exclusion",
  scanLimit: (n: number): string => `Query stopped: more than ${displayNumber(n)} documents would be scanned. Add an index or narrow the filter.`,
  queryTooDeep: (n: number): string => `Query is nested deeper than ${displayNumber(n)} levels`,
  invalidQueryField: (field: string): string => {
    if (field === "filter") return "Filter is not valid";
    if (field === "projection") return "Projection is not valid";
    if (field === "sort") return "Sort is not valid";
    if (field === "limit") return "Limit must be a whole number of 0 or more";
    return "Page must be a whole number of 1 or more";
  },
  tooManyStages: (n: number): string => `Pipeline has more than ${displayNumber(n)} stages`,
  unknownStage: (stage: string): string => `Unknown stage ${stage}`,
  invalidStage: (n: number): string => `Stage ${n} is not valid`,
  stageStatus: (n: number, total: number, count: number): string =>
    `Stage ${n} of ${total}: ${displayNumber(count)} documents out`,
  stageStatusCapped: (n: number, total: number, limit: number): string =>
    `Stage ${n} of ${total}: \u2264${displayNumber(limit)} documents out`,
  passThrough: "pass through",
  pinStop: "Pinned document stops here",
  pinEnd: "Pinned document reaches the end",
  stageMoved: (n: number, total: number): string => `Stage moved to position ${n} of ${total}`,
  stageDeleted: (n: number): string => `Stage ${n} deleted`,
  savePending: "Saving",
  saveSaved: "Saved",
  readOnlyNote: "You have read access",
  docGone: "This document no longer exists",
  clash: "This document was changed by someone else.",
  importPending: "Loading file",
  importDone: (n: number): string => `Imported ${plural(n, "document")}`,
  tooManyLines: (n: number): string => `File has more than ${displayNumber(n)} lines`,
  importFailed: "Import failed",
  indexPending: "Creating index",
  indexDone: (name: string): string => `Index ${name} created`,
  invalidIndex: "Index keys are not valid",
  rulesSaved: "Rules saved",
  invalidValidator: "Rules are not valid",
  invitationCreated: (email: string): string => `Invitation created for ${email}`,
  alreadyMember: "Already a member",
  alreadyInvited: "Already invited",
  nameTaken: "A saved query with this name already exists",
  lastRun: (time: string | null, count: number | null): string => {
    if (time === null || count === null) return "Never run";
    return `Last run ${time.slice(0, 16).replace("T", " ")} UTC, ${displayNumber(count)} documents matched`;
  },
  noInvitations: "No invitations",
  schemaPresence: (present: number): string => `Present in ${present}% of documents`,
  schemaShare: (type: string, share: number): string => `${type} ${share}%`,
  emptyCollection: "NOTHING IN THIS JAR YET",
  outage: "File storage is unavailable. Try again later.",
  account: {
    codeSent: (email: string): string => `Check ${email} for your code`,
    invalidCode: "That code is not right",
    invalidCredentials: "Email or password is not right",
    notConfirmed: "Confirm your email first",
    emailTaken: "An account with this email already exists",
  },
};

/** Map an API error to the published message for the region that shows it. */
export function apiErrorMessage(err: { status: number; code: string; extras: Record<string, unknown> }): string {
  switch (err.code) {
    case "unknown_operator": return copy.unknownOperator(String(err.extras.operator ?? ""));
    case "invalid_projection": return copy.invalidProjection;
    case "scan_limit": return copy.scanLimit(numberExtra(err.extras.limit));
    case "query_too_deep": return copy.queryTooDeep(numberExtra(err.extras.limit));
    case "invalid_query":
      return copy.invalidQueryField(String(err.extras.field ?? "filter"));
    case "too_many_stages": return copy.tooManyStages(numberExtra(err.extras.limit));
    case "unknown_stage": return copy.unknownStage(String(err.extras.stage ?? ""));
    case "invalid_stage": return copy.invalidStage(numberExtra(err.extras.index) + 1);
    case "too_many_lines": return copy.tooManyLines(numberExtra(err.extras.limit));
    case "invalid_index": return copy.invalidIndex;
    case "not_confirmed": return copy.account.notConfirmed;
    case "invalid_code": return copy.account.invalidCode;
    case "invalid_credentials": return copy.account.invalidCredentials;
    case "email_taken": return copy.account.emailTaken;
    case "read_only": return copy.readOnlyNote;
    case "document_too_large": return `document is larger than ${numberExtra(err.extras.limit)} bytes`;
    case "document_too_deep": return `document is nested deeper than ${numberExtra(err.extras.limit)} levels`;
    case "invalid_field_name": return `invalid field name at ${String(err.extras.path ?? "")}`;
    case "validation_failed": {
      const path = String(err.extras.path ?? "");
      const rule = String(err.extras.rule ?? "");
      if (rule === "required") return `Document failed validation at ${path}: required field is missing`;
      return `Document failed validation at ${path}`;
    }
    case "duplicate_key": {
      const value = jsonText(err.extras.value);
      return `Duplicate value ${value} for unique index ${String(err.extras.index ?? "")}`;
    }
    default: return err.code.replace(/_/g, " ");
  }
}

function numberExtra(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function jsonText(v: unknown): string {
  if (v === undefined || v === null) return "null";
  return JSON.stringify(v);
}

/** The one document display used in Save status and load reports. */
export function documentCell(value: JsonValue): string {
  return displayValue(value);
}

export { displayNumber };
export type { JsonObj, JsonValue };
