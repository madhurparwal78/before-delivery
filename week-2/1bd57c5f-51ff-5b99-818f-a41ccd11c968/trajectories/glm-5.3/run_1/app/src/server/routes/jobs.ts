import express, { type Request, type Response } from "express";
import type { Db } from "../db/schema.js";
import type { PoolClient } from "pg";
import { withTransaction } from "../db/schema.js";
import { Errors, FIELD_MESSAGES } from "../errors.js";
import { utcIso } from "../times.js";
import type { Outline, Pt } from "../../shared/types.js";
import type { JobCtx, Membership } from "../context.js";
import { anchorOf, boundsOf, isValidOutline, polygonsOverlap, pointInOutline, roundPin } from "../geometry.js";
import { detectImage, stripMetadata, storage } from "../storage.js";
import { newId } from "../identity.js";
import { EventLog } from "../events.js";
import { derivedCounts, roomsOf, recordChange } from "../domain.js";
import { projectJob } from "../projection.js";
import { accessCodesAvailable, nextVisitFor } from "../visits.js";
import { withJob, readJob } from "./shared.js";

export function createJobsRouter(db: Db): express.Router {
  const router = express.Router();

  router.get("/jobs", async (req: Request, res: Response) => {
    const person = req.person!;
    const jobs = await db.query<{ id: string }>(
      `SELECT j.id FROM jobs j JOIN job_members m ON m.job_id = j.id AND m.person_id = $1 AND m.ended_at IS NULL
       WHERE j.firm_id = $2 ORDER BY j.created_at DESC, j.id`,
      [person.id, person.firmId],
    );
    const out: Record<string, unknown>[] = [];
    for (const row of jobs.rows) {
      out.push(await jobPayload(db, req, row.id));
    }
    res.json({ jobs: out });
  });

  router.post("/jobs", async (req: Request, res: Response) => {
    const person = req.person!;
    if (!person.isOwner) throw Errors.forbidden();
    const body = req.body as { name?: unknown; address?: unknown; time_zone?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const fields: Record<string, string> = {};
    if (name.length < 1 || name.length > 120) fields.name = "Job name must be 1 to 120 characters.";
    if (address.length < 1 || address.length > 200) fields.address = "Address must be 1 to 200 characters.";
    if (typeof body.time_zone !== "string" || !isValidTimeZoneName(body.time_zone)) fields.time_zone = "Pick a valid time zone.";
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);

    const jobId = newId("job");
    await withTransaction(db, async (client) => {
      await client.query(
        `INSERT INTO jobs (id, firm_id, name, address, time_zone) VALUES ($1, $2, $3, $4, $5)`,
        [jobId, person.firmId, name, address, body.time_zone as string],
      );
      await client.query(`INSERT INTO job_members (id, job_id, person_id, role) VALUES ($1, $2, $3, 'owner')`, [newId("mem"), jobId, person.id]);
    });
    res.status(201).json(await jobPayload(db, req, jobId));
  });

  router.get("/jobs/:jobId", async (req: Request, res: Response) => {
    res.json(await jobPayload(db, req, req.params.jobId));
  });

  router.post("/jobs/:jobId/actions", async (req: Request, res: Response) => {
    const action = (req.body as { action?: unknown }).action;
    if (action !== "start_walkthrough" && action !== "close_out") throw Errors.validation({ action: "Pick an action." });
    const jobId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      const log = new EventLog(ctx.client);
      if (action === "start_walkthrough") {
        if (ctx.jobStatus !== "active") throw Errors.invalidTransition();
        await ctx.client.query(`UPDATE jobs SET status = 'walkthrough' WHERE id = $1`, [ctx.jobId]);
      } else {
        if (ctx.jobStatus !== "walkthrough") throw Errors.invalidTransition();
        const unverified = await ctx.client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM items WHERE job_id = $1 AND deleted_at IS NULL AND status <> 'verified'`,
          [ctx.jobId],
        );
        if ((unverified.rows[0]?.n ?? 0) > 0) throw Errors.itemsNotVerified(unverified.rows[0]!.n);
        // Close-out deletes every stored object first; only then do the records commit.
        const keys = await ctx.client.query<{ object_key: string }>(
          `SELECT object_key FROM plan_revisions WHERE job_id = $1
           UNION ALL SELECT object_key FROM item_photos WHERE job_id = $1`,
          [ctx.jobId],
        );
        for (const row of keys.rows) {
          await storage.delete(row.object_key);
        }
        await ctx.client.query(`DELETE FROM plan_revisions WHERE job_id = $1`, [ctx.jobId]);
        await ctx.client.query(`DELETE FROM item_photos WHERE job_id = $1`, [ctx.jobId]);
        await ctx.client.query(`UPDATE jobs SET status = 'closed_out' WHERE id = $1`, [ctx.jobId]);
      }
      await log.emit(ctx.jobId, "job", {});
      return ctx.jobId;
    });
    res.json(await jobPayload(db, req, jobId));
  });

  // --- Plan ---

  router.put("/jobs/:jobId/plan", async (req: Request, res: Response) => {
    const file = (req as Request & { fileBuffer?: Buffer }).fileBuffer;
    if (file === undefined) throw Errors.validation({ file: "Pick a plan image." });
    const kind = detectImage(file);
    if (kind === null) throw Errors.unsupportedImage();
    const clean = stripMetadata(file, kind);
    const jobId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const max = await ctx.client.query<{ n: number }>(`SELECT max(revision) AS n FROM plan_revisions WHERE job_id = $1`, [ctx.jobId]);
      const revision = (max.rows[0]?.n ?? 0) + 1;
      const objectKey = `jobs/${ctx.jobId}/plan/${newId("obj")}.${kind.ext}`;
      await storage.put(objectKey, clean, kind.contentType);
      await ctx.client.query(
        `INSERT INTO plan_revisions (job_id, revision, object_key, content_type, uploaded_by, moved, needs_review)
         VALUES ($1, $2, $3, $4, $5, 0, 0)`,
        [ctx.jobId, revision, objectKey, kind.contentType, ctx.person.id],
      );
      if (revision > 1) {
        // An image-only upload on a job with a plan keeps every outline and
        // uses the identity transform.
        await applyPlanTransform(ctx.client, ctx.jobId, revision, IDENTITY_POINTS, null);
      } else {
        await new EventLog(ctx.client).emit(ctx.jobId, "plan", { revision, plan_url: `/api/jobs/${ctx.jobId}/plan` });
        await new EventLog(ctx.client).emit(ctx.jobId, "job", {});
      }
      return ctx.jobId;
    });
    res.json(await jobPayload(db, req, jobId));
  });

  router.get("/jobs/:jobId/plan", async (req: Request, res: Response) => {
    const { ctx, client, release } = await readJob(req, db, req.params.jobId);
    try {
      const row = await client.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM plan_revisions WHERE job_id = $1 ORDER BY revision DESC LIMIT 1`,
        [ctx.jobId],
      );
      const info = row.rows[0];
      if (info === undefined) throw Errors.notFound();
      const bytes = await storage.get(info.object_key);
      if (bytes === null) throw Errors.notFound();
      res.type(info.content_type).send(bytes);
    } finally {
      release();
    }
  });

  router.post("/jobs/:jobId/plan/revisions", async (req: Request, res: Response) => {
    const file = (req as Request & { fileBuffer?: Buffer }).fileBuffer;
    const form = (req as Request & { formFields?: Record<string, string> }).formFields;
    const referencePoints = parseReferencePoints(form?.reference_points);
    const roomsParsed = parseRooms(form?.rooms);
    if (file === undefined || referencePoints === null || roomsParsed === null) {
      throw Errors.validation({ file: "Pick a plan image.", reference_points: "Give three reference points.", rooms: "Give every room's corners." });
    }
    const kind = detectImage(file);
    if (kind === null) throw Errors.unsupportedImage();
    const clean = stripMetadata(file, kind);

    const result = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const planCount = await ctx.client.query<{ n: number }>(`SELECT count(*)::int AS n FROM plan_revisions WHERE job_id = $1`, [ctx.jobId]);
      if ((planCount.rows[0]?.n ?? 0) === 0) throw Errors.invalidTransition();

      const ordered = await roomsOf(ctx.client, ctx.jobId);
      const byId = new Map(ordered.map((r) => [r.id, r]));
      if (roomsParsed.length !== ordered.length || new Set(roomsParsed.map((r) => r.room_id)).size !== roomsParsed.length) {
        throw Errors.validation({ rooms: "Give every room's corners exactly once." });
      }
      for (const r of roomsParsed) {
        if (!byId.has(r.room_id) || !isValidOutline(r.outline)) {
          throw Errors.validation({ rooms: "Give each room 4 to 12 corners that trace a closed shape." });
        }
      }
      for (let i = 0; i < roomsParsed.length; i++) {
        for (let j = i + 1; j < roomsParsed.length; j++) {
          if (polygonsOverlap(roomsParsed[i].outline, roomsParsed[j].outline)) {
            throw Errors.validation({ rooms: FIELD_MESSAGES.outlineOverlap });
          }
        }
      }
      const max = await ctx.client.query<{ n: number }>(`SELECT max(revision) AS n FROM plan_revisions WHERE job_id = $1`, [ctx.jobId]);
      const revision = (max.rows[0]?.n ?? 0) + 1;
      const objectKey = `jobs/${ctx.jobId}/plan/${newId("obj")}.${kind.ext}`;
      await storage.put(objectKey, clean, kind.contentType);
      await ctx.client.query(
        `INSERT INTO plan_revisions (job_id, revision, object_key, content_type, reference_points, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.jobId, revision, objectKey, kind.contentType, JSON.stringify(referencePoints), ctx.person.id],
      );
      const outcome = await applyPlanTransform(ctx.client, ctx.jobId, revision, referencePoints, roomsParsed);
      return { jobId: ctx.jobId, revision, moved: outcome.moved, needsReview: outcome.needsReview };
    });
    const job = await jobPayload(db, req, result.jobId);
    res.status(201).json({ revision: result.revision, job, moved: result.moved, needs_review: result.needsReview });
  });

  router.get("/jobs/:jobId/plan/revisions", async (req: Request, res: Response) => {
    const rows = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      return ctx.client.query(
        `SELECT r.revision, r.created_at, p.name, m.role, r.moved, r.needs_review
         FROM plan_revisions r
         JOIN job_members m ON m.job_id = r.job_id AND m.person_id = r.uploaded_by AND m.ended_at IS NULL
         JOIN people p ON p.id = r.uploaded_by
         WHERE r.job_id = $1 ORDER BY r.revision`,
        [ctx.jobId],
      );
    });
    res.json({
      revisions: rows.rows.map((r) => ({
        revision: r.revision,
        created_at: utcIso(r.created_at),
        uploaded_by: { name: r.name, role: r.role },
        moved: r.moved,
        needs_review: r.needs_review,
      })),
    });
  });

  router.get("/jobs/:jobId/plan/revisions/:n", async (req: Request, res: Response) => {
    const { ctx, client, release } = await readJob(req, db, req.params.jobId);
    try {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      const n = Number(req.params.n);
      const row = await client.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM plan_revisions WHERE job_id = $1 AND revision = $2`,
        [ctx.jobId, n],
      );
      const info = row.rows[0];
      if (info === undefined || !Number.isInteger(n)) throw Errors.notFound();
      const bytes = await storage.get(info.object_key);
      if (bytes === null) throw Errors.notFound();
      res.type(info.content_type).send(bytes);
    } finally {
      release();
    }
  });

  // --- Rooms ---

  router.get("/jobs/:jobId/rooms", async (req: Request, res: Response) => {
    const rooms = await withJob(req, db, req.params.jobId, async (ctx) => {
      return roomPayloads(ctx.client, ctx.jobId, ctx.membership);
    });
    res.json({ rooms });
  });

  router.post("/jobs/:jobId/rooms", async (req: Request, res: Response) => {
    const body = req.body as { name?: unknown; outline?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const outline = Array.isArray(body.outline) ? (body.outline as unknown as Outline) : undefined;
    const fields: Record<string, string> = {};
    if (name.length < 1 || name.length > 60) fields.name = "Room name must be 1 to 60 characters.";
    if (outline === undefined || !isValidOutline(outline)) fields.outline = "Give 4 to 12 corners that trace a closed shape.";
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);

    const room = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const dupe = await ctx.client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM rooms WHERE job_id = $1 AND lower(name) = lower($2)`,
        [ctx.jobId, name],
      );
      if ((dupe.rows[0]?.n ?? 0) > 0) throw Errors.validation({ name: "That room name is already used." });
      const rooms = await roomsOf(ctx.client, ctx.jobId);
      for (const room of rooms) {
        if (polygonsOverlap(room.outline, outline!)) throw Errors.validation({ outline: FIELD_MESSAGES.outlineOverlap });
      }
      const maxOrder = await ctx.client.query<{ n: number }>(`SELECT coalesce(max(sort_order), -1) AS n FROM rooms WHERE job_id = $1`, [ctx.jobId]);
      const id = newId("room");
      await ctx.client.query(
        `INSERT INTO rooms (id, job_id, name, outline, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [id, ctx.jobId, name, JSON.stringify(outline), (maxOrder.rows[0]?.n ?? -1) + 1],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "room", { room_id: id });
      return { id, name, outline: outline! };
    });
    res.status(201).json({
      id: room.id,
      name: room.name,
      outline: room.outline,
      bounds: boundsOf(room.outline),
      anchor: anchorOf(room.outline),
      counts: { verified: 0, total: 0 },
    });
  });

  return router;
}

