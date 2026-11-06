import { z } from "zod";
import type { CommitResult, CorrectionEntry, CorrectionValues, RunEntry } from "../../shared/api.js";
import {
  STATUS_AFTER_CORRECTION,
  type RunOutcome,
  type RunStatus,
  canCommit,
  canCorrect,
  statusAfterCommit,
  timesCanChange,
} from "../../shared/lifecycle.js";
import { MAX_CONES, adjustedMs, indexedMs, parseRawTime, tableInForce } from "../../shared/rules.js";
import { type ClubAuth, requireRole } from "../auth.js";
import { type Db, one, pool, returning, rows, transaction } from "../db.js";
import { ApiError, validationError } from "../errors.js";
import { parse, wholeNumber } from "../validate.js";
import { type EventRow, findEvent, reportedStatus } from "./events.js";
import { factorBasisPoints, loadTables } from "./indexTables.js";
import { findRegistration } from "./registrations.js";
import {
  type Ranked,
  type RunRow,
  entryStanding,
  findEntry,
  loadEntries,
  rankChange,
  rankEntries,
  toRunView,
} from "./standings.js";

export async function listRunEntries(auth: ClubAuth, eventId: number, heatText: string | undefined): Promise<RunEntry[]> {
  const event = await findEvent(pool, auth.club.id, eventId);
  requireRole(auth, "timing");
  const heat = Number(heatText);
  if (!Number.isInteger(heat) || heat < 1 || heat > event.heat_count) {
    throw validationError({ heat: `Choose a heat from 1 to ${event.heat_count}.` });
  }
  const entries = await loadEntries(pool, eventId);
  return entries
    .filter((entry) => entry.runHeat === heat)
    .map((entry) => ({
      registrationId: entry.registrationId,
      carNumber: entry.carNumber,
      classCode: entry.classCode,
      driverName: entry.driverName,
      runHeat: entry.runHeat,
      checkedIn: entry.checkedIn,
      runs: entry.runs.map(toRunView),
    }));
}

const RAW_TIME_MESSAGE = "Run time must look like 45.123.";

/** Raw time text in, thousandths out. */
const rawTimeMs = z.string({ error: RAW_TIME_MESSAGE }).transform((value, ctx) => {
  const ms = parseRawTime(value);
  if (ms === null) {
    ctx.addIssue({ code: "custom", message: RAW_TIME_MESSAGE });
    return z.NEVER;
  }
  return ms;
});
const conesField = wholeNumber("Cones", 0, MAX_CONES);

const commitSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({ outcome: z.literal("time"), rawTime: rawTimeMs, cones: conesField }),
    z.object({ outcome: z.literal("dnf"), cones: conesField.optional() }),
    z.object({ outcome: z.literal("rerun") }),
  ],
  { error: "Choose time, dnf or rerun." },
);

/** The factor the event's index table gives a class on the event's date. */
async function factorFor(db: Db, clubId: number, date: string, classCode: string): Promise<number> {
  const table = tableInForce(await loadTables(db, clubId), date);
  if (!table) throw new Error(`no index table is in force on ${date}`);
  return factorBasisPoints(table.factors, classCode);
}

async function lockEvent(db: Db, eventId: number): Promise<void> {
  await db.query("select pg_advisory_xact_lock(1000000 + $1::int)", [eventId]);
}

async function recordChange(
  db: Db,
  before: Ranked[],
  eventId: number,
  registrationId: number,
  runNumber: number,
): Promise<{ after: Ranked[]; change: ReturnType<typeof rankChange> }> {
  const after = rankEntries(await loadEntries(db, eventId));
  const change = rankChange(findEntry(before, registrationId), findEntry(after, registrationId));
  await db.query(
    "update registrations set last_change_run = $2, last_change_at = now(), last_change_rank = $3 where id = $1",
    [registrationId, runNumber, change],
  );
  return { after, change };
}

async function runWithName(db: Db, id: number): Promise<RunRow> {
  return returning<RunRow>(
    db,
    `select ru.*, cu.name as committed_by_name from runs ru left join users cu on cu.id = ru.committed_by where ru.id = $1`,
    [id],
  );
}

