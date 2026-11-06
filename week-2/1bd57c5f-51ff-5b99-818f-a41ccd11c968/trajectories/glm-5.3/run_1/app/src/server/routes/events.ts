/** The per-job live event stream. Events are stored once and projected for
 *  each receiver's role and scope at delivery time, on every server process
 *  that shares the database. */

import express, { type Request, type Response } from "express";
import type { Db } from "../db/schema.js";
import { activeMembership, jobContext, type Person, type JobCtx } from "../context.js";
import { Errors } from "../errors.js";
import { latestSeq, oldestKeptSeq } from "../events.js";
import { canSeeItem, projectItem, projectJob, projectNote } from "../projection.js";
import { derivedCounts, itemById, itemExtras, costsAt, notesOf, roomsOf } from "../domain.js";
import { anchorOf, boundsOf } from "../geometry.js";
import type { VisitRow } from "../visits.js";
import { loadVisits, projectVisit, accessCodesAvailable, nextVisitFor } from "../visits.js";

type Frame = { seq: number; event: string; data: string };

type StreamState = {
  jobId: string;
  person: Person;
  memberId: string;
  lastSeq: number;
  res: Response;
  closed: boolean;
  timeZone: string;
};

const KEEPALIVE_MS = 15000;
const POLL_MS = 700;

export function createEventsRouter(db: Db): express.Router {
  const router = express.Router();

  router.get("/jobs/:jobId/events", async (req: Request, res: Response) => {
    const person = req.person!;
    if (person === undefined) throw Errors.unauthenticated();

    const client = await db.connect();
    let timeZone: string;
    let memberId: string;
    try {
      const ctx = await jobContext(db, client, person, req.params.jobId);
      timeZone = ctx.timeZone;
      memberId = ctx.membership.id;
    } finally {
      client.release();
    }

    const afterHeader = req.headers["last-event-id"];
    const afterQuery = typeof req.query.after === "string" ? req.query.after : undefined;
    const resumeFrom = afterHeader !== undefined ? Number(afterHeader) : afterQuery !== undefined ? Number(afterQuery) : undefined;

    res.status(200);
    res.type("text/event-stream");
    res.flushHeaders?.();

    const state: StreamState = { jobId: req.params.jobId, person, memberId, lastSeq: 0, res, closed: false, timeZone };

    const latest = await latestSeq(db, state.jobId);
    if (resumeFrom !== undefined && Number.isFinite(resumeFrom)) {
      const oldest = await oldestKeptSeq(db, state.jobId);
      if (resumeFrom > latest || resumeFrom + 1 < oldest) {
        sendFrame(state, { seq: latest, event: "reset", data: "{}" });
        state.lastSeq = latest;
      } else {
        state.lastSeq = resumeFrom;
        await deliverMissed(db, state);
      }
    } else {
      state.lastSeq = latest;
    }

    const poll = setInterval(() => {
      void pollOnce(db, state);
    }, POLL_MS);
    const keepAlive = setInterval(() => {
      if (!state.closed) state.res.write(": keep-alive\n\n");
    }, KEEPALIVE_MS);

    req.on("close", () => {
      state.closed = true;
      clearInterval(poll);
      clearInterval(keepAlive);
    });
  });

  return router;
}

async function pollOnce(db: Db, state: StreamState): Promise<void> {
  if (state.closed) return;
  try {
    const stillMember = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM job_members WHERE job_id = $1 AND id = $2 AND ended_at IS NULL`,
      [state.jobId, state.memberId],
    );
    if ((stillMember.rows[0]?.n ?? 0) === 0) {
      sendFrame(state, { seq: state.lastSeq, event: "role_ended", data: "{}" });
      close(state);
      return;
    }
    if (!await sessionAlive(db, state)) {
      close(state);
      return;
    }
    const rows = await db.query<{ seq: number; type: string; payload: unknown }>(
      `SELECT seq, type, payload FROM events WHERE job_id = $1 AND seq > $2 ORDER BY seq`,
      [state.jobId, state.lastSeq],
    );
    for (const row of rows.rows) {
      const frame = await projectEvent(db, state, row.type, row.payload, row.seq);
      if (frame !== null) sendFrame(state, frame);
      state.lastSeq = row.seq;
    }
  } catch (e) {
    console.error("stream poll failed:", e);
  }
}

async function sessionAlive(db: Db, state: StreamState): Promise<boolean> {
  const res = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sessions s JOIN job_members m ON m.person_id = s.person_id
     WHERE m.id = $1 LIMIT 1`,
    [state.memberId],
  );
  return (res.rows[0]?.n ?? 0) > 0;
}

async function deliverMissed(db: Db, state: StreamState): Promise<void> {
  const rows = await db.query<{ seq: number; type: string; payload: unknown }>(
    `SELECT seq, type, payload FROM events WHERE job_id = $1 AND seq > $2 ORDER BY seq`,
    [state.jobId, state.lastSeq],
  );
  for (const row of rows.rows) {
    const frame = await projectEvent(db, state, row.type, row.payload, row.seq);
    if (frame !== null) sendFrame(state, frame);
    state.lastSeq = row.seq;
  }
}

