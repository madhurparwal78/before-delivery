import express, { type Request, type Response } from "express";
import type { Db } from "../db/schema.js";
import { Errors } from "../errors.js";
import { newId, hashPassword } from "../identity.js";
import { EventLog } from "../events.js";
import { utcIso } from "../times.js";
import type { JobCtx, Membership } from "../context.js";
import { endRole } from "../context.js";
import { projectMember } from "../projection.js";
import type { TradeKey, Role } from "../../shared/types.js";
import { TRADES } from "../../shared/types.js";
import {
  loadVisits, occurrenceFieldErrors, occurrenceUtc, openWindowsFor, overlapDate, parseLocalDateTime,
  projectVisit, recurrenceDates, visitById,
} from "../visits.js";
import { withJob, readJob } from "./shared.js";

export function createPeopleRouter(db: Db): express.Router {
  const router = express.Router();

  // --- Members ---

  router.get("/jobs/:jobId/members", async (req: Request, res: Response) => {
    const members = await withJob(req, db, req.params.jobId, async (ctx) => {
      const rows = await ctx.client.query<{ id: string; name: string; role: Role; trade: TradeKey | null; email: string; phone: string | null }>(
        `SELECT m.id, p.name, m.role, m.trade, p.email, p.phone FROM job_members m JOIN people p ON p.id = m.person_id
         WHERE m.job_id = $1 AND m.ended_at IS NULL ORDER BY m.started_at, m.id`,
        [ctx.jobId],
      );
      return rows.rows.map((r) => projectMember(ctx.membership, r));
    });
    res.json({ members });
  });

  router.post("/jobs/:jobId/members", async (req: Request, res: Response) => {
    const body = req.body as { name?: unknown; email?: unknown; phone?: unknown; role?: unknown; trade?: unknown; initial_password?: unknown };
    const fields: Record<string, string> = {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const role = body.role;
    const trade = body.trade;

    if (name.length < 1 || name.length > 120) fields.name = "Name must be 1 to 120 characters.";
    if (email.length < 3 || !email.includes("@")) fields.email = "Enter an email.";
    if (role !== "lead" && role !== "trade" && role !== "homeowner") fields.role = "Pick a role.";
    if (role === "trade") {
      if (typeof trade !== "string" || !TRADES.includes(trade as TradeKey)) fields.trade = "Pick a trade.";
    } else if (trade !== null && trade !== undefined) {
      fields.trade = "Trades apply to trade roles only.";
    }
    if (typeof body.initial_password === "string" && (body.initial_password.length < 10 || body.initial_password.length > 200)) {
      fields.initial_password = "Initial password must be 10 to 200 characters.";
    }
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);

    const member = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();

      const person = await ctx.client.query<{ id: string }>(
        `SELECT id FROM people WHERE lower(email) = lower($1)`, [email],
      );
      const personId = person.rows[0]?.id;
      const existing = personId === undefined
        ? undefined
        : (await ctx.client.query<{ id: string }>(
            `SELECT m.id FROM job_members m WHERE m.job_id = $1 AND m.person_id = $2 AND m.ended_at IS NULL`,
            [ctx.jobId, personId],
          )).rows[0];
      if (existing !== undefined) throw Errors.alreadyMember();

      let newPersonId = personId;
      if (newPersonId === undefined) {
        if (typeof body.initial_password !== "string") {
          throw Errors.validation({ initial_password: "Give an initial password for a new person." });
        }
        newPersonId = newId("person");
        const hash = await hashPassword(body.initial_password);
        await ctx.client.query(
          `INSERT INTO people (id, firm_id, name, email, phone, password_hash, is_owner) VALUES ($1, $2, $3, $4, $5, $6, false)`,
          [newPersonId, ctx.person.firmId, name, email, phone, hash],
        );
      }
      const memberId = newId("mem");
      await ctx.client.query(
        `INSERT INTO job_members (id, job_id, person_id, role, trade) VALUES ($1, $2, $3, $4, $5)`,
        [memberId, ctx.jobId, newPersonId, role as Role, role === "trade" ? (trade as TradeKey) : null],
      );
      return { id: memberId, name, role: role as Role, trade: role === "trade" ? (trade as TradeKey) : null, email, phone };
    });
    res.status(201).json(member);
  });

  router.delete("/jobs/:jobId/members/:memberId", async (req: Request, res: Response) => {
    await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      const row = await ctx.client.query<{ id: string; role: string; person_id: string }>(
        `SELECT m.id, m.role, m.person_id FROM job_members m WHERE m.job_id = $1 AND m.id = $2 AND m.ended_at IS NULL`,
        [ctx.jobId, req.params.memberId],
      );
      const member = row.rows[0];
      if (member === undefined) throw Errors.notFound();
      if (member.role === "owner") throw Errors.invalidTransition();
      await endRole(ctx.client, ctx.jobId, member.id);
      await new EventLog(ctx.client).emit(ctx.jobId, "role_ended", { person_id: member.person_id });
      return member.id;
    });
    res.status(204).end();
  });

  // --- Visits ---

  router.get("/jobs/:jobId/visits", async (req: Request, res: Response) => {
    const visits = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role === "homeowner") throw Errors.forbidden();
      const filter = ctx.membership.role === "trade" ? ctx.membership.id : null;
      const rows = await loadVisits(ctx.client, ctx.jobId, filter);
      return rows.map((v) => projectVisit(ctx.timeZone, v, new Date()));
    });
    res.json({ visits });
  });

  router.post("/jobs/:jobId/visits", async (req: Request, res: Response) => {
    const body = req.body as { member_id?: unknown; starts_at?: unknown; ends_at?: unknown; recurrence?: unknown };
    const start = parseLocalDateTime(body.starts_at);
    const end = parseLocalDateTime(body.ends_at);
    const recurrence = (body.recurrence ?? null) as { freq?: unknown } | null;

    const visitId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();

      const fields: Record<string, string> = {};
      const memberRow = await ctx.client.query<{ id: string; role: string; trade: TradeKey | null }>(
        `SELECT m.id, m.role, m.trade FROM job_members m WHERE m.job_id = $1 AND m.id = $2 AND m.ended_at IS NULL`,
        [ctx.jobId, body.member_id],
      );
      const member = memberRow.rows[0];
      if (member === undefined) throw Errors.notFound();
      if (member.role !== "trade") fields.member_id = "Pick a trade for the visit.";

      const startReadable = start !== null;
      const endReadable = end !== null;
      const ruleOk = recurrence === null || (typeof recurrence === "object" && (recurrence.freq === "daily" || recurrence.freq === "weekly" || recurrence.freq === "every_n_days"));
      if (!startReadable) fields.starts_at = "Give the start as YYYY-MM-DDTHH:MM.";
      if (!endReadable) fields.ends_at = "Give the end as YYYY-MM-DDTHH:MM.";
      if (!ruleOk) fields.recurrence = "Pick a repeat that gives 60 occurrences or fewer within 180 days.";
      if (Object.keys(fields).length > 0) {
        // A broken request still answers 409 when its first occurrence overlaps.
        if (startReadable && endReadable) {
          const clash = await firstOccurrenceOverlap(ctx, member.id, start!, end!);
          if (clash !== null) throw Errors.visitOverlap(clash);
        }
        throw Errors.validation(fields);
      }

      const dates = recurrenceDates(start!, recurrence as never);
      if (!Array.isArray(dates)) {
        const clash = await firstOccurrenceOverlap(ctx, member.id, start!, end!);
        if (clash !== null) throw Errors.visitOverlap(clash);
        throw Errors.validation({ recurrence: "Pick a repeat that gives 60 occurrences or fewer within 180 days." });
      }

      const occurrences: { date: string; startsAtUtc: Date; endsAtUtc: Date }[] = [];
      for (const date of dates as string[]) {
        const s = occurrenceUtc(date, start!, ctx.timeZone);
        const e = occurrenceUtc(date, end!, ctx.timeZone);
        if (s === null || e === null) {
          fields[s === null ? "starts_at" : "ends_at"] = "That time does not exist on that date.";
          throw Errors.validation(fields);
        }
        occurrences.push({ date, startsAtUtc: s, endsAtUtc: e });
      }

      const clash = await overlapDate(ctx.client, ctx.jobId, member.id, occurrences, null);
      if (clash !== null) throw Errors.visitOverlap(clash);

      const firstError = occurrenceFieldErrors(start!, end!);
      if (firstError !== null) throw Errors.validation({ [firstError.field]: firstError.message });
      if (occurrences[0].endsAtUtc.getTime() <= Date.now()) {
        throw Errors.validation({ ends_at: "Pick a visit that ends in the future." });
      }

      const id = newId("visit");
      await ctx.client.query(
        `INSERT INTO visits (id, job_id, member_id, starts_at_local, ends_at_local, starts_at_utc, ends_at_utc, recurrence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, ctx.jobId, member.id, localString(start!), localString(end!),
          occurrences[0].startsAtUtc.toISOString(), occurrences[0].endsAtUtc.toISOString(), JSON.stringify(recurrence)],
      );
      for (const occ of occurrences) {
        await ctx.client.query(
          `INSERT INTO visit_occurrences (visit_id, date, starts_at_utc, ends_at_utc, status) VALUES ($1, $2, $3, $4, 'scheduled')`,
          [id, occ.date, occ.startsAtUtc.toISOString(), occ.endsAtUtc.toISOString()],
        );
      }
      await new EventLog(ctx.client).emit(ctx.jobId, "visit", { visit_id: id });
      return id;
    });

    const visit = await withJob(req, db, req.params.jobId, async (ctx) => {
      return projectVisit(ctx.timeZone, (await visitById(ctx.client, ctx.jobId, visitId))!, new Date());
    });
    res.status(201).json(visit);
  });

  router.put("/jobs/:jobId/visits/:visitId/occurrences/:date", async (req: Request, res: Response) => {
    const body = req.body as { starts_at?: unknown; ends_at?: unknown };
    const start = parseLocalDateTime(body.starts_at);
    const end = parseLocalDateTime(body.ends_at);
    const visitId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const visit = await visitById(ctx.client, ctx.jobId, req.params.visitId);
      if (visit === null) throw Errors.notFound();
      const occ = visit.occurrences.find((o) => o.date === req.params.date);
      if (occ === undefined || occ.status === "cancelled") throw Errors.notFound();
      if (occ.ends_at_utc.getTime() <= Date.now()) throw Errors.invalidTransition();
      if (start === null || end === null) {
        const fields: Record<string, string> = {};
        if (start === null) fields.starts_at = "Give the start as YYYY-MM-DDTHH:MM.";
        if (end === null) fields.ends_at = "Give the end as YYYY-MM-DDTHH:MM.";
        throw Errors.validation(fields);
      }

      const startUtc = occurrenceUtc(start.date, start, ctx.timeZone);
      const endUtc = occurrenceUtc(end.date, end, ctx.timeZone);
      const fields: Record<string, string> = {};
      if (startUtc === null) fields.starts_at = "That time does not exist on that date.";
      if (endUtc === null) fields.ends_at = "That time does not exist on that date.";
      if (startUtc === null || endUtc === null) throw Errors.validation(fields);

      const clash = await overlapDate(ctx.client, ctx.jobId, visit.member_id, [{ startsAtUtc: startUtc!, endsAtUtc: endUtc! }], visit.id);
      if (clash !== null) throw Errors.visitOverlap(clash);
      const firstError = occurrenceFieldErrors(start, end);
      if (firstError !== null) throw Errors.validation({ [firstError.field]: firstError.message });
      if (endUtc.getTime() <= Date.now()) throw Errors.validation({ ends_at: "Pick a visit that ends in the future." });

      await ctx.client.query(
        `UPDATE visit_occurrences SET starts_at_utc = $1, ends_at_utc = $2, status = 'moved' WHERE visit_id = $3 AND date = $4`,
        [startUtc.toISOString(), endUtc.toISOString(), visit.id, occ.date],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "visit", { visit_id: visit.id });
      return visit.id;
    });
    const visit = await withJob(req, db, req.params.jobId, async (ctx) => {
      return projectVisit(ctx.timeZone, (await visitById(ctx.client, ctx.jobId, visitId))!, new Date());
    });
    res.json(visit);
  });

  router.delete("/jobs/:jobId/visits/:visitId/occurrences/:date", async (req: Request, res: Response) => {
    const visitId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const visit = await visitById(ctx.client, ctx.jobId, req.params.visitId);
      if (visit === null) throw Errors.notFound();
      const occ = visit.occurrences.find((o) => o.date === req.params.date);
      if (occ === undefined || occ.status === "cancelled") throw Errors.notFound();
      if (occ.ends_at_utc.getTime() <= Date.now()) throw Errors.invalidTransition();
      await ctx.client.query(`UPDATE visit_occurrences SET status = 'cancelled' WHERE visit_id = $1 AND date = $2`, [visit.id, occ.date]);
      await new EventLog(ctx.client).emit(ctx.jobId, "visit", { visit_id: visit.id });
      return visit.id;
    });
    const visit = await withJob(req, db, req.params.jobId, async (ctx) => {
      return projectVisit(ctx.timeZone, (await visitById(ctx.client, ctx.jobId, visitId))!, new Date());
    });
    res.json(visit);
  });

  router.delete("/jobs/:jobId/visits/:visitId", async (req: Request, res: Response) => {
    await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const visit = await visitById(ctx.client, ctx.jobId, req.params.visitId);
      if (visit === null) throw Errors.notFound();
      await ctx.client.query(`DELETE FROM visits WHERE id = $1`, [visit.id]);
      await new EventLog(ctx.client).emit(ctx.jobId, "visit_deleted", { id: visit.id, member_id: visit.member_id });
      return visit.id;
    });
    res.status(204).end();
  });

  // --- Access ---

  router.get("/jobs/:jobId/access", async (req: Request, res: Response) => {
    const visibleUntil = await withJob(req, db, req.params.jobId, async (ctx) => {
      const role = ctx.membership.role;
      if (role === "homeowner") throw Errors.forbidden();
      let until: Date | null = null;
      if (role === "trade") {
        const windows = await openWindowsFor(ctx.client, ctx.jobId, ctx.membership);
        if (windows.length === 0) throw Errors.outsideSiteVisit();
        until = windows.reduce((max, w) => (w > max ? w : max), windows[0]!);
      }
      await ctx.client.query(
        `INSERT INTO access_reveals (id, job_id, member_id) VALUES ($1, $2, $3)`,
        [newId("reveal"), ctx.jobId, ctx.membership.id],
      );
      return until;
    });
    const { ctx, client, release } = await readJob(req, db, req.params.jobId);
    try {
      const row = await client.query<{ lockbox_code: string; alarm_code: string; garage_code: string; house_note: string }>(
        `SELECT lockbox_code, alarm_code, garage_code, house_note FROM access_cards WHERE job_id = $1`, [ctx.jobId],
      );
      res.json({
        lockbox_code: row.rows[0]?.lockbox_code ?? "",
        alarm_code: row.rows[0]?.alarm_code ?? "",
        garage_code: row.rows[0]?.garage_code ?? "",
        house_note: row.rows[0]?.house_note ?? "",
        visible_until: visibleUntil === null ? null : utcIso(visibleUntil),
      });
    } finally {
      release();
    }
  });

  router.put("/jobs/:jobId/access", async (req: Request, res: Response) => {
    const body = req.body as { lockbox_code?: unknown; alarm_code?: unknown; garage_code?: unknown; house_note?: unknown };
    const fields: Record<string, string> = {};
    for (const key of ["lockbox_code", "alarm_code", "garage_code"] as const) {
      if (typeof body[key] !== "string" || body[key].length > 40) fields[key] = "Codes are up to 40 characters.";
    }
    if (typeof body.house_note !== "string" || body.house_note.length > 500) fields.house_note = "The house note is up to 500 characters.";
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);

    await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      await ctx.client.query(
        `INSERT INTO access_cards (job_id, lockbox_code, alarm_code, garage_code, house_note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (job_id) DO UPDATE SET lockbox_code = $2, alarm_code = $3, garage_code = $4, house_note = $5`,
        [ctx.jobId, body.lockbox_code, body.alarm_code, body.garage_code, body.house_note],
      );
    });
    const { ctx, client, release } = await readJob(req, db, req.params.jobId);
    try {
      const row = await client.query<{ lockbox_code: string; alarm_code: string; garage_code: string; house_note: string }>(
        `SELECT lockbox_code, alarm_code, garage_code, house_note FROM access_cards WHERE job_id = $1`, [ctx.jobId],
      );
      res.json({
        lockbox_code: row.rows[0]!.lockbox_code,
        alarm_code: row.rows[0]!.alarm_code,
        garage_code: row.rows[0]!.garage_code,
        house_note: row.rows[0]!.house_note,
        visible_until: null,
      });
    } finally {
      release();
    }
  });

  router.get("/jobs/:jobId/access/reveals", async (req: Request, res: Response) => {
    const reveals = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      const rows = await ctx.client.query<{ name: string; role: string; revealed_at: Date }>(
        `SELECT p.name, m.role, r.revealed_at FROM access_reveals r
         JOIN job_members m ON m.id = r.member_id JOIN people p ON p.id = m.person_id
         WHERE r.job_id = $1 ORDER BY r.revealed_at DESC`,
        [ctx.jobId],
      );
      return rows.rows.map((r) => ({ name: r.name, role: r.role, revealed_at: utcIso(r.revealed_at) }));
    });
    res.json({ reveals });
  });

  return router;
}

function localString(t: { date: string; hh: number; mm: number }): string {
  return `${t.date}T${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}`;
}

async function firstOccurrenceOverlap(
  ctx: JobCtx,
  memberId: string,
  start: { date: string; hh: number; mm: number },
  end: { date: string; hh: number; mm: number },
): Promise<string | null> {
  const s = occurrenceUtc(start.date, start, ctx.timeZone);
  const e = occurrenceUtc(end.date, end, ctx.timeZone);
  if (s === null || e === null || e <= s) return null;
  return overlapDate(ctx.client, ctx.jobId, memberId, [{ startsAtUtc: s, endsAtUtc: e }], null);
}