const IDENTITY_POINTS: { old: Pt; new: Pt }[] = [
  { old: { x: 0, y: 0 }, new: { x: 0, y: 0 } },
  { old: { x: 1, y: 0 }, new: { x: 1, y: 0 } },
  { old: { x: 0, y: 1 }, new: { x: 0, y: 1 } },
];

function isValidTimeZoneName(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function roomPayloads(client: PoolClient, jobId: string, membership: Membership): Promise<Record<string, unknown>[]> {
  const rooms = await roomsOf(client, jobId);
  const counts = await derivedCounts(client, jobId, membership);
  const countMap = new Map(counts.rooms.map((r) => [r.id, r.counts]));
  return rooms.map((r) => ({
    id: r.id,
    name: r.name,
    outline: r.outline,
    bounds: boundsOf(r.outline),
    anchor: anchorOf(r.outline),
    counts: countMap.get(r.id) ?? { verified: 0, total: 0 },
  }));
}

function parseReferencePoints(raw: string | undefined): { old: Pt; new: Pt }[] | null {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const out: { old: Pt; new: Pt }[] = [];
    for (const pair of parsed) {
      if (typeof pair !== "object" || pair === null) return null;
      const p = pair as { old?: { x?: unknown; y?: unknown }; new?: { x?: unknown; y?: unknown } };
      if (
        typeof p.old?.x !== "number" || typeof p.old?.y !== "number" ||
        typeof p.new?.x !== "number" || typeof p.new?.y !== "number"
      ) return null;
      for (const v of [p.old.x, p.old.y, p.new.x, p.new.y]) {
        if (!Number.isFinite(v) || v < 0 || v > 1) return null;
        if (decimals(v) > 4) return null;
      }
      out.push({ old: { x: p.old.x, y: p.old.y }, new: { x: p.new.x, y: p.new.y } });
    }
    return out;
  } catch {
    return null;
  }
}

