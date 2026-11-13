import { CHAPTERS, DEFAULTS, FINISHES, HUBS, MODELS, isFinish, isHub, isModel, type FinishId, type HubId, type ModelId } from "../shared/catalogue.js";
import { isDate, isoIst, parseInstant } from "../shared/clock.js";
import { clearedCookie, endSession, openSession, register, serializeUser, sessionCookie, signIn } from "./auth.js";
import { now as appClock, setClock } from "./core.js";
import { q } from "./db.js";
import { runDue } from "./due.js";
import { fail } from "./errors.js";
import { daySheet, finishCount, heldUnits, startCount, stockBody } from "./host.js";
import { jsonObject, type Route } from "./http.js";
import { claimLock, deliveryDaysFor, hostConfirm, hostDelivered, hostRefuse, hostWithdraw, joinLine, leaveLine, makeSheet, ownLock, releaseLock, setDelivery, sheetBytes, turnOnReminders } from "./locks.js";
import { noticeById, noticesOf, serializeNotice } from "./notices.js";
import { bookRide, cancelRide, hostMark, moveRide, ownRide } from "./rides.js";
import { resetData } from "./schema.js";
import { buildLedger } from "./sweep.js";
import { openStream } from "./streams.js";
import { LOCK_SELECT, readingFor, rideDaysReply, serializeLock, serializeRide, slotsReply, type LockRow, type RideRow } from "./views.js";

const ok = (json: unknown, status = 200, headers?: Record<string, string | string[]>) => ({ status, json, headers });

function selection(query: URLSearchParams): { hub: HubId; model: ModelId; finish: FinishId } {
  const hub = query.get("hub") ?? DEFAULTS.hub;
  const model = query.get("model") ?? DEFAULTS.model;
  const finish = query.get("finish") ?? DEFAULTS.finish;
  if (!isHub(hub) || !isModel(model) || !isFinish(finish)) throw fail("invalid_body");
  return { hub, model, finish };
}

const hubParam = (id: string): HubId => {
  if (!isHub(id)) throw fail("not_found");
  return id;
};

