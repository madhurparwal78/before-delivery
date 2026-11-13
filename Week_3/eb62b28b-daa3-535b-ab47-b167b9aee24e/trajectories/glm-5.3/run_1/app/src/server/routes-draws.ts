import type { Router, Request, Response } from "express";
import type { AppContext } from "./route-context.js";
import { ApiError, sendError } from "./errors.js";
import { requireSession } from "./session.js";
import { copy, FIELD_ERRORS } from "../shared/copy.js";
import type { Person } from "./person.js";
import { memberCore, membershipFor, plusInForceOn, plusInForceToday, requireNotClosing } from "./memberships.js";
import { instantZ, formatDateIn, zoneFor, cityFor } from "../shared/time.js";
import type { TimeZoneKey } from "../shared/enums.js";
import { SLOT_TIMES, slotDayAllowed, slotTimeAllowed, changesCloseAtFor, memberDateWindow, staffDateWindow } from "../shared/slots.js";
import { checkKitCode } from "../shared/kitcode.js";
import { newId } from "./crypto.js";
import { issueVisitPage, endVisitPages, liveVisitPage, visitMemberName, refreshVisitPageStates, nextFreeSlotAfter } from "./visitpages.js";
import { DateTime } from "luxon";
import type { DrawRow } from "./visitpages.js";
import { stateName } from "../shared/states.js";
import { param, query } from "./request-utils.js";

type RunFn = (
  ctx: AppContext,
  req: Request,
  res: Response,
  roles: string[],
  handler: (req: Request, res: Response, person: Person) => Promise<void>
) => Promise<void>;

export function makeRun(): RunFn {
  return async (ctx, req, res, roles, handler) => {
    try {
      const person = await requireSession(ctx.db, req, ctx.config.timers.sessionSeconds);
      if (!roles.includes(person.role)) {
        throw new ApiError(403, "forbidden", "You can't use that.");
      }
      await handler(req, res, person);
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
      else res.end();
    }
  };
}

export function drawView(row: {
  id: string;
  member_id: string;
  phlebotomist_id: string;
  phlebotomist_name: string;
  state: string;
  starts_at: Date;
  local_date: string;
  local_time: string;
  time_zone: string;
  collected_at: Date | null;
  kit_codes: string[];
  has_results: boolean;
  member_name?: string;
}, visitPage: { state: string; ends_at: Date | null }, includeMemberName: boolean) {
  const view: Record<string, unknown> = {
    id: row.id,
    memberId: row.member_id,
    phlebotomistId: row.phlebotomist_id,
    phlebotomistName: row.phlebotomist_name,
    state: row.state,
    startsAt: instantZ(row.starts_at),
    localDate: row.local_date,
    localTime: row.local_time,
    timeZone: row.time_zone,
    collectedAt: row.collected_at ? instantZ(row.collected_at) : null,
    kitCodes: row.kit_codes,
    hasResults: row.has_results,
    changesCloseAt: instantZ(changesCloseAtFor(row.local_date, row.time_zone as TimeZoneKey)),
    visitPage: {
      state: visitPage.state,
      endsAt: visitPage.ends_at ? instantZ(visitPage.ends_at) : null,
    },
  };
  if (includeMemberName && row.member_name !== undefined) {
    view["memberName"] = row.member_name;
  }
  return view;
}

export function drawQuery(where: string, params: unknown[]): (db: AppContext["db"]) => Promise<DrawFull[]> {
  return async (db) => {
    return db.query<DrawFull>(
      `SELECT d.id, d.member_id, m.name AS member_name, d.phlebotomist_id, p.name AS phlebotomist_name,
        d.state, d.starts_at, d.local_date, d.local_time, d.time_zone, d.collected_at, d.kit_codes,
        (SELECT count(*) > 0 FROM results r WHERE r.draw_id = d.id) AS has_results
       FROM draws d
       JOIN members m ON m.id = d.member_id
       JOIN phlebotomists p ON p.id = d.phlebotomist_id
       ${where}`,
      params
    );
  };
}