function decimals(v: number): number {
  const s = v.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function parseRooms(raw: string | undefined): { room_id: string; outline: Outline }[] | null {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: { room_id: string; outline: Outline }[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) return null;
      const e = entry as { room_id?: unknown; outline?: unknown };
      if (typeof e.room_id !== "string" || !Array.isArray(e.outline)) return null;
      out.push({ room_id: e.room_id, outline: e.outline as unknown as Outline });
    }
    return out;
  } catch {
    return null;
  }
}

/** Solves the affine transform exactly from three pairs. */
export function solveAffineExact(points: { old: Pt; new: Pt }[]): { a: number[][]; t: Pt } {
  const [o1, o2, o3] = points.map((p) => p.old);
  const [n1, n2, n3] = points.map((p) => p.new);
  const d = (o2.x - o1.x) * (o3.y - o1.y) - (o3.x - o1.x) * (o2.y - o1.y);
  const rx1 = n1.x - o1.x, rx2 = n2.x - o1.x, rx3 = n3.x - o1.x;
  const ry1 = n1.y - o1.y, ry2 = n2.y - o1.y, ry3 = n3.y - o1.y;
  const a11 = (rx2 * (o3.y - o1.y) - rx3 * (o2.y - o1.y)) / d;
  const a12 = (rx3 * (o2.x - o1.x) - rx2 * (o3.x - o1.x)) / d;
  const a21 = (ry2 * (o3.y - o1.y) - ry3 * (o2.y - o1.y)) / d;
  const a22 = (ry3 * (o2.x - o1.x) - ry2 * (o3.x - o1.x)) / d;
  const tx = rx1 - (a11 * o1.x + a12 * o1.y);
  const ty = ry1 - (a21 * o1.x + a22 * o1.y);
  return { a: [[a11, a12], [a21, a22]], t: { x: tx, y: ty } };
}

