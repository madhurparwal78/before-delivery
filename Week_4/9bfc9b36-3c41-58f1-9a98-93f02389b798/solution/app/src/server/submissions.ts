/** Owner submissions, the sailmaker's decisions on them (single and bulk), reversals, and the per-account request limit. */
import { lockNamed, nextCode, one, run, transaction, type Queryable, type Row } from "./db.js";
import { audit } from "./audit.js";
import { currentValue, insertMeasurement } from "./boats.js";
import { stepBackDrawings } from "./drawings.js";
import { currentRuleSet } from "./rules.js";
import { personOf, type AccountRow } from "./accounts.js";
import { FieldErrors, Refusal, refuse } from "./errors.js";
import { instant, now, wholeSecond } from "./time.js";
import { keysetPage, type PageRequest } from "./paging.js";
import { config } from "./config.js";
import { FIELD, rateLimitedCopy } from "../shared/copy.js";
import { projectSubmission } from "./projection.js";
import { DIMENSION_KEYS, type BulkResult, type DimensionKey, type Page, type Role, type Submission } from "../shared/types.js";
import { inLengthRange, inchesOf, looksLikeInches, readInches } from "../shared/units.js";
import * as check from "./validate.js";

const COLUMNS = "s.*, a.email AS by_email, a.display_name AS by_name, a.deleted AS by_deleted";
const FROM = "FROM submission s JOIN account a ON a.id = s.submitted_by";

function submissionView(row: Row, role: Role): Submission {
  const view: Submission = {
    id: row.id,
    boat_code: row.boat_code,
    dimension: row.dimension,
    value_mm: row.value_mm,
    value_in: inchesOf(row.value_mm),
    as_submitted: row.as_submitted,
    measured_on: row.measured_on,
    note: row.note,
    status: row.status,
    submitted_by: personOf({ email: row.by_email, display_name: row.by_name, deleted: row.by_deleted }),
    submitted_at: instant(row.submitted_at),
    decided_at: row.decided_at ? instant(row.decided_at) : null,
    reason: row.reason,
    decided_by: row.decided_by,
  };
  return projectSubmission(view, role);
}

export async function submissionRow(db: Queryable, id: string, lock = false): Promise<Row | null> {
  return one(db, `SELECT ${COLUMNS} ${FROM} WHERE s.id = $1 ${lock ? "FOR UPDATE OF s" : ""}`, [id]);
}