export type DrawFull = {
  id: string;
  member_id: string;
  member_name: string;
  phlebotomist_id: string;
  phlebotomist_name: string;
  state: string;
  starts_at: Date;
  local_date: string;
  local_time: string;
  time_zone: string;
  collected_at: Date | null;
  kit_codes: string[];
  has_results: boolean;
};

export function registerDrawRoutes(router: Router, ctx: AppContext): void {
  const run = makeRun();

  router.get("/api/phlebotomists", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator", "specialist", "billingLead"], async (_req, res2) => {
      const rows = await ctx.db.query<{ id: string; name: string; states: string[] }>(
        `SELECT id, name, states FROM phlebotomists ORDER BY name`
      );
      res2.json({ phlebotomists: rows });
    });
  });

  router.get("/api/slots", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator"], async (req2, res2) => {
      const memberId = typeof req2.query["memberId"] === "string" ? req2.query["memberId"] : "";
      const date = typeof req2.query["date"] === "string" ? req2.query["date"] : "";
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const slots = await slotsFor(ctx, memberId, date);
      res2.json({ slots });
    });
  });

  router.get("/api/me/slots", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const date = typeof req2.query["date"] === "string" ? req2.query["date"] : "";
      const slots = await slotsFor(ctx, person.id, date);
      res2.json({ slots });
    });
  });

  router.post("/api/draws", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator"], async (req2, res2, person) => {
      const body = req2.body as Record<string, unknown>;
      const memberId = typeof body["memberId"] === "string" ? body["memberId"] : "";
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      requireNotClosing(core.account_state);
      const result = await bookOrRecordDraw(ctx, {
        memberId,
        phlebotomistId: typeof body["phlebotomistId"] === "string" ? body["phlebotomistId"] : "",
        date: typeof body["date"] === "string" ? body["date"] : "",
        time: typeof body["time"] === "string" ? body["time"] : "",
        collectedAt: typeof body["collectedAt"] === "string" ? body["collectedAt"] : null,
        kitCodes: Array.isArray(body["kitCodes"]) ? (body["kitCodes"] as unknown[]) : [],
        bookedBy: person.name,
        bookedByRole: person.role,
      });
      res2.status(result.collected ? 201 : 201).json({ draw: result.view });
    });
  });

  router.post("/api/me/draws", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const core = await memberCore(ctx.db, person.id);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      requireNotClosing(core.account_state);
      const body = req2.body as Record<string, unknown>;
      const result = await bookOrRecordDraw(ctx, {
        memberId: person.id,
        phlebotomistId: typeof body["phlebotomistId"] === "string" ? body["phlebotomistId"] : "",
        date: typeof body["date"] === "string" ? body["date"] : "",
        time: typeof body["time"] === "string" ? body["time"] : "",
        collectedAt: null,
        kitCodes: [],
        bookedBy: person.name,
        bookedByRole: "member",
      });
      res2.status(201).json({ draw: result.view });
    });
  });

  router.get("/api/draws", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator", "specialist"], async (req2, res2, person) => {
      const from = req2.query["from"];
      const to = req2.query["to"];
      const state = req2.query["state"];
      const memberId = req2.query["memberId"];
      const given = [from, to, state, memberId].filter((v) => v !== undefined).length;
      if (given > 1) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", {
          from: FIELD_ERRORS.chooseOption,
        });
      }
      let rows: DrawFull[] = [];
      if (typeof from === "string" && typeof to === "string") {
        if (person.role !== "owner" && person.role !== "coordinator") {
          throw new ApiError(403, "forbidden", "You can't use that.");
        }
        const fromDate = DateTime.fromISO(from, { zone: "America/Phoenix" });
        const toDate = DateTime.fromISO(to, { zone: "America/Phoenix" });
        if (!fromDate.isValid || !toDate.isValid) {
          throw new ApiError(422, "invalid", "Check the highlighted fields.", { from: FIELD_ERRORS.chooseOption });
        }
        if (toDate.diff(fromDate, "days").days > 7) {
          throw new ApiError(422, "invalid", "Check the highlighted fields.", { from: FIELD_ERRORS.chooseOption });
        }
        rows = await drawQuery(
          `WHERE d.starts_at::date >= $1::date AND d.starts_at::date <= $2::date ORDER BY d.starts_at ASC`,
          [from, to]
        )(ctx.db);
      } else if (typeof state === "string") {
        rows = await drawQuery(
          `WHERE d.state = $1 ORDER BY ${state === "booked" || state === "cancelled" ? "d.starts_at" : "d.collected_at"} ASC`,
          [state]
        )(ctx.db);
      } else if (typeof memberId === "string") {
        const core = await memberCore(ctx.db, memberId);
        if (!core) throw new ApiError(404, "not_found", copy("not_found"));
        rows = await drawQuery(`WHERE d.member_id = $1 ORDER BY d.starts_at DESC`, [memberId])(ctx.db);
      } else {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { from: FIELD_ERRORS.chooseOption });
      }
      const draws = [];
      for (const row of rows) {
        const page = await liveVisitPage(ctx.db, row.id);
        draws.push(drawView(row, page ?? { state: "none", ends_at: null }, true));
      }
      res2.json({ draws });
    });
  });

  router.get("/api/me/draws", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
      const rows = await drawQuery(`WHERE d.member_id = $1 ORDER BY d.starts_at ASC`, [person.id])(ctx.db);
      const draws = [];
      for (const row of rows) {
        const page = await liveVisitPage(ctx.db, row.id);
        draws.push(drawView(row, page ?? { state: "none", ends_at: null }, false));
      }
      res2.json({ draws });
    });
  });

  router.get("/api/draws/:drawId", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator", "specialist"], async (req2, res2, person) => {
      const drawId = param(req2, "drawId");
      const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      if (person.role === "member" && row.member_id !== person.id) {
        throw new ApiError(404, "not_found", copy("not_found"));
      }
      const page = await liveVisitPage(ctx.db, row.id);
      res2.json({ draw: drawView(row, page ?? { state: "none", ends_at: null }, true) });
    });
  });

  router.get("/api/me/draws/:drawId", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const drawId = param(req2, "drawId");
      const row = (await drawQuery(`WHERE d.id = $1 AND d.member_id = $2`, [drawId, person.id])(ctx.db))[0];
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      const page = await liveVisitPage(ctx.db, row.id);
      res2.json({ draw: drawView(row, page ?? { state: "none", ends_at: null }, false) });
    });
  });

  router.patch("/api/draws/:drawId", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator"], async (req2, res2) => {
      const drawId = param(req2, "drawId");
      const result = await moveDraw(ctx, drawId, req2, "staff");
      res2.json({ draw: result.view });
    });
  });

  router.patch("/api/me/draws/:drawId", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const drawId = param(req2, "drawId");
      const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
      if (!row || row.member_id !== person.id) throw new ApiError(404, "not_found", copy("not_found"));
      const result = await moveDraw(ctx, drawId, req2, "member");
      res2.json({ draw: result.view });
    });
  });

  router.post("/api/draws/:drawId/cancel", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator"], async (req2, res2) => {
      const drawId = param(req2, "drawId");
      const result = await cancelDraw(ctx, drawId, "staff");
      res2.json({ draw: result.view });
    });
  });

  router.post("/api/me/draws/:drawId/cancel", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const drawId = param(req2, "drawId");
      const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
      if (!row || row.member_id !== person.id) throw new ApiError(404, "not_found", copy("not_found"));
      const result = await cancelDraw(ctx, drawId, "member");
      res2.json({ draw: result.view });
    });
  });

  router.post("/api/draws/:drawId/visit-page", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator"], async (req2, res2) => {
      const drawId = param(req2, "drawId");
      const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      if (row.state !== "booked") throw new ApiError(409, "not_booked", copy("not_booked"));
      const localToday = DateTime.now().setZone(zoneFor(row.time_zone as TimeZoneKey)).toFormat("yyyy-MM-dd");
      if (row.local_date < localToday) {
        throw new ApiError(409, "not_upcoming", "This draw has no visit page to send.");
      }
      const phleb = await ctx.db.one<{ email: string }>(`SELECT email FROM phlebotomists WHERE id = $1`, [
        row.phlebotomist_id,
      ]);
      const member = await ctx.db.one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [row.member_id]);
      const name = visitMemberName(member?.name ?? "");
      const page = await issueVisitPage(
        ctx.db,
        row as unknown as DrawRow,
        phleb?.email ?? "",
        name.first,
        name.lastInitial,
        ctx.config.publicUrl,
        ctx.config.timers.drawPageSeconds
      );
      const copyMessage = copy("new_visit_page_sent", { phlebotomist: row.phlebotomist_name });
      res2.status(201).json({
        visitPage: { state: "live", endsAt: instantZ(page.endsAt) },
        message: copyMessage,
      });
    });
  });

  router.delete("/api/draws/:drawId/visit-page", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator"], async (req2, res2) => {
      const drawId = param(req2, "drawId");
      const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      const page = await liveVisitPage(ctx.db, row.id);
      await endVisitPages(ctx.db, row.id);
      res2.json({
        visitPage: { state: "ended", endsAt: page ? instantZ(page.ends_at) : null },
      });
    });
  });
}

