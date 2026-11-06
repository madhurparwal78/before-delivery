// Cycles: the state machine, the cutoff switch, the field rules, revisions and the Cycle shape.
import type { IncomingMessage } from "node:http";
import { cutoffDisplay, HOUR, isoInstant, pickupDisplay, readLocal } from "./clubtime.js";
import { creditOf } from "./credit.js";
import { all, nowSeconds, one, run } from "./db.js";
import { ApiError, assertValid, conflict, notFound } from "./errors.js";
import { lineJson, lineRows } from "./lines.js";
import type { Viewer } from "./session.js";

export type CycleStatus = "draft" | "open" | "sealing" | "ordered" | "received" | "breakdown" | "closing" | "closed";

export interface CycleRow {
  seq: number;
  id: string;
  name: string;
  status: CycleStatus;
  revision: number;
  cutoff_at: number | null;
  pickup_start_at: number | null;
  pickup_end_at: number | null;
  close_key: string | null;
  close_started_at: number | null;
}

const PICKUP_MAX_SECONDS = 12 * HOUR;

/** The cutoff switch: an open cycle whose cutoff has passed is sealing on every read and write. */
export function effectiveStatus(c: CycleRow, now = nowSeconds()): CycleStatus {
  return c.status === "open" && c.cutoff_at !== null && now >= c.cutoff_at ? "sealing" : c.status;
}

/** A fresh pledge change is accepted only while the server clock is strictly before cutoff. */
export function acceptingPledges(c: CycleRow, now = nowSeconds()): boolean {
  return effectiveStatus(c, now) === "open";
}

export function cycleRow(id: string): CycleRow | undefined {
  return one<CycleRow>("SELECT * FROM cycles WHERE id = ?", id);
}

/** The cycle as the viewer may see it: drafts exist only for the coordinator. */
export function visibleCycle(id: string, viewer: Viewer): CycleRow {
  const c = cycleRow(id);
  if (!c || (c.status === "draft" && viewer.role !== "coordinator")) throw notFound("No such cycle.");
  return c;
}

export function visibleCycles(viewer: Viewer): CycleRow[] {
  return all<CycleRow>(
    viewer.role === "coordinator"
      ? "SELECT * FROM cycles ORDER BY seq DESC"
      : "SELECT * FROM cycles WHERE status <> 'draft' ORDER BY seq DESC",
  );
}

export const etag = (c: CycleRow) => `"r${c.revision}"`;

/** Revision checking: `If-Match` must name the current revision. */
export function checkRevision(req: IncomingMessage, c: CycleRow): void {
  const given = req.headers["if-match"];
  if (given === undefined) throw new ApiError(428, "precondition_required", "Send If-Match with the cycle's ETag.");
  if (given.trim() !== etag(c)) {
    throw new ApiError(412, "stale_cycle", "Someone else changed this cycle.", undefined, { ETag: etag(c) });
  }
}

export function cycleSummary(c: CycleRow) {
  return { id: c.id, name: c.name, status: effectiveStatus(c), cutoff_display: c.cutoff_at === null ? null : cutoffDisplay(c.cutoff_at) };
}

export function cycleJson(c: CycleRow, viewer: Viewer) {
  const now = nowSeconds();
  const hasPickup = c.pickup_start_at !== null && c.pickup_end_at !== null;
  return {
    id: c.id,
    name: c.name,
    status: effectiveStatus(c, now),
    revision: c.revision,
    cutoff_at: c.cutoff_at === null ? null : isoInstant(c.cutoff_at),
    cutoff_display: c.cutoff_at === null ? null : cutoffDisplay(c.cutoff_at),
    pickup_start_at: c.pickup_start_at === null ? null : isoInstant(c.pickup_start_at),
    pickup_end_at: c.pickup_end_at === null ? null : isoInstant(c.pickup_end_at),
    pickup_display: hasPickup ? pickupDisplay(c.pickup_start_at!, c.pickup_end_at!) : null,
    accepting_pledges: acceptingPledges(c, now),
    credit: viewer.role === "member" ? creditOf(viewer.household_code!) : null,
    lines: lineRows(c.id).map((row) => lineJson(row, viewer)),
  };
}

// ---- Field rules -------------------------------------------------------------------------------

const COPY = {
  name: "Name the cycle in 1 to 60 characters on one line.",
  gap: "That time doesn't exist in club time.",
  format: "Use YYYY-MM-DD HH:MM in club time.",
  pastCutoff: "Cutoff must be in the future.",
  startAfterCutoff: "Pickup must start after cutoff.",
  endAfterStart: "Pickup must end after it starts.",
  tooLong: "Pickup can last at most 12 hours.",
  noCases: "Tick at least one case.",
  unknownCase: "Choose cases from the distributor's case list.",
} as const;

const TIME_FIELDS = { cutoff_local: "cutoff_at", pickup_start_local: "pickup_start_at", pickup_end_local: "pickup_end_at" } as const;
type TimeField = keyof typeof TIME_FIELDS;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/** The cycle name rule: trimmed, 1 to 60 code points, no control characters. */
function cycleName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  const length = [...name].length;
  return length >= 1 && length <= 60 && !CONTROL.test(name) ? name : null;
}

interface CycleEdit {
  name?: string;
  cutoff_at?: number | null;
  pickup_start_at?: number | null;
  pickup_end_at?: number | null;
  product_ids?: string[];
}

const FIELD_NAMES = ["name", "cutoff_local", "pickup_start_local", "pickup_end_local", "product_ids"] as const;

export function givenFields(body: Record<string, unknown>): string[] {
  return FIELD_NAMES.filter((f) => f in body);
}