export async function listSubmissions(db: Queryable, actor: AccountRow, status: string | null, request: PageRequest): Promise<Page<Submission>> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (actor.role === "yacht-owner") {
    params.push(actor.id);
    clauses.push(`s.submitted_by = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`s.status = $${params.length}`);
  }
  return keysetPage(db, {
    base: `SELECT ${COLUMNS}, s.submitted_at AS k1, s.num AS k2 ${FROM} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}`,
    params,
    types: ["timestamptz", "int"],
    direction: "desc",
    filter: `status=${status ?? ""}`,
    request,
    map: (row) => submissionView(row, actor.role),
  });
}

/** The per-account window limit, counted in the database so every instance agrees. */
async function enforceRate(db: Queryable, actor: AccountRow, kind: "submission" | "sheet"): Promise<void> {
  const limit = kind === "submission" ? config.ownerSubmissionLimit : config.ownerSheetFetchLimit;
  const windowMs = config.ownerRateWindowSeconds * 1000;
  const at = now();
  const counted = (await one<{ n: number; oldest: Date | null }>(
    db,
    "SELECT count(*)::int AS n, min(at) AS oldest FROM rate_event WHERE account_id = $1 AND kind = $2 AND at > $3",
    [actor.id, kind, new Date(at.getTime() - windowMs)],
  ))!;
  if (counted.n >= limit && counted.oldest) {
    const seconds = Math.max(1, Math.ceil((counted.oldest.getTime() + windowMs - at.getTime()) / 1000));
    throw new Refusal("rate_limited", rateLimitedCopy(seconds), {}, { "retry-after": String(seconds) });
  }
}

async function countRate(db: Queryable, actor: AccountRow, kind: "submission" | "sheet"): Promise<void> {
  await run(db, "INSERT INTO rate_event (account_id, kind, at) VALUES ($1, $2, $3)", [actor.id, kind, now()]);
}

/** A sheet fetch is counted only once the bytes were served: check first, count after. */
export async function withSheetLimit<T>(actor: AccountRow, serve: () => Promise<T>): Promise<T> {
  return transaction(async (db) => {
    await lockNamed(db, `rate:${actor.id}`);
    await enforceRate(db, actor, "sheet");
    const result = await serve();
    await countRate(db, actor, "sheet");
    return result;
  });
}

export async function createSubmission(actor: AccountRow, boatCode: string, body: check.Body): Promise<Submission> {
  return transaction(async (db) => {
    await lockNamed(db, `rate:${actor.id}`);
    await enforceRate(db, actor, "submission");
    const errors = new FieldErrors();
    const dimension = check.oneOf<DimensionKey>(errors, body, "dimension", DIMENSION_KEYS, FIELD.dimension);
    const measuredOn = check.measuredOn(errors, body, "measured_on");
    const note = check.text(errors, body, "note", 0, 200);
    let valueMm: number | undefined;
    let asSubmitted = "";
    const { value_mm: mm, value_in: inches } = body;
    const hasMm = mm !== undefined && mm !== null;
    const hasInches = inches !== undefined && inches !== null;
    if (hasMm === hasInches) {
      errors.add("value_mm", FIELD.notBoth);
    } else if (hasMm) {
      if (typeof mm !== "number" || !Number.isInteger(mm) || !inLengthRange(mm)) {
        errors.add("value_mm", FIELD.lengthRange);
      } else {
        valueMm = mm;
        asSubmitted = `${mm} mm`;
        if (dimension) {
          const current = await currentValue(db, boatCode, dimension);
          const tolerance = (await currentRuleSet(db, now())).tolerance_mm;
          if (current !== null && looksLikeInches(mm, current, tolerance)) {
            errors.add("value_mm", FIELD.looksLikeInches);
            valueMm = undefined;
          }
        }
      }
    } else {
      const reading = typeof inches === "string" ? readInches(inches) : null;
      if (!reading) {
        errors.add("value_in", FIELD.inches);
      } else if (!inLengthRange(reading.mm)) {
        errors.add("value_in", FIELD.lengthRange);
      } else {
        valueMm = reading.mm;
        asSubmitted = reading.decimal ? `${inches as string} in` : (inches as string);
      }
    }
    errors.throwIfAny();
    const num = await nextCode(db, "submission");
    const id = `S-${String(num).padStart(4, "0")}`;
    await run(
      db,
      `INSERT INTO submission (id, num, boat_code, dimension, value_mm, as_submitted, measured_on, note, status, submitted_by, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)`,
      [id, num, boatCode, dimension, valueMm, asSubmitted, measuredOn, note, actor.id, wholeSecond(now())],
    );
    await countRate(db, actor, "submission");
    await audit(db, { actor: actor.email, action: "submission.create", target: id, after: "pending" });
    return submissionView((await submissionRow(db, id))!, actor.role);
  });
}

type Decision = "accept" | "reject";

type Outcome = { applied: true; status: "accepted" | "rejected" } | { applied: false; reason: NonNullable<BulkResult["reason"]> };

async function decideLocked(db: Queryable, actor: AccountRow, row: Row, decision: unknown, reason: string): Promise<Outcome> {
  if (decision !== "accept" && decision !== "reject") return { applied: false, reason: "invalid_decision" };
  if (row.status !== "pending") return { applied: false, reason: "already_decided" };
  if (decision === "reject" && reason.length === 0) return { applied: false, reason: "reason_required" };
  const at = wholeSecond(now());
  if (decision === "accept") {
    const measurementId = await insertMeasurement(db, {
      boatCode: row.boat_code,
      dimension: row.dimension,
      valueMm: row.value_mm,
      measuredOn: row.measured_on,
      source: "submission",
      submissionId: row.id,
    });
    await run(db, "UPDATE submission SET status = 'accepted', decided_at = $2, decided_by = $3, reason = $4, measurement_id = $5 WHERE id = $1", [
      row.id,
      at,
      actor.email,
      reason || null,
      measurementId,
    ]);
    await stepBackDrawings(db, row.boat_code);
  } else {
    await run(db, "UPDATE submission SET status = 'rejected', decided_at = $2, decided_by = $3, reason = $4 WHERE id = $1", [row.id, at, actor.email, reason]);
  }
  const status = decision === "accept" ? "accepted" : "rejected";
  await audit(db, { actor: actor.email, action: decision === "accept" ? "submission.accept" : "submission.reject", target: row.id, before: "pending", after: status, reason: reason || null });
  return { applied: true, status };
}

export async function decideSubmission(actor: AccountRow, id: string, body: check.Body): Promise<Submission> {
  return transaction(async (db) => {
    const row = (await submissionRow(db, id, true))!;
    if (row.status !== "pending") throw refuse("already_decided");
    const errors = new FieldErrors();
    const decision = check.oneOf<Decision>(errors, body, "decision", ["accept", "reject"], FIELD.decision);
    const optional = body.reason === undefined || body.reason === null || body.reason === "";
    const reason = decision === "reject" || !optional ? check.reason(errors, body, "reason", FIELD.reason) : "";
    errors.throwIfAny();
    await decideLocked(db, actor, row, decision, reason ?? "");
    return submissionView((await submissionRow(db, id))!, actor.role);
  });
}

export async function decideMany(actor: AccountRow, items: { id: unknown; decision: unknown; reason: unknown }[]): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const item of items) {
    const result = await transaction(async (db): Promise<BulkResult> => {
      const id = typeof item.id === "string" ? item.id : "";
      const row = id ? await submissionRow(db, id, true) : null;
      if (!row) return { id, outcome: "refused", reason: "not_found", status: null };
      const reason = typeof item.reason === "string" ? item.reason : "";
      const outcome = await decideLocked(db, actor, row, item.decision, reason.slice(0, 200));
      return outcome.applied
        ? { id, outcome: "applied", reason: null, status: outcome.status }
        : { id, outcome: "refused", reason: outcome.reason, status: row.status };
    });
    results.push(result);
  }
  return results;
}

export async function reverseSubmission(actor: AccountRow, id: string, body: check.Body): Promise<Submission> {
  return transaction(async (db) => {
    const row = (await submissionRow(db, id, true))!;
    if (row.status !== "accepted") throw refuse("not_accepted");
    const errors = new FieldErrors();
    const reason = check.reason(errors, body, "reason", FIELD.reason);
    errors.throwIfAny();
    await run(db, "DELETE FROM measurement WHERE id = $1", [row.measurement_id]);
    await run(db, "UPDATE submission SET status = 'reversed', reason = $2, measurement_id = NULL WHERE id = $1", [id, reason]);
    await stepBackDrawings(db, row.boat_code);
    await audit(db, { actor: actor.email, action: "submission.reverse", target: id, before: "accepted", after: "reversed", reason });
    return submissionView((await submissionRow(db, id))!, actor.role);
  });
}