async function slotsFor(
  ctx: AppContext,
  memberId: string,
  date: string
): Promise<{ phlebotomistId: string; phlebotomistName: string; localTime: string; startsAt: string; free: boolean }[]> {
  const core = await memberCore(ctx.db, memberId);
  if (!core) throw new ApiError(404, "not_found", copy("not_found"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { date: FIELD_ERRORS.dateRange400 });
  }
  const timeZone = core.time_zone as TimeZoneKey;
  const zone = zoneFor(timeZone);
  const localToday = DateTime.now().setZone(zone).toFormat("yyyy-MM-dd");
  const isToday = date === localToday;
  const isSunday = DateTime.fromISO(date).weekday === 7;
  if (!isToday && isSunday) {
    return [];
  }
  if (!isToday && !slotDayAllowed(date)) {
    return [];
  }
  const phlebotomists = await ctx.db.query<{ id: string; name: string; states: string[] }>(
    `SELECT id, name, states FROM phlebotomists WHERE $1 = ANY(states) ORDER BY name`,
    [core.state]
  );
  const times = isToday ? SLOT_TIMES : SLOT_TIMES;
  const busy = await ctx.db.query<{ phlebotomist_id: string; starts_at: Date }>(
    `SELECT phlebotomist_id, starts_at FROM draws WHERE state <> 'cancelled'`
  );
  const busySet = new Set(busy.map((b) => `${b.phlebotomist_id}|${b.starts_at.toISOString()}`));
  const slots = [];
  for (const phlebotomist of phlebotomists) {
    for (const time of times) {
      const instant = DateTime.fromISO(`${date}T${time}:00`, { zone }).toJSDate();
      slots.push({
        phlebotomistId: phlebotomist.id,
        phlebotomistName: phlebotomist.name,
        localTime: time,
        startsAt: instantZ(instant),
        free: !busySet.has(`${phlebotomist.id}|${instant.toISOString()}`),
      });
    }
  }
  slots.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return slots;
}