export const routes: Route[] = [
  { method: "GET", path: "/api/health", access: "public", offline: true, handler: async () => ok({ status: "ok" }) },
  {
    method: "GET",
    path: "/api/catalogue",
    access: "public",
    offline: true,
    handler: async () =>
      ok({
        models: MODELS.map((m) => ({ id: m.id, name: m.name, cc: m.cc })),
        finishes: FINISHES.map((f) => ({ id: f.id, name: f.name })),
        hubs: HUBS.map((h) => ({ id: h.id, name: h.name })),
        chapters: CHAPTERS.map((c) => ({ id: c.id, name: c.name, parts: c.parts.map((p) => ({ id: p.id, name: p.name })) })),
      }),
  },
  {
    method: "GET",
    path: "/api/live/now",
    access: "public",
    handler: async (ctx) => {
      const s = selection(ctx.query);
      return ok(await readingFor(s.hub, s.model, s.finish, ctx.caller.user?.role === "rider" ? ctx.caller.user.id : null, ctx.now));
    },
  },
  {
    method: "GET",
    path: "/api/live",
    access: "public",
    handler: async (ctx) => {
      openStream(ctx.req, ctx.res, selection(ctx.query), ctx.caller);
      return { status: 200 };
    },
  },
  {
    method: "GET",
    path: "/api/hubs/:hub/slots",
    access: "public",
    handler: async (ctx) => {
      const hub = hubParam(ctx.params.hub as string);
      const date = ctx.query.get("date");
      if (!isDate(date)) throw fail("invalid_body");
      return ok(await slotsReply(hub, date, ctx.now));
    },
  },
  { method: "GET", path: "/api/hubs/:hub/ride-days", access: "public", handler: async (ctx) => ok(rideDaysReply(hubParam(ctx.params.hub as string), ctx.now)) },

  // --- accounts
  {
    method: "POST",
    path: "/api/auth/register",
    access: "public",
    handler: async (ctx) => {
      const user = await register(ctx.body);
      return ok({ user: serializeUser(user) }, 201, { "Set-Cookie": sessionCookie(await openSession(user.id)) });
    },
  },
  {
    method: "POST",
    path: "/api/auth/signin",
    access: "public",
    handler: async (ctx) => {
      const user = await signIn(ctx.body);
      return ok({ user: serializeUser(user) }, 200, { "Set-Cookie": sessionCookie(await openSession(user.id)) });
    },
  },
  {
    method: "POST",
    path: "/api/auth/signout",
    access: "signed",
    handler: async (ctx) => {
      await endSession(ctx.caller.sessionId as string);
      return { status: 204, headers: { "Set-Cookie": clearedCookie } };
    },
  },
  { method: "GET", path: "/api/me", access: "signed", handler: async (ctx) => ok({ user: serializeUser(ctx.user) }) },

  // --- rider: locks
  {
    method: "GET",
    path: "/api/locks",
    access: "rider",
    handler: async (ctx) => {
      const rows = await q<LockRow>(`${LOCK_SELECT} WHERE l.rider_id=$1 ORDER BY l.issued_ms DESC, l.n DESC`, [ctx.user.id]);
      return ok({ locks: rows.map((r) => serializeLock(r, ctx.now)) });
    },
  },
  {
    method: "POST",
    path: "/api/locks",
    access: "rider",
    handler: async (ctx) => {
      const { status, lock } = await claimLock(ctx.user, ctx.body);
      return ok({ lock }, status);
    },
  },
  { method: "GET", path: "/api/locks/:id", access: "rider", handler: async (ctx) => ok({ lock: serializeLock(await ownLock(ctx.user, ctx.params.id as string), ctx.now) }) },
  { method: "POST", path: "/api/locks/:id/release", access: "rider", handler: async (ctx) => ok({ lock: await releaseLock(ctx.user, ctx.params.id as string) }) },
  {
    method: "POST",
    path: "/api/locks/:id/sheet",
    access: "rider",
    handler: async (ctx) => {
      const { status, lock } = await makeSheet(ctx.user, ctx.params.id as string);
      return ok({ lock }, status);
    },
  },
  {
    method: "GET",
    path: "/api/locks/:id/sheet",
    access: "rider",
    handler: async (ctx) => {
      const id = ctx.params.id as string;
      return { status: 200, bytes: await sheetBytes(ctx.user, id), type: "application/pdf", headers: { "Content-Disposition": `attachment; filename="malhar-price-sheet-${id}.pdf"` } };
    },
  },
  { method: "GET", path: "/api/locks/:id/delivery-days", access: "rider", handler: async (ctx) => ok(await deliveryDaysFor(await ownLock(ctx.user, ctx.params.id as string), ctx.now)) },
  { method: "POST", path: "/api/locks/:id/delivery", access: "rider", handler: async (ctx) => ok({ lock: await setDelivery(ctx.user, ctx.params.id as string, ctx.body) }) },
  {
    method: "POST",
    path: "/api/locks/:id/delivery/wait",
    access: "rider",
    handler: async (ctx) => {
      const { status, lock } = await joinLine(ctx.user, ctx.params.id as string, ctx.body);
      return ok({ lock }, status);
    },
  },
  { method: "POST", path: "/api/locks/:id/delivery/wait/leave", access: "rider", handler: async (ctx) => ok({ lock: await leaveLine(ctx.user, ctx.params.id as string) }) },

  // --- rider: rides
  {
    method: "GET",
    path: "/api/rides",
    access: "rider",
    handler: async (ctx) => {
      const rows = await q<RideRow>("SELECT * FROM rides WHERE rider_id=$1 ORDER BY starts_ms, n", [ctx.user.id]);
      return ok({ rides: rows.map((r) => serializeRide(r, ctx.now)) });
    },
  },
  {
    method: "POST",
    path: "/api/rides",
    access: "rider",
    handler: async (ctx) => {
      const { status, ride } = await bookRide(ctx.user, ctx.body);
      return ok({ ride }, status);
    },
  },
  { method: "GET", path: "/api/rides/:id", access: "rider", handler: async (ctx) => ok({ ride: serializeRide(await ownRide(ctx.user, ctx.params.id as string), ctx.now) }) },
  { method: "POST", path: "/api/rides/:id/move", access: "rider", handler: async (ctx) => ok({ ride: await moveRide(ctx.user, ctx.params.id as string, ctx.body) }) },
  { method: "POST", path: "/api/rides/:id/cancel", access: "rider", handler: async (ctx) => ok({ ride: await cancelRide(ctx.user, ctx.params.id as string) }) },

  // --- rider: reminders and notices
  { method: "POST", path: "/api/reminders", access: "rider", handler: async (ctx) => ok(await turnOnReminders(ctx.user)) },
  { method: "GET", path: "/api/notices", access: "rider", handler: async (ctx) => ok({ notices: (await noticesOf(ctx.user.id)).map(serializeNotice) }) },
  {
    method: "GET",
    path: "/api/notices/:id",
    access: "rider",
    handler: async (ctx) => {
      const notice = await noticeById(ctx.params.id as string, ctx.user.id);
      if (!notice) throw fail("not_found");
      return ok({ notice: serializeNotice(notice) });
    },
  },

  // --- hub host
  { method: "GET", path: "/api/hub/day-sheet", access: "host", handler: async (ctx) => ok(await daySheet(ctx.user, ctx.query.get("date"), ctx.now)) },
  { method: "POST", path: "/api/hub/rides/:id/mark", access: "host", handler: async (ctx) => ok({ ride: await hostMark(ctx.user, ctx.params.id as string, ctx.body) }) },
  { method: "POST", path: "/api/hub/locks/:id/delivered", access: "host", handler: async (ctx) => ok({ lock: await hostDelivered(ctx.user, ctx.params.id as string) }) },
  { method: "GET", path: "/api/hub/held-units", access: "host", handler: async (ctx) => ok(await heldUnits(ctx.user)) },
  { method: "POST", path: "/api/hub/locks/:id/confirm", access: "host", handler: async (ctx) => ok({ lock: await hostConfirm(ctx.user, ctx.params.id as string) }) },
  { method: "POST", path: "/api/hub/locks/:id/refuse", access: "host", handler: async (ctx) => ok({ lock: await hostRefuse(ctx.user, ctx.params.id as string) }) },
  { method: "POST", path: "/api/hub/locks/:id/withdraw", access: "host", handler: async (ctx) => ok({ lock: await hostWithdraw(ctx.user, ctx.params.id as string) }) },
  { method: "GET", path: "/api/hub/stock", access: "host", handler: async (ctx) => ok(await stockBody(ctx.user.hub as HubId, ctx.now)) },
  {
    method: "POST",
    path: "/api/hub/stock-count/start",
    access: "host",
    handler: async (ctx) => {
      await startCount(ctx.user);
      return ok(await stockBody(ctx.user.hub as HubId, await appClock()));
    },
  },
  {
    method: "POST",
    path: "/api/hub/stock-count/finish",
    access: "host",
    handler: async (ctx) => {
      await finishCount(ctx.user, ctx.body);
      return ok(await stockBody(ctx.user.hub as HubId, await appClock()));
    },
  },

  // --- test surface (APP_TEST_CLOCK=1 only)
  {
    method: "POST",
    path: "/api/test/clock",
    access: "public",
    handler: async (ctx) => {
      const b = jsonObject(ctx.body) ?? {};
      const at = typeof b.at === "string" ? parseInstant(b.at) : null;
      if (at === null || (b.freeze !== undefined && typeof b.freeze !== "boolean")) throw fail("invalid_body");
      await setClock(at, b.freeze === true);
      await Promise.race([runDue(await appClock(), true), new Promise((resolve) => setTimeout(resolve, 3500))]);
      return ok({ now: isoIst(await appClock()) });
    },
  },
  {
    method: "POST",
    path: "/api/test/reset",
    access: "public",
    handler: async () => {
      await resetData();
      await buildLedger(true);
      return ok({ now: isoIst(await appClock()) });
    },
  },
];