function sendFrame(state: StreamState, frame: Frame): void {
  if (state.closed) return;
  state.res.write(`id: ${frame.seq}\nevent: ${frame.event}\ndata: ${frame.data}\n\n`);
}

function close(state: StreamState): void {
  if (state.closed) return;
  state.closed = true;
  state.res.end();
}

/** Projects one stored event for the receiver, or null when it is out of scope.
 *  Scope and projection are judged at delivery time. */
async function projectEvent(
  db: Db,
  state: StreamState,
  type: string,
  payload: unknown,
  seq: number,
): Promise<Frame | null> {
  const client = await db.connect();
  try {
    const membership = await activeMembership(client, state.jobId, state.person);
    if (membership === null) {
      close(state);
      return null;
    }
    const p = (payload ?? {}) as Record<string, unknown>;
    const ctx: JobCtx = { db, client, membership, person: state.person, jobId: state.jobId, timeZone: state.timeZone, jobStatus: "active" };

    switch (type) {
      case "item": {
        const item = await itemById(client, state.jobId, String(p.item_id));
        if (item === null || item.deleted_at !== null || !canSeeItem(membership, item)) return null;
        return frame(seq, "item", { item: projectItem(ctx, state.jobId, item, await itemExtras(ctx, item)) });
      }
      case "item_deleted": {
        if (membership.role === "trade" && membership.trade !== null && p.trade !== membership.trade) return null;
        return frame(seq, "item_deleted", { id: p.id, number: p.number });
      }
      case "room": {
        const rooms = await roomsOf(client, state.jobId);
        const room = rooms.find((r) => r.id === p.room_id);
        if (room === undefined) return null;
        const counts = await derivedCounts(client, state.jobId, membership);
        const roomCounts = counts.rooms.find((r) => r.id === room.id)?.counts ?? { verified: 0, total: 0 };
        return frame(seq, "room", {
          room: {
            id: room.id,
            name: room.name,
            outline: room.outline,
            bounds: boundsOf(room.outline),
            anchor: anchorOf(room.outline),
            counts: roomCounts,
          },
        });
      }
      case "counts": {
        const counts = await derivedCounts(client, state.jobId, membership);
        return frame(seq, "counts", { progress: counts.progress, rooms: counts.rooms });
      }
      case "note": {
        const item = await itemById(client, state.jobId, String(p.item_id));
        if (item === null || item.deleted_at !== null || !canSeeItem(membership, item)) return null;
        const visible = await notesOf(client, state.jobId, item.id, membership, item.trade);
        const note = visible.find((n) => n.id === p.note_id);
        if (note === undefined) return null;
        return frame(seq, "note", { item_id: item.id, note: projectNote(note) });
      }
      case "plan": {
        return frame(seq, "plan", { revision: p.revision, plan_url: `/api/jobs/${state.jobId}/plan` });
      }
      case "visit": {
        if (membership.role === "homeowner") return null;
        const visits = await loadVisits(client, state.jobId, membership.role === "trade" ? membership.id : null);
        const visit: VisitRow | undefined = visits.find((v: VisitRow) => v.id === p.visit_id);
        if (visit === undefined) return null;
        return frame(seq, "visit", { visit: projectVisit(state.timeZone, visit, new Date()) });
      }
      case "visit_deleted": {
        if (membership.role === "homeowner") return null;
        if (membership.role === "trade" && p.member_id !== membership.id) return null;
        return frame(seq, "visit_deleted", { id: p.id });
      }
      case "costs": {
        if (membership.role !== "owner" && membership.role !== "lead") return null;
        return frame(seq, "costs", await costsAt(client, state.jobId, new Date()));
      }
      case "job": {
        const jobRow = await client.query<{ name: string; address: string; time_zone: string; status: "active" | "walkthrough" | "closed_out" }>(
          `SELECT name, address, time_zone, status FROM jobs WHERE id = $1`, [state.jobId],
        );
        const job = jobRow.rows[0]!;
        const planInfo = await client.query<{ n: number }>(`SELECT max(revision) AS n FROM plan_revisions WHERE job_id = $1`, [state.jobId]);
        const counts = await derivedCounts(client, state.jobId, membership);
        return frame(seq, "job", {
          job: projectJob(ctx, {
            id: state.jobId,
            name: job.name,
            address: job.address,
            time_zone: job.time_zone,
            status: job.status,
            plan_url: (planInfo.rows[0]?.n ?? 0) === 0 ? null : `/api/jobs/${state.jobId}/plan`,
            plan_revision: planInfo.rows[0]?.n ?? null,
            access_codes_available: await accessCodesAvailable(client, state.jobId, membership),
            next_visit: await nextVisitFor(client, state.jobId, membership),
          }, counts.progress),
        });
      }
      case "role_ended": {
        if (p.person_id === state.person.id) return frame(seq, "role_ended", {});
        return null;
      }
      default:
        return null;
    }
  } finally {
    client.release();
  }
}

function frame(seq: number, event: string, data: unknown): Frame {
  return { seq, event, data: JSON.stringify(data) };
}