/**
 * Reads the given fields and checks every rule for `mode` in one pass. Rules that depend on a time
 * which is missing or invalid are skipped. Throws one 422 naming every failing field.
 */
export function readCycleFields(
  body: Record<string, unknown>,
  current: Pick<CycleRow, "cutoff_at" | "pickup_start_at" | "pickup_end_at">,
  mode: "save" | "open" | "edit-open",
  currentProducts: string[],
): CycleEdit {
  const errors: Record<string, string> = {};
  const edit: CycleEdit = {};
  if ("name" in body) {
    const name = cycleName(body.name);
    if (name === null) errors.name = COPY.name;
    else edit.name = name;
  }
  const broken = new Set<TimeField>();
  for (const field of Object.keys(TIME_FIELDS) as TimeField[]) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === null && mode === "save") {
      edit[TIME_FIELDS[field]] = null;
      continue;
    }
    const reading = readLocal(value);
    if ("problem" in reading) {
      errors[field] = reading.problem === "gap" ? COPY.gap : COPY.format;
      broken.add(field);
    } else {
      edit[TIME_FIELDS[field]] = reading.instant;
    }
  }
  if ("product_ids" in body) {
    const ids = body.product_ids;
    const known = new Set(all<{ id: string }>("SELECT id FROM products").map((p) => p.id));
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && known.has(id))) {
      errors.product_ids = COPY.unknownCase;
    } else {
      edit.product_ids = [...new Set(ids as string[])];
    }
  }
  const time = (field: TimeField): number | null =>
    broken.has(field) ? null : (TIME_FIELDS[field] in edit ? edit[TIME_FIELDS[field]] : current[TIME_FIELDS[field]]) ?? null;
  const cutoff = time("cutoff_local");
  const start = time("pickup_start_local");
  const end = time("pickup_end_local");
  if (mode === "open") {
    for (const field of Object.keys(TIME_FIELDS) as TimeField[]) {
      if (!broken.has(field) && time(field) === null) errors[field] = COPY.format;
    }
    if (!errors.product_ids && (edit.product_ids ?? currentProducts).length === 0) errors.product_ids = COPY.noCases;
  }
  const now = nowSeconds();
  if (cutoff !== null && (mode === "open" || (mode === "edit-open" && "cutoff_at" in edit)) && cutoff <= now) {
    errors.cutoff_local = COPY.pastCutoff;
  }
  if (cutoff !== null && start !== null && start <= cutoff) errors.pickup_start_local = COPY.startAfterCutoff;
  if (start !== null && end !== null) {
    if (end <= start) errors.pickup_end_local = COPY.endAfterStart;
    else if (end - start > PICKUP_MAX_SECONDS) errors.pickup_end_local = COPY.tooLong;
  }
  assertValid(errors);
  return edit;
}

export function cycleProducts(id: string): string[] {
  return all<{ product_id: string }>("SELECT product_id FROM lines WHERE cycle_id = ? ORDER BY position", id).map(
    (l) => l.product_id,
  );
}

/** Applies the edited fields; the caller decides how the revision moves. */
export function applyEdit(c: CycleRow, edit: CycleEdit): void {
  const next = { ...c, ...edit };
  run(
    "UPDATE cycles SET name = ?, cutoff_at = ?, pickup_start_at = ?, pickup_end_at = ? WHERE id = ?",
    next.name, next.cutoff_at, next.pickup_start_at, next.pickup_end_at, c.id,
  );
  if (edit.product_ids) {
    run("DELETE FROM lines WHERE cycle_id = ?", c.id);
    edit.product_ids.forEach((pid, i) =>
      run("INSERT INTO lines (cycle_id, product_id, position, version, status) VALUES (?, ?, ?, 1, 'filling')", c.id, pid, i),
    );
  }
}

/** Each committed edit raises the revision by exactly 1. */
export function bumpRevision(c: CycleRow): void {
  run("UPDATE cycles SET revision = revision + 1 WHERE id = ?", c.id);
}

export function setStatus(c: CycleRow, status: CycleStatus): void {
  run("UPDATE cycles SET status = ?, revision = revision + 1 WHERE id = ?", status, c.id);
}

export function createDraft(edit: CycleEdit & { name: string }): CycleRow {
  const seq = (one<{ seq: number | null }>("SELECT MAX(seq) AS seq FROM cycles")?.seq ?? 44) + 1;
  const id = `cy-${seq}`;
  run(
    "INSERT INTO cycles (seq, id, name, status, revision, cutoff_at, pickup_start_at, pickup_end_at) VALUES (?, ?, ?, 'draft', 1, ?, ?, ?)",
    seq, id, edit.name, edit.cutoff_at ?? null, edit.pickup_start_at ?? null, edit.pickup_end_at ?? null,
  );
  const created = cycleRow(id)!;
  applyEdit(created, { product_ids: edit.product_ids ?? [] });
  return created;
}

/**
 * Which edits the cycle's status allows: name and cases in draft; cutoff in draft or while it is
 * still accepting pledges; pickup from draft through received.
 */
export function checkEditable(c: CycleRow, fields: string[]): "save" | "edit-open" {
  const status = effectiveStatus(c);
  if (status === "draft") return "save";
  const allowed = fields.every((f) =>
    f === "cutoff_local"
      ? status === "open"
      : (f === "pickup_start_local" || f === "pickup_end_local") && ["open", "sealing", "ordered", "received"].includes(status),
  );
  if (!allowed) throw conflict("wrong_cycle_state", `This change isn't possible while the cycle is ${status}.`);
  return "edit-open";
}