/** Maps every pinned item through the revision's transform, replaces the room
 *  outlines when the request carries them, re-files by the pin rules and flags
 *  pins that fall outside every room. */
export async function applyPlanTransform(
  client: PoolClient,
  jobId: string,
  revision: number,
  points: { old: Pt; new: Pt }[],
  newRooms: { room_id: string; outline: Outline }[] | null,
): Promise<{ moved: number; needsReview: number }> {
  const [o1, o2, o3] = points.map((p) => p.old);
  const twiceArea = Math.abs((o2.x - o1.x) * (o3.y - o1.y) - (o3.x - o1.x) * (o2.y - o1.y));
  if (twiceArea < 0.000001) throw Errors.validation({ reference_points: FIELD_MESSAGES.referencePointsCollinear });
  const tr = solveAffineExact(points);

  const ordered = await roomsOf(client, jobId);
  if (newRooms !== null) {
    const byId = new Map(newRooms.map((r) => [r.room_id, r.outline]));
    for (const room of ordered) {
      const outline = byId.get(room.id);
      if (outline !== undefined) {
        await client.query(`UPDATE rooms SET outline = $2 WHERE id = $1`, [room.id, JSON.stringify(outline)]);
        room.outline = outline;
      }
    }
  }

  const log = new EventLog(client);
  let moved = 0;
  let needsReview = 0;
  const items = await client.query<{ id: string; number: number; pin_x: string; pin_y: string; room_id: string }>(
    `SELECT id, number, pin_x::text AS pin_x, pin_y::text AS pin_y, room_id FROM items
     WHERE job_id = $1 AND deleted_at IS NULL AND pin_x IS NOT NULL ORDER BY number`,
    [jobId],
  );
  for (const item of items.rows) {
    const p = { x: Number(item.pin_x), y: Number(item.pin_y) };
    const mapped = {
      x: roundPin(tr.a[0][0] * p.x + tr.a[0][1] * p.y + tr.t.x),
      y: roundPin(tr.a[1][0] * p.x + tr.a[1][1] * p.y + tr.t.y),
    };
    const containing = ordered.filter((r) => pointInOutline(mapped, r.outline));
    if (mapped.x < 0 || mapped.x > 1 || mapped.y < 0 || mapped.y > 1 || containing.length === 0) {
      await client.query(
        `UPDATE items SET pin_x = NULL, pin_y = NULL, pin_status = 'needs_review', updated_at = now() WHERE id = $1`,
        [item.id],
      );
      needsReview++;
    } else {
      const roomId = containing.find((r) => r.id === item.room_id)?.id ?? containing[0].id;
      await client.query(
        `UPDATE items SET pin_x = $1, pin_y = $2, pin_status = 'placed', room_id = $3, updated_at = now() WHERE id = $4`,
        [mapped.x.toFixed(4), mapped.y.toFixed(4), roomId, item.id],
      );
      if (roomId !== item.room_id) await recordChange(client, jobId);
      if (mapped.x !== p.x || mapped.y !== p.y) moved++;
    }
    await log.emit(jobId, "item", { item_id: item.id });
  }
  for (const room of ordered) {
    await log.emit(jobId, "room", { room_id: room.id });
  }
  await log.emit(jobId, "counts", {});
  await log.emit(jobId, "plan", { revision, plan_url: `/api/jobs/${jobId}/plan` });
  await log.emit(jobId, "costs", {});
  await log.emit(jobId, "job", {});
  return { moved, needsReview };
}