export type BookingInput = {
  memberId: string;
  phlebotomistId: string;
  date: string;
  time: string;
  collectedAt: string | null;
  kitCodes: unknown[];
  bookedBy: string;
  bookedByRole: string;
};

/** Book or record a draw: the one place booking validation is decided. */
export async function bookOrRecordDraw(
  ctx: AppContext,
  input: BookingInput
): Promise<{ collected: boolean; view: Record<string, unknown> }> {
  const core = await memberCore(ctx.db, input.memberId);
  if (!core) throw new ApiError(404, "not_found", copy("not_found"));
  const fields: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    fields["date"] = FIELD_ERRORS.dateOfBirthFormat;
  }
  if (input.collectedAt !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.collectedAt)) {
    fields["collectedAt"] = FIELD_ERRORS.collectedAt;
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
  }
  const phlebotomist = await ctx.db.one<{ id: string; name: string; states: string[] }>(
    `SELECT id, name, states FROM phlebotomists WHERE id = $1`,
    [input.phlebotomistId]
  );
  if (!phlebotomist) {
    throw new ApiError(404, "not_found", copy("not_found"));
  }
  if (!phlebotomist.states.includes(core.state)) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", {
      phlebotomistId: FIELD_ERRORS.phlebotomistState.replace("<State name>", stateName(core.state)),
    });
  }
  const timeZone = core.time_zone as TimeZoneKey;
  const zone = zoneFor(timeZone);
  const localToday = DateTime.now().setZone(zone).toFormat("yyyy-MM-dd");
  const isPast = input.date < localToday;
  const isToday = input.date === localToday;

  if (input.bookedByRole === "member") {
    const window = memberDateWindow(localToday);
    if (input.date < window.min || input.date > window.max) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", { date: FIELD_ERRORS.dateRange28 });
    }
  } else {
    const window = staffDateWindow(DateTime.now().setZone("America/Phoenix").toFormat("yyyy-MM-dd"));
    if (input.date < window.min || input.date > window.max) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", { date: FIELD_ERRORS.dateRange400 });
    }
  }

  const membership = await membershipFor(ctx.db, input.memberId);
  if (!membership) throw new ApiError(404, "not_found", copy("not_found"));
  if (isPast) {
    if (!plusInForceToday(membership)) {
      throw new ApiError(409, "plus_required", copy("plus_required"));
    }
  } else {
    const phoenixDate = DateTime.fromISO(input.date, { zone }).setZone("America/Phoenix").toFormat("yyyy-MM-dd");
    if (!plusInForceOn(membership, phoenixDate)) {
      throw new ApiError(409, "plus_required", copy("plus_required"));
    }
  }

  if (!core.address_line1 || !core.city || !core.postal_code) {
    throw new ApiError(409, "address_required", copy("address_required"));
  }

  const sameDayException = input.bookedByRole !== "member" && isToday;
  if (!sameDayException && !slotDayAllowed(input.date)) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { time: FIELD_ERRORS.slotTimes });
  }
  if (!slotTimeAllowed(input.time)) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { time: FIELD_ERRORS.slotTimes });
  }

  const startsAt = DateTime.fromISO(`${input.date}T${input.time}:00`, { zone }).toJSDate();

  const kitCodes: string[] = [];
  for (const raw of input.kitCodes) {
    if (typeof raw !== "string") {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", { kitCodes: FIELD_ERRORS.kitCode });
    }
    const kit = checkKitCode(raw);
    if (!kit.valid) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", {
        kitCodes: kit.reason === "shape" ? FIELD_ERRORS.kitCode : copy("kit_code_wrong_check"),
      });
    }
    if (!kitCodes.includes(kit.normalized)) kitCodes.push(kit.normalized);
  }

  let collectedAt: Date | null = null;
  if (isPast) {
    if (!input.collectedAt) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", { collectedAt: FIELD_ERRORS.collectedAt });
    }
    collectedAt = new Date(input.collectedAt);
    const collectedMemberDate = DateTime.fromJSDate(collectedAt, { zone }).toFormat("yyyy-MM-dd");
    if (collectedMemberDate !== input.date) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", { collectedAt: FIELD_ERRORS.collectedAt });
    }
    if (kitCodes.length === 0) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", {
        kitCodes: copy("kit_code_required"),
      });
    }
  } else if (input.collectedAt !== null) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { collectedAt: FIELD_ERRORS.collectedAt });
  }

  const drawId = newId("draw");
  const inserted = await ctx.db.withTransaction(async (client) => {
    if (!isPast) {
      const result = await client.query(
        `INSERT INTO draws (id, member_id, phlebotomist_id, state, starts_at, local_date, local_time, time_zone, created_by)
         SELECT $1, $2, $3, 'booked', $4, $5, $6, $7, $8
         WHERE NOT EXISTS (
           SELECT 1 FROM draws
           WHERE phlebotomist_id = $3 AND starts_at = $4 AND state <> 'cancelled'
         )
         RETURNING id`,
        [drawId, input.memberId, input.phlebotomistId, startsAt, input.date, input.time, core.time_zone, input.bookedBy]
      );
      if (result.rowCount === 0) {
        return null;
      }
    } else {
      const result = await client.query(
        `INSERT INTO draws (id, member_id, phlebotomist_id, state, starts_at, local_date, local_time, time_zone,
          collected_at, kit_codes, created_by)
         SELECT $1, $2, $3, 'collected', $4, $5, $6, $7, $8, $9, $10
         WHERE NOT EXISTS (
           SELECT 1 FROM draws
           WHERE phlebotomist_id = $3 AND starts_at = $4 AND state <> 'cancelled'
         )
         RETURNING id`,
        [
          drawId,
          input.memberId,
          input.phlebotomistId,
          startsAt,
          input.date,
          input.time,
          core.time_zone,
          collectedAt,
          kitCodes,
          input.bookedBy,
        ]
      );
      if (result.rowCount === 0) {
        return null;
      }
    }
    return drawId;
  });

  if (!inserted) {
    const busy = await ctx.db.query<{ phlebotomist_id: string; starts_at: Date }>(
      `SELECT phlebotomist_id, starts_at FROM draws WHERE state <> 'cancelled'`
    );
    const busySet = new Set(busy.map((b) => `${b.phlebotomist_id}|${b.starts_at.toISOString()}`));
    const next = nextFreeSlotAfter(input.phlebotomistId, startsAt, busySet, timeZone);
    const winner = input.bookedByRole === "member" ? "a member" : input.bookedBy;
    const message =
      input.bookedByRole === "member"
        ? copy("slot_lost_member", {
            date: next ? formatDateIn(next.instant, zone) : "",
            localTime: next?.time ?? "",
            city: cityFor(timeZone),
          })
        : copy("slot_lost_staff", {
            winner,
            date: next ? formatDateIn(next.instant, zone) : "",
            localTime: next?.time ?? "",
            city: cityFor(timeZone),
          });
    throw new ApiError(409, "slot_taken", message);
  }

  if (!isPast) {
    const phleb = await ctx.db.one<{ email: string }>(`SELECT email FROM phlebotomists WHERE id = $1`, [
      input.phlebotomistId,
    ]);
    const name = visitMemberName(core.name);
    await issueVisitPage(
      ctx.db,
      {
        id: drawId,
        member_id: input.memberId,
        phlebotomist_id: input.phlebotomistId,
        state: "booked",
        starts_at: startsAt,
        local_date: input.date,
        local_time: input.time,
        time_zone: core.time_zone,
        collected_at: null,
        kit_codes: [],
      },
      phleb?.email ?? "",
      name.first,
      name.lastInitial,
      ctx.config.publicUrl,
      ctx.config.timers.drawPageSeconds
    );
  }

  const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
  if (!row) throw new ApiError(500, "internal_error", "Something went wrong.");
  const page = await liveVisitPage(ctx.db, drawId);
  const fallbackPage = { state: isPast ? "none" : "live", ends_at: null as Date | null };
  return {
    collected: isPast,
    view: drawView(row, page ?? fallbackPage, true),
  };
}