/** What a commit needs before the idempotency check: the registration and event (404) and the caller's role (403). */
interface CommitTarget {
  registration: Awaited<ReturnType<typeof findRegistration>>;
  event: EventRow;
  runNumber: number;
}

export async function resolveCommit(auth: ClubAuth, registrationId: number, runNumberText: string): Promise<CommitTarget> {
  const registration = await findRegistration(pool, auth, registrationId);
  const event = await findEvent(pool, auth.club.id, registration.event_id);
  const runNumber = Number(runNumberText);
  if (!Number.isInteger(runNumber) || runNumber < 1 || runNumber > event.runs_per_driver) throw new ApiError("not_found");
  requireRole(auth, "timing");
  return { registration, event, runNumber };
}

export async function commitRun(auth: ClubAuth, target: CommitTarget, body: unknown): Promise<CommitResult> {
  const { registration, event, runNumber } = target;
  const registrationId = registration.id;
  return transaction(async (db) => {
    await lockEvent(db, event.id);
    const fresh = await findEvent(db, auth.club.id, event.id);
    if (reportedStatus(fresh, new Date()) !== "running") throw new ApiError("event_not_running");
    if (registration.run_heat !== fresh.running_heat) throw new ApiError("heat_not_running");
    if (registration.checked_in_at === null) throw new ApiError("not_checked_in");
    const slot = await one<{ id: number; status: RunStatus }>(
      db,
      "select id, status from runs where registration_id = $1 and run_number = $2 for update",
      [registrationId, runNumber],
    );
    if (!slot || !canCommit(slot.status)) throw new ApiError("run_already_committed");
    const input = parse(commitSchema, body);
    const before = rankEntries(await loadEntries(db, event.id));
    const factor = input.outcome === "rerun" ? null : await factorFor(db, auth.club.id, event.date, registration.class_code);
    const raw = input.outcome === "time" ? input.rawTime : null;
    const cones = input.outcome === "rerun" ? null : (input.cones ?? null);
    const adjusted = input.outcome === "time" ? adjustedMs(input.rawTime, input.cones) : null;
    const indexed = adjusted !== null && factor !== null ? indexedMs(adjusted, factor) : null;
    await db.query(
      `update runs set status = $2, outcome = $3, raw_ms = $4, cones = $5, adjusted_ms = $6, indexed_ms = $7,
              factor_bp = $8, committed_at = now(), committed_by = $9 where id = $1`,
      [slot.id, statusAfterCommit(input.outcome), input.outcome, raw, cones, adjusted, indexed, factor, auth.userId],
    );
    const { after, change } = await recordChange(db, before, event.id, registrationId, runNumber);
    return {
      run: toRunView(await runWithName(db, slot.id)),
      entry: entryStanding(findEntry(after, registrationId)),
      rankChange: change,
    };
  });
}

const reasonField = z
  .string({ error: "Give a reason of at least 5 characters." })
  .trim()
  .min(5, "Give a reason of at least 5 characters.")
  .max(500, "Give a reason of at most 500 characters.");

const correctionSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({ outcome: z.literal("time"), rawTime: rawTimeMs, cones: conesField, reason: reasonField }),
    z.object({ outcome: z.literal("dnf"), cones: conesField, reason: reasonField }),
  ],
  { error: "Choose time or DNF." },
);

function valuesOf(run: RunRow): CorrectionValues {
  const view = toRunView(run);
  return {
    outcome: run.outcome === "time" ? "time" : "dnf",
    rawTime: view.rawTime,
    cones: view.cones,
    adjustedTime: view.adjustedTime,
    indexedTime: view.indexedTime,
  };
}

interface CorrectionResult extends CommitResult {
  correction: CorrectionEntry;
}