/** The Job payload, projected for the caller's role and scope. */
export async function jobPayload(db: Db, req: Request, jobId: string): Promise<Record<string, unknown>> {
  const { ctx, client, release } = await readJob(req, db, jobId);
  try {
    const jobRow = await client.query<{ name: string; address: string; time_zone: string; status: JobCtx["jobStatus"] }>(
      `SELECT name, address, time_zone, status FROM jobs WHERE id = $1`, [ctx.jobId],
    );
    const job = jobRow.rows[0]!;
    const planInfo = await client.query<{ n: number }>(`SELECT max(revision) AS n FROM plan_revisions WHERE job_id = $1`, [ctx.jobId]);
    const planRevision = planInfo.rows[0]?.n ?? null;
    const counts = await derivedCounts(client, ctx.jobId, ctx.membership);
    const available = await accessCodesAvailable(client, ctx.jobId, ctx.membership);
    const next = await nextVisitFor(client, ctx.jobId, ctx.membership);
    return projectJob(ctx, {
      id: ctx.jobId,
      name: job.name,
      address: job.address,
      time_zone: job.time_zone,
      status: job.status,
      plan_url: planRevision === null ? null : `/api/jobs/${ctx.jobId}/plan`,
      plan_revision: planRevision,
      access_codes_available: available,
      next_visit: next,
    }, counts.progress);
  } finally {
    release();
  }
}