async function moveDraw(ctx: AppContext, drawId: string, req: Request, who: "staff" | "member") {
  const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
  if (!row) throw new ApiError(404, "not_found", copy("not_found"));
  if (row.state !== "booked") {
    throw new ApiError(409, "not_booked", copy("not_booked"));
  }
  const body = req.body as Record<string, unknown>;
  const date = typeof body["date"] === "string" ? body["date"] : "";
  const time = typeof body["time"] === "string" ? body["time"] : "";
  const timeZone = row.time_zone as TimeZoneKey;
  const zone = zoneFor(timeZone);
  const localToday = DateTime.now().setZone(zone).toFormat("yyyy-MM-dd");
  if (who === "member") {
    const cutoff = changesCloseAtFor(row.local_date, timeZone);
    if (Date.now() >= cutoff.getTime()) {
      throw new ApiError(409, "changes_closed", copy("changes_closed", {
        date: formatDateIn(cutoff, zone),
        city: cityFor(timeZone),
      }));
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { date: FIELD_ERRORS.dateOfBirthFormat });
  }
  if (who === "member") {
    const window = memberDateWindow(localToday);
    if (date < window.min || date > window.max) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", { date: FIELD_ERRORS.dateRange28 });
    }
  } else {
    const window = staffDateWindow(DateTime.now().setZone("America/Phoenix").toFormat("yyyy-MM-dd"));
    if (date < window.min || date > window.max) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", { date: FIELD_ERRORS.dateRange400 });
    }
  }
  const sameDayException = who === "staff" && date === localToday;
  if (!sameDayException && !slotDayAllowed(date)) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { time: FIELD_ERRORS.slotTimes });
  }
  if (!slotTimeAllowed(time)) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { time: FIELD_ERRORS.slotTimes });
  }
  const startsAt = DateTime.fromISO(`${date}T${time}:00`, { zone }).toJSDate();
  if (startsAt.toISOString() !== row.starts_at.toISOString()) {
    const busy = await ctx.db.query<{ phlebotomist_id: string; starts_at: Date }>(
      `SELECT phlebotomist_id, starts_at FROM draws WHERE state <> 'cancelled' AND id <> $1`,
      [drawId]
    );
    const conflict = busy.find(
      (b) => b.phlebotomist_id === row.phlebotomist_id && b.starts_at.toISOString() === startsAt.toISOString()
    );
    if (conflict) {
      const busySet = new Set(busy.map((b) => `${b.phlebotomist_id}|${b.starts_at.toISOString()}`));
      const next = nextFreeSlotAfter(row.phlebotomist_id, startsAt, busySet, timeZone);
      throw new ApiError(409, "slot_taken", copy("slot_lost_member", {
        date: next ? formatDateIn(next.instant, zone) : "",
        localTime: next?.time ?? "",
        city: cityFor(timeZone),
      }));
    }
  }
  await ctx.db.exec(`UPDATE draws SET starts_at = $2, local_date = $3, local_time = $4 WHERE id = $1`, [
    drawId,
    startsAt,
    date,
    time,
  ]);
  if (!isPastDate(date, timeZone)) {
    const phleb = await ctx.db.one<{ email: string }>(`SELECT email FROM phlebotomists WHERE id = $1`, [
      row.phlebotomist_id,
    ]);
    const member = await ctx.db.one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [row.member_id]);
    const name = visitMemberName(member?.name ?? "");
    const fresh = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
    await issueVisitPage(
      ctx.db,
      fresh as unknown as DrawRow,
      phleb?.email ?? "",
      name.first,
      name.lastInitial,
      ctx.config.publicUrl,
      ctx.config.timers.drawPageSeconds
    );
  } else {
    await endVisitPages(ctx.db, drawId);
  }
  const updated = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
  if (!updated) throw new ApiError(500, "internal_error", "Something went wrong.");
  const page = await liveVisitPage(ctx.db, drawId);
  return { view: drawView(updated, page ?? { state: "none", ends_at: null }, true) };
}

