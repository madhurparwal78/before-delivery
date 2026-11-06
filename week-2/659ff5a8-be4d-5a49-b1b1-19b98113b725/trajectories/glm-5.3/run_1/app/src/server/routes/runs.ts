import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import { errConflict, errNotFound, errValidation } from "../errors.js";
import { requireUser, requireRole } from "../session.js";
import { getEvent, getRegistration, mapRegistration, mapRun, runObj } from "../domain/repo.js";
import {
  reportedStatus, runCanBeCommitted, runCanBeCorrected, CORRECTION_STATUSES, rankChangeText,
} from "../domain/states.js";
import { adjustedTime, indexedTime, fmtTime } from "../domain/times.js";
import { newId } from "../ids.js";
import { safeParse } from "./auth.js";
import { computeStandings } from "../domain/standings.js";
import type { EventRow, RunDbRow } from "../domain/types.js";

const RAW_TIME_RE = /^\d{2,3}\.\d{3}$/;

export function registerRunRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/events/:id/runs", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair", "timing"]);
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const query = request.query as { heat?: string };
    const heat = query.heat !== undefined ? Number(query.heat) : null;
    const heatCount = Object.keys(event.heat_classes).length;
    if (query.heat !== undefined && (!Number.isInteger(heat) || heat === null || heat < 1 || heat > heatCount)) {
      throw errValidation({ heat: "That heat does not exist." });
    }
    const regs = await db.query(
      `SELECT r.*, u.name AS driver_name, u.email AS driver_email
       FROM registrations r JOIN users u ON u.id = r.driver_id
       WHERE r.event_id = $1 ORDER BY r.class_code, r.car_number`,
      [event.id],
    );
    const entries = [];
    for (const row of regs) {
      const reg = mapRegistration(row);
      if (heat !== null && reg.run_heat !== heat) continue;
      const runs = await db.query(
        `SELECT ru.*, u.name AS committed_by_name FROM runs ru
         LEFT JOIN users u ON u.id = ru.committed_by
         WHERE ru.registration_id = $1 ORDER BY ru.run_number`,
        [reg.id],
      );
      const allRuns: RunDbRow[] = runs.map(mapRun);
      for (let n = allRuns.length + 1; n <= event.runs_per_driver; n++) {
        // Every run slot must be present; missing ones are materialised as pending.
        const id = await ensureRunSlot(db, reg.id, n);
        allRuns.push({
          id, registration_id: reg.id, run_number: n, status: "pending", outcome: null,
          raw_time: null, cones: null, adjusted_time: null, indexed_time: null, factor: null,
          committed_at: null, committed_by_name: null,
        });
      }
      entries.push({
        registrationId: reg.id,
        carNumber: reg.car_number,
        classCode: reg.class_code,
        driverName: reg.driver_name,
        runHeat: reg.run_heat,
        checkedIn: reg.checked_in_at !== null,
        runs: allRuns.map((r) => runObj(r, null)),
      });
    }
    reply.send({ entries });
  });

  app.post("/api/registrations/:id/runs/:runNumber", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair", "timing"]);
    await withIdempotency(db, request, reply, async () => {
      const reg = await getRegistration(db, (request.params as { id: string }).id, user.clubId);
      if (!reg) throw errNotFound();
      const event = await getEvent(db, reg.event_id, user.clubId);
      if (!event) throw errNotFound();
      const runNumber = Number((request.params as { runNumber: string }).runNumber);
      if (!Number.isInteger(runNumber) || runNumber < 1 || runNumber > event.runs_per_driver) {
        throw errNotFound("That run does not exist.");
      }
      const now = new Date();
      const status = reportedStatus(event.status, event.registration_cutoff, now);
      if (status !== "running") throw errConflict("event_not_running", "The event is not running.");
      if (reg.run_heat !== event.running_heat) {
        throw errConflict("heat_not_running", `Car ${reg.car_number} runs in heat ${reg.run_heat}, which is not running.`);
      }
      if (!reg.checked_in_at) throw errConflict("not_checked_in", `Car ${reg.car_number} is not checked in.`);

      const runRows = await db.query(`SELECT * FROM runs WHERE registration_id = $1 AND run_number = $2`, [reg.id, runNumber]);
      let run = runRows[0] ? mapRun(runRows[0]) : null;
      if (!run) run = await ensureRunSlotObj(db, reg.id, runNumber);
      if (!runCanBeCommitted(run.status)) {
        throw errConflict("run_already_committed", `Run ${runNumber} for car ${reg.car_number} is already recorded. Press Enter to correct it.`);
      }

      const schema = z.union([
        z.object({
          outcome: z.literal("time"),
          rawTime: z.string().regex(RAW_TIME_RE, "Run time must look like 45.123."),
          cones: z.number().int().min(0).max(30),
        }),
        z.object({ outcome: z.literal("dnf"), cones: z.number().int().min(0).max(30).optional() }),
        z.object({ outcome: z.literal("rerun") }),
      ]);
      const parsed = safeParse(schema, request.body);
      if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
      const body = parsed.value;

      let rawTime: string | null = null;
      let cones: number | null = null;
      let adjusted: string | null = null;
      let indexed: string | null = null;
      let newStatus: string;
      let outcome: string | null;
      if (body.outcome === "time") {
        const value = Number(body.rawTime);
        if (value < 10 || value > 999.999) throw errValidation({ rawTime: "Run time must look like 45.123." });
        rawTime = body.rawTime;
        cones = body.cones;
        adjusted = adjustedTime(rawTime, cones);
        indexed = indexedTime(adjusted, event.factors[reg.class_code]);
        newStatus = "committed";
        outcome = "time";
      } else if (body.outcome === "dnf") {
        cones = body.cones ?? 0;
        newStatus = "committed";
        outcome = "dnf";
      } else {
        newStatus = "rerun_granted";
        outcome = "rerun";
      }

      const factor = body.outcome === "time" ? event.factors[reg.class_code] : run.factor;
      const before = await entryPosition(db, event, reg.id);
      await db.query(
        `UPDATE runs SET status=$1, outcome=$2, raw_time=$3, cones=$4, adjusted_time=$5, indexed_time=$6,
          factor=$7, committed_at=now(), committed_by=$8 WHERE id=$9`,
        [newStatus, outcome, rawTime, cones, adjusted, indexed, factor, user.id, run.id],
      );
      const after = await entryPosition(db, event, reg.id);
      const change = {
        runNumber,
        at: now.toISOString(),
        rankChange: {
          indexed: rankChangeText(before.position, after.position),
          class: rankChangeText(before.classPosition, after.classPosition),
          raw: rankChangeText(before.rawPosition, after.rawPosition),
        },
      };
      await db.query(
        `INSERT INTO run_rank_changes (registration_id, run_number, at, indexed, class, raw)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (registration_id, run_number) DO UPDATE SET at=$3, indexed=$4, class=$5, raw=$6`,
        [reg.id, runNumber, now.toISOString(), change.rankChange.indexed, change.rankChange.class, change.rankChange.raw],
      );
      const fresh = await db.query(
        `SELECT ru.*, u.name AS committed_by_name FROM runs ru LEFT JOIN users u ON u.id = ru.committed_by WHERE ru.id = $1`,
        [run.id],
      );
      const freshRun = mapRun(fresh[0]);
      return {
        status: 201,
        body: {
          run: runObj(freshRun, freshRun.committed_by_name ? user.id : null),
          entry: {
            registrationId: reg.id,
            carNumber: reg.car_number,
            classCode: reg.class_code,
            position: after.position,
            classPosition: after.classPosition,
            rawPosition: after.rawPosition,
            bestAdjusted: after.bestAdjusted,
            bestIndexed: after.bestIndexed,
          },
          rankChange: change.rankChange,
        },
      };
    });
  });

  app.post("/api/runs/:id/corrections", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair", "timing"]);
    const runRows = await db.query(`SELECT * FROM runs WHERE id = $1`, [(request.params as { id: string }).id]);
    if (!runRows[0]) throw errNotFound();
    const run = mapRun(runRows[0]);
    const reg = await getRegistration(db, run.registration_id, user.clubId);
    if (!reg) throw errNotFound();
    const event = await getEvent(db, reg.event_id, user.clubId);
    if (!event) throw errNotFound();

    const now = new Date();
    const status = reportedStatus(event.status, event.registration_cutoff, now);
    if (!CORRECTION_STATUSES.includes(status as never)) {
      throw errConflict("results_locked", "Results are final. Times can no longer change.");
    }
    if (!runCanBeCorrected(run.status)) {
      throw errConflict("run_not_committed", "That run has not been recorded.");
    }
    const schema = z.object({
      outcome: z.enum(["time", "dnf"]),
      rawTime: z.string().regex(RAW_TIME_RE, "Run time must look like 45.123.").optional(),
      cones: z.number().int().min(0).max(30),
      reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500),
    });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    const body = parsed.value;

    const before = {
      outcome: run.outcome,
      rawTime: run.raw_time,
      cones: run.cones ?? 0,
      adjustedTime: run.adjusted_time,
      indexedTime: run.indexed_time,
    };
    let newRaw: string | null = null;
    let newCones: number = body.cones;
    let newAdjusted: string | null = null;
    let newIndexed: string | null = null;
    if (body.outcome === "time") {
      if (!body.rawTime) throw errValidation({ rawTime: "Run time must look like 45.123." });
      const value = Number(body.rawTime);
      if (value < 10 || value > 999.999) throw errValidation({ rawTime: "Run time must look like 45.123." });
      newRaw = body.rawTime;
      newAdjusted = adjustedTime(newRaw, newCones);
      newIndexed = indexedTime(newAdjusted, run.factor as string);
    }
    const outcomeChanged = body.outcome !== run.outcome;
    const rawChanged = newRaw !== before.rawTime;
    const conesChanged = newCones !== before.cones;
    if (!outcomeChanged && !rawChanged && !conesChanged) {
      throw errValidation({ form: "The correction must change the time, cones or outcome." }, "The correction must change the time, cones or outcome.");
    }

    const posBefore = await entryPosition(db, event, reg.id);
    await db.query(
      `UPDATE runs SET status='corrected', outcome=$1, raw_time=$2, cones=$3, adjusted_time=$4, indexed_time=$5,
        committed_at=now(), committed_by=$6 WHERE id=$7`,
      [body.outcome, newRaw, newCones, newAdjusted, newIndexed, user.id, run.id],
    );
    const correctionId = newId("corr");
    await db.query(
      `INSERT INTO corrections (id, run_id, actor_id, reason,
        before_outcome, before_raw_time, before_cones, before_adjusted, before_indexed,
        after_outcome, after_raw_time, after_cones, after_adjusted, after_indexed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        correctionId, run.id, user.id, body.reason,
        before.outcome, before.rawTime, before.cones, before.adjustedTime, before.indexedTime,
        body.outcome, newRaw, newCones, newAdjusted, newIndexed,
      ],
    );
    const posAfter = await entryPosition(db, event, reg.id);
    const change = {
      runNumber: run.run_number,
      at: now.toISOString(),
      rankChange: {
        indexed: rankChangeText(posBefore.position, posAfter.position),
        class: rankChangeText(posBefore.classPosition, posAfter.classPosition),
        raw: rankChangeText(posBefore.rawPosition, posAfter.rawPosition),
      },
    };
    await db.query(
      `INSERT INTO run_rank_changes (registration_id, run_number, at, indexed, class, raw)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (registration_id, run_number) DO UPDATE SET at=$3, indexed=$4, class=$5, raw=$6`,
      [reg.id, run.run_number, now.toISOString(), change.rankChange.indexed, change.rankChange.class, change.rankChange.raw],
    );
    const fresh = await db.query(
      `SELECT ru.*, u.name AS committed_by_name FROM runs ru LEFT JOIN users u ON u.id = ru.committed_by WHERE ru.id = $1`,
      [run.id],
    );
    reply.status(201).send({
      run: runObj(mapRun(fresh[0]), user.id),
      correction: await correctionObject(db, correctionId),
      entry: {
        registrationId: reg.id,
        carNumber: reg.car_number,
        classCode: reg.class_code,
        position: posAfter.position,
        classPosition: posAfter.classPosition,
        rawPosition: posAfter.rawPosition,
        bestAdjusted: posAfter.bestAdjusted,
        bestIndexed: posAfter.bestIndexed,
      },
      rankChange: change.rankChange,
    });
  });

  app.get("/api/events/:id/corrections", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const query = request.query as { registrationId?: string };
    const params: unknown[] = [event.id];
    let filter = "";
    if (query.registrationId) {
      params.push(query.registrationId);
      filter = ` AND r.registration_id = $2`;
    }
    const rows = await db.query(
      `SELECT c.*, ru.run_number, ru.registration_id, r.car_number, r.class_code, u.name AS actor_name
       FROM corrections c
       JOIN runs ru ON ru.id = c.run_id
       JOIN registrations r ON r.id = ru.registration_id
       JOIN users u ON u.id = c.actor_id
       JOIN events e ON e.id = r.event_id
       WHERE e.id = $1${filter}
       ORDER BY c.at DESC, c.id DESC`,
      params,
    );
    reply.send({ corrections: rows.map(correctionRow) });
  });

  for (const method of ["PUT", "PATCH", "DELETE"] as const) {
    app.route({
      method,
      url: "/api/corrections/:id",
      async handler(request, reply) {
        const user = await requireUser(request);
        const rows = await db.query(`SELECT c.id FROM corrections c JOIN runs ru ON ru.id = c.run_id JOIN registrations r ON r.id = ru.registration_id JOIN events e ON e.id = r.event_id WHERE c.id = $1 AND e.club_id = $2`,
          [(request.params as { id: string }).id, user.clubId]);
        if (!rows[0]) throw errNotFound();
        reply.status(405).send({ error: "audit_immutable", message: "The correction log is immutable." });
      },
    });
  }
}

async function correctionObject(db: Db, id: string): Promise<Record<string, unknown>> {
  const rows = await db.query(
    `SELECT c.*, u.name AS actor_name FROM corrections c JOIN users u ON u.id = c.actor_id WHERE c.id = $1`,
    [id],
  );
  return correctionRow(rows[0]);
}

function correctionRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    registrationId: r.registration_id as string,
    carNumber: r.car_number as number,
    classCode: r.class_code as string,
    runNumber: r.run_number as number,
    actor: { id: r.actor_id as string, name: r.actor_name as string },
    at: new Date(r.at as string).toISOString(),
    reason: r.reason as string,
    before: values(r, "before"),
    after: values(r, "after"),
  };
}

function values(r: Record<string, unknown>, prefix: "before" | "after"): Record<string, unknown> {
  return {
    outcome: r[`${prefix}_outcome`],
    rawTime: fmtTime(r[`${prefix}_raw_time`] as string | null),
    cones: r[`${prefix}_cones`] as number | null,
    adjustedTime: fmtTime(r[`${prefix}_adjusted`] as string | null),
    indexedTime: fmtTime(r[`${prefix}_indexed`] as string | null),
  };
}

async function ensureRunSlot(db: Db, registrationId: string, runNumber: number): Promise<string> {
  const id = newId("run");
  await db.query(
    `INSERT INTO runs (id, registration_id, run_number, status) VALUES ($1,$2,$3,'pending')
     ON CONFLICT (registration_id, run_number) DO NOTHING`,
    [id, registrationId, runNumber],
  );
  const rows = await db.query(`SELECT id FROM runs WHERE registration_id = $1 AND run_number = $2`, [registrationId, runNumber]);
  return rows[0].id as string;
}

async function ensureRunSlotObj(db: Db, registrationId: string, runNumber: number): Promise<RunDbRow> {
  const id = await ensureRunSlot(db, registrationId, runNumber);
  return {
    id, registration_id: registrationId, run_number: runNumber, status: "pending", outcome: null,
    raw_time: null, cones: null, adjusted_time: null, indexed_time: null, factor: null,
    committed_at: null, committed_by_name: null,
  };
}

async function entryPosition(db: Db, event: EventRow, registrationId: string) {
  const standings = await computeStandings(db, event);
  const row = standings.find((s) => s.registrationId === registrationId);
  return {
    position: row?.position ?? null,
    classPosition: row?.classPosition ?? null,
    rawPosition: row?.rawPosition ?? null,
    bestAdjusted: row?.bestAdjusted ?? null,
    bestIndexed: row?.bestIndexed ?? null,
  };
}

/** Idempotency: scoped to the user, kept 24 hours, only sub-500 responses stored. */
export async function withIdempotency(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<void> {
  const key = request.headers["idempotency-key"];
  const user = request.user;
  if (!key || !user) {
    const result = await handler();
    reply.status(result.status).send(result.body);
    return;
  }
  if (key.length < 1 || key.length > 100) throw errValidation({ idempotencyKey: "The key must be 1 to 100 characters." });
  const bodyHash = hashBody(request.body);
  const existing = await db.query(
    `SELECT * FROM idempotency WHERE user_id = $1 AND key = $2 AND created_at > now() - interval '24 hours'`,
    [user.id, key],
  );
  if (existing[0]) {
    if (existing[0].body_hash !== bodyHash) {
      throw errConflict("idempotency_key_reused", "That idempotency key was used with a different request.");
    }
    reply.header("idempotent-replayed", "true");
    reply.status(existing[0].status as number).send(existing[0].response);
    return;
  }
  const result = await handler();
  if (result.status < 500) {
    await db.query(
      `INSERT INTO idempotency (user_id, key, endpoint, body_hash, status, response)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, key) DO NOTHING`,
      [user.id, key, request.url, bodyHash, result.status, JSON.stringify(result.body)],
    );
  }
  reply.status(result.status).send(result.body);
}

function hashBody(body: unknown): string {
  return JSON.stringify(body ?? null);
}
