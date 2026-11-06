import { Pool } from "pg";
import { Config } from "./config";
import { Router, sendJson, sendEmpty, readString, requireUser, requireStaff } from "./http";
import { ApiError, validation, FIELD_COPY } from "./errors";
import { createSession, deleteSession, findUserByEmail, verifyPassword, cookieHeader, clearCookieHeader, SESSION_COOKIE, parseCookie } from "./sessions";
import { readLibrary, readLateFeeSchedule } from "./domain/library";
import { activeSpansForItem, countFreeForRange } from "./domain/spans";
import { itemView } from "./domain/views";
import { localDate } from "./time";
import { KillBillClient } from "./killbill";
import { PhotoStore } from "./photos";
import { holdRoutes } from "./routes/holds";
import { loanRoutes } from "./routes/loans";

export interface AppServices {
  pool: Pool;
  config: Config;
  killbill: KillBillClient;
  photos: PhotoStore;
}

export function buildRouter(services: AppServices): Router {
  const router = new Router();
  const { pool, config } = services;

  router.add("GET", "/api/health", (ctx) => {
    sendJson(ctx, 200, { status: "ok" });
  });

  router.add("POST", "/api/session", async (ctx) => {
    const body = (await ctx.json()) as Record<string, unknown>;
    const email = readString(body.email);
    const password = readString(body.password);
    const fields: Record<string, string> = {};
    if (email === null || email.length === 0) fields.email = FIELD_COPY.email;
    if (password === null || password.length === 0) fields.password = FIELD_COPY.password;
    if (Object.keys(fields).length > 0) throw validation(fields);
    const client = await pool.connect();
    try {
      const user = await findUserByEmail(client, email as string);
      if (user === null || !verifyPassword(password as string, user.salt, user.hash)) {
        throw new ApiError(401, "bad_credentials");
      }
      const session = await createSession(pool, user.id);
      ctx.res.setHeader("Set-Cookie", cookieHeader(session.cookieValue, 30 * 86400));
      sendJson(ctx, 200, { user: { id: user.id, name: user.name, role: user.role } });
    } finally {
      client.release();
    }
  });

  router.add("GET", "/api/session", (ctx) => {
    const user = requireUser(ctx);
    sendJson(ctx, 200, { user: { id: user.id, name: user.name, role: user.role } });
  });

  router.add("DELETE", "/api/session", async (ctx) => {
    requireUser(ctx);
    const cookie = parseCookie(ctx.req.headers.cookie, SESSION_COOKIE);
    await deleteSession(pool, cookie);
    ctx.res.setHeader("Set-Cookie", clearCookieHeader());
    sendEmpty(ctx, 204);
  });

  router.add("GET", "/api/library", async (ctx) => {
    requireUser(ctx);
    const library = await readLibrary(pool);
    const schedule = await readLateFeeSchedule(pool);
    const today = localDate(new Date(), library.time_zone);
    let rateToday = schedule[0];
    for (const entry of schedule) {
      if (entry.effective_from <= today) rateToday = entry;
    }
    sendJson(ctx, 200, {
      name: library.name,
      time_zone: library.time_zone,
      open_days: library.open_days,
      closed_dates: [...library.closed_dates].sort(),
      opening_time: library.opening_time,
      closing_time: library.closing_time,
      late_fee_schedule: schedule.map((entry) => ({ effective_from: entry.effective_from, cents_per_day: entry.cents_per_day })),
      late_fee_cents_per_day: rateToday.cents_per_day,
      max_active_per_member: library.max_active_per_member,
      pickup_window_seconds: config.pickupWindowSeconds,
    });
  });

  router.add("GET", "/api/items", async (ctx) => {
    requireUser(ctx);
    const items = await catalogueViews(pool);
    sendJson(ctx, 200, { items });
  });

  router.add("GET", "/api/items/:itemId", async (ctx) => {
    requireUser(ctx);
    const item = await itemViewById(pool, ctx.params.itemId);
    if (item === null) throw new ApiError(404, "not_found");
    sendJson(ctx, 200, { item });
  });

  router.add("GET", "/api/members", async (ctx) => {
    requireStaff(ctx);
    const result = await pool.query("SELECT id, name FROM users WHERE role = 'member' ORDER BY name ASC");
    sendJson(ctx, 200, { members: result.rows });
  });

  holdRoutes(router, services);
  loanRoutes(router, services);
  return router;
}

export async function catalogueViews(pool: Pool): Promise<unknown[]> {
  const library = await readLibrary(pool);
  const today = localDate(new Date(), library.time_zone);
  const items = (
    await pool.query("SELECT id, name, category, deposit_cents, replacement_cents FROM items ORDER BY sort_index ASC")
  ).rows;
  const units = (await pool.query("SELECT id, item_id, label, lane_index FROM units")).rows as {
    id: string;
    item_item: string;
    item_id: string;
    label: string;
    lane_index: number;
  }[];
  const client = await pool.connect();
  try {
    const views = [];
    for (const item of items) {
      const spans = await activeSpansForItem(client, item.id);
      const itemUnits = units.filter((unit) => unit.item_id === item.id);
      views.push(itemView(item, itemUnits.length, countFreeForRange(itemUnits, spans, today, today)));
    }
    return views;
  } finally {
    client.release();
  }
}

export async function itemViewById(pool: Pool, itemId: string): Promise<unknown | null> {
  const library = await readLibrary(pool);
  const today = localDate(new Date(), library.time_zone);
  const itemResult = await pool.query(
    "SELECT id, name, category, deposit_cents, replacement_cents FROM items WHERE id = $1",
    [itemId],
  );
  if (itemResult.rowCount === 0) return null;
  const units = (
    await pool.query("SELECT id, item_id, label, lane_index FROM units WHERE item_id = $1 ORDER BY lane_index ASC", [
      itemId,
    ])
  ).rows as { id: string; label: string; lane_index: number }[];
  const client = await pool.connect();
  try {
    const spans = await activeSpansForItem(client, itemId);
    return itemView(itemResult.rows[0], units.length, countFreeForRange(units, spans, today, today));
  } finally {
    client.release();
  }
}