function isPastDate(date: string, timeZone: TimeZoneKey): boolean {
  const localToday = DateTime.now().setZone(zoneFor(timeZone)).toFormat("yyyy-MM-dd");
  return date < localToday;
}

async function cancelDraw(ctx: AppContext, drawId: string, who: "staff" | "member") {
  const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
  if (!row) throw new ApiError(404, "not_found", copy("not_found"));
  if (row.state !== "booked") {
    throw new ApiError(409, "not_booked", copy("not_booked"));
  }
  if (who === "member") {
    const timeZone = row.time_zone as TimeZoneKey;
    const cutoff = changesCloseAtFor(row.local_date, timeZone);
    if (Date.now() >= cutoff.getTime()) {
      throw new ApiError(409, "changes_closed", copy("changes_closed", {
        date: formatDateIn(cutoff, zoneFor(timeZone)),
        city: cityFor(timeZone),
      }));
    }
  }
  await ctx.db.exec(`UPDATE draws SET state = 'cancelled' WHERE id = $1`, [drawId]);
  await endVisitPages(ctx.db, drawId);
  const updated = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
  if (!updated) throw new ApiError(500, "internal_error", "Something went wrong.");
  const page = await liveVisitPage(ctx.db, drawId);
  return { view: drawView(updated, page ?? { state: "none", ends_at: null }, true) };
}

export { refreshVisitPageStates };