export async function correctRun(auth: ClubAuth, runId: number, body: unknown): Promise<CorrectionResult> {
  const found = await one<{ registration_id: number; event_id: number }>(
    pool,
    `select ru.registration_id, r.event_id from runs ru join registrations r on r.id = ru.registration_id
       join events e on e.id = r.event_id where ru.id = $1 and e.club_id = $2`,
    [runId, auth.club.id],
  );
  if (!found) throw new ApiError("not_found");
  requireRole(auth, "timing");
  return transaction(async (db) => {
    await lockEvent(db, found.event_id);
    const event = await findEvent(db, auth.club.id, found.event_id);
    if (!timesCanChange(reportedStatus(event, new Date()))) throw new ApiError("results_locked");
    const current = await returning<RunRow>(
      db,
      "select ru.*, null::text as committed_by_name from runs ru where ru.id = $1 for update",
      [runId],
    );
    if (!canCorrect(current.status)) throw new ApiError("run_not_committed");
    const input = parse(correctionSchema, body);
    const registration = await returning<{ class_code: string; car_number: number }>(
      db,
      "select class_code, car_number from registrations where id = $1",
      [found.registration_id],
    );
    const raw = input.outcome === "time" ? input.rawTime : null;
    const unchanged = input.outcome === current.outcome && raw === current.raw_ms && input.cones === (current.cones ?? 0);
    if (unchanged) throw validationError({ change: "The correction must change the time, cones or outcome." });
    // A committed or corrected run always stores the factor it was committed with (factor_bp is set on every commit but a rerun).
    const { factor_bp: factor } = await returning<{ factor_bp: number }>(
      db,
      "select factor_bp from runs where id = $1 and factor_bp is not null",
      [runId],
    );
    const adjusted = raw !== null ? adjustedMs(raw, input.cones) : null;
    const indexed = adjusted !== null ? indexedMs(adjusted, factor) : null;
    const before = rankEntries(await loadEntries(db, event.id));
    const outcome: RunOutcome = input.outcome;
    await db.query(
      `update runs set status = $2, outcome = $3, raw_ms = $4, cones = $5, adjusted_ms = $6, indexed_ms = $7 where id = $1`,
      [runId, STATUS_AFTER_CORRECTION, outcome, raw, input.cones, adjusted, indexed],
    );
    const updated = await runWithName(db, runId);
    const entry = await returning<{ id: number; at: Date }>(
      db,
      `insert into corrections (run_id, actor_id, reason, before, after) values ($1, $2, $3, $4, $5) returning id, at`,
      [runId, auth.userId, input.reason, valuesOf(current), valuesOf(updated)],
    );
    const { after, change } = await recordChange(db, before, event.id, found.registration_id, current.run_number);
    return {
      run: toRunView(updated),
      correction: {
        id: entry.id,
        runId,
        registrationId: found.registration_id,
        carNumber: registration.car_number,
        classCode: registration.class_code,
        runNumber: current.run_number,
        actor: { id: auth.userId, name: auth.name },
        at: entry.at.toISOString(),
        reason: input.reason,
        before: valuesOf(current),
        after: valuesOf(updated),
      },
      entry: entryStanding(findEntry(after, found.registration_id)),
      rankChange: change,
    };
  });
}

interface CorrectionRow {
  id: number;
  run_id: number;
  registration_id: number;
  car_number: number;
  class_code: string;
  run_number: number;
  actor_id: number;
  actor_name: string;
  at: Date;
  reason: string;
  before: CorrectionValues;
  after: CorrectionValues;
}

export async function listCorrections(auth: ClubAuth, eventId: number, registrationFilter: string | undefined): Promise<CorrectionEntry[]> {
  await findEvent(pool, auth.club.id, eventId);
  const filter = registrationFilter === undefined ? null : Number(registrationFilter);
  const found = await rows<CorrectionRow>(
    pool,
    `select c.id, c.run_id, r.id as registration_id, r.car_number, r.class_code, ru.run_number, c.actor_id,
            u.name as actor_name, c.at, c.reason, c.before, c.after
       from corrections c
       join runs ru on ru.id = c.run_id
       join registrations r on r.id = ru.registration_id
       join users u on u.id = c.actor_id
      where r.event_id = $1 and ($2::int is null or r.id = $2)
      order by c.at desc, c.id desc`,
    [eventId, filter !== null && Number.isInteger(filter) ? filter : null],
  );
  return found.map((c) => ({
    id: c.id,
    runId: c.run_id,
    registrationId: c.registration_id,
    carNumber: c.car_number,
    classCode: c.class_code,
    runNumber: c.run_number,
    actor: { id: c.actor_id, name: c.actor_name },
    at: c.at.toISOString(),
    reason: c.reason,
    before: c.before,
    after: c.after,
  }));
}

