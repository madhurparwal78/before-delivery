// The HTTP server: the one origin for the app and its API, with the error
// precedence, body limits and session rules the brief sets.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { loadConfig, type AppConfig } from "./config.ts";
import { SCHEMA_SQL } from "./schema.ts";
import { seedIfEmpty, verifyPassword } from "./seed.ts";
import { Store, type Role, type UserRow, type WindowRow, type OrderRow, type CardRow } from "./store.ts";
import {
  ApiError, errBadCredentials, errDatabaseUnavailable, errForbidden, errNotFound, errNotSignedIn,
  errTooLarge, errUnsupportedType, fieldErrors,
} from "./errors.ts";
import { placeOrder, scheduleOrder, closeOrder, reopenOrder, publishRestriction, rationWindow, NoticeAndError, queueNoticeAfterRefusal } from "./actions.ts";
import { commitStroke, removeHolder, confirmStroke, writeStrokeRecord } from "./cards.ts";
import { readCapacity, saveCapacity, restoreRevision, createWindow } from "./capacity.ts";
import { buildPackDocument, submitPack, validatePeriod, validateSignatory, packSha256, toPackRow, REGULATOR_EMAIL, type PackRow } from "./packs.ts";
import { eraseContractor } from "./erase.ts";
import { s3EnsureBucket, s3Put, s3Get, s3Delete } from "./s3.ts";
import { smtpSend } from "./smtp.ts";
import { isOrderable, STATUS_LABEL, windowStatus, turnoutMaxMl, rateMlDay, remainingMl as computeRemaining } from "../shared/domain.ts";
import { formatInstant, parseInstant, districtDate, parseDistrictDate } from "../shared/district-time.ts";
import { decAdd, decCmp, decParse, decStr3 } from "../shared/decimal.ts";

export type Ctx = {
  cfg: AppConfig;
  store: Store;
  pool: pg.Pool;
  dbReady: boolean;
};

const BODY_LIMIT = 16384;
const PACK_BODY_LIMIT = 2000000;
const SESSION_COOKIE = "ditchbook_session";

type Handler = (
  ctx: Ctx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  user: UserRow | null,
  url: URL,
  body: unknown,
  params: Record<string, string>,
) => Promise<void>;

const routes: Route[] = [];
export { routes };

function route(method: string, path: string, roles: Role[] | "any" | "signed-in", handler: Handler): void {
  // path like /api/orders/<number>/cancel
  const names: string[] = [];
  const replaced = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/<([^>]+)>/g, (_m, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${replaced}$`), roles, handler, names });
}

type Route = {
  method: string;
  pattern: RegExp;
  names: string[];
  roles: Role[] | "any" | "signed-in";
  handler: Handler;
};

// ---------------------------------------------------------------------------
// JSON serialization of records (the API record shapes)

function windowJson(w: WindowRow, now: number): Record<string, unknown> {
  return {
    id: w.id,
    channel_id: w.channel_id,
    channel_name: w.channel_name,
    label: w.label,
    opens_at: formatInstant(w.opens_at),
    closes_at: formatInstant(w.closes_at),
    hours: w.hours,
    status: windowStatus(w.opens_at, w.closes_at, now),
    orderable: isOrderable(w.opens_at, w.closes_at, now),
    table_cap_ml_day: w.table_cap_ml_day,
    restriction_cap_ml_day: w.restriction_cap_ml_day,
    restriction_effective_at: w.restriction_effective_at ? formatInstant(w.restriction_effective_at) : null,
    effective_cap_ml_day: w.effective_cap_ml_day,
    cap_volume_ml: w.cap_volume_ml,
    committed_ml: w.committed_ml,
    remaining_ml: w.remaining_ml,
    delivered_ml: w.delivered_ml,
    channel_flow_ml_day: w.channel_flow_ml_day,
    rostered_operator: w.rostered_operator,
  };
}

function orderJson(o: OrderRow): Record<string, unknown> {
  return {
    number: o.number,
    grower_id: o.grower_id,
    turnout: o.turnout,
    window_id: o.window_id,
    requested_ml: o.requested_ml,
    volume_ml: o.volume_ml,
    rate_ml_day: o.rate_ml_day,
    status: o.status,
    holder_code: o.holder_code,
    standby_code: o.standby_code,
    conflict: o.conflict,
    rationed: o.rationed,
    closed_after_flow: o.closed_after_flow,
    scheduled_at: o.scheduled_at ? formatInstant(o.scheduled_at) : null,
  };
}

function cardJson(c: CardRow, windowStatusOf: (windowId: string) => string): Record<string, unknown> {
  return {
    id: c.id,
    order_number: c.order_number,
    turnout: c.turnout,
    channel_id: c.channel_id,
    window_id: c.window_id,
    window_status: windowStatusOf(c.window_id),
    kind: c.kind,
    state: c.state,
    holder_code: c.holder_code,
    from_ml_day: c.from_ml_day,
    to_ml_day: c.to_ml_day,
    stroke: c.stroke,
  };
}

function allocationJson(a: { allocation_ml: string; debited_ml: string; remaining_ml: string }): Record<string, unknown> {
  return { allocation_ml: a.allocation_ml, debited_ml: a.debited_ml, remaining_ml: a.remaining_ml };
}

// ---------------------------------------------------------------------------
// Roles

const GROWER: Role = "grower";
const OPERATOR: Role = "operator";
const DISPATCHER: Role = "dispatcher";
const CLERK: Role = "clerk";
const REVIEWER: Role = "reviewer";

// A helper: read the window (with lapse judged first).
async function windowWithLapse(ctx: Ctx, id: string): Promise<WindowRow | null> {
  const now = Date.now();
  await ctx.store.transaction(async (client) => {
    await ctx.store.lapseWindowIfNeeded(client, id, now);
  });
  return ctx.store.windowById(id);
}

// --- session -----------------------------------------------------------------

route("POST", "/api/session", "any", async (ctx, req, res, user, url, body) => {
  void user; void url; void req;
  const b = body as { email?: unknown; password?: unknown };
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const person = await ctx.store.userByEmail(email);
  if (!person || person.erased) throw errBadCredentials();
  const hashRow = await ctx.store.query<{ password_hash: string }>("SELECT password_hash FROM people WHERE id = $1", [person.id]);
  if (!hashRow.rows[0] || !verifyPassword(password, hashRow.rows[0].password_hash)) throw errBadCredentials();
  const token = await ctx.store.createSession(person.id);
  setSessionCookie(res, token);
  sendJson(res, 200, { user: userJson(person) });
});

route("DELETE", "/api/session", "signed-in", async (ctx, req, res, user) => {
  void req;
  const token = getSessionCookie(req);
  if (token) await ctx.store.deleteSession(token);
  clearSessionCookie(res);
  res.writeHead(204);
  res.end();
});

route("GET", "/api/me", "signed-in", async (ctx, req, res, user) => {
  void ctx; void req;
  sendJson(res, 200, { user: userJson(user!) });
});

route("GET", "/api/me/allocation", [GROWER], async (ctx, req, res, user) => {
  void req;
  const a = await ctx.store.allocationOf(user!.id);
  if (!a) throw errNotFound();
  sendJson(res, 200, allocationJson(a));
});

// --- channels and windows -----------------------------------------------------

route("GET", "/api/channels", "signed-in", async (ctx, req, res) => {
  void req;
  sendJson(res, 200, { channels: await ctx.store.channelList() });
});

route("GET", "/api/windows", "signed-in", async (ctx, req, res, user, url) => {
  void user;
  const channel = url.searchParams.get("channel");
  const now = Date.now();
  const windows = await ctx.store.windowsFor(channel);
  // judge lapses for closed windows so statuses are correct
  for (const w of windows) {
    if (now >= w.closes_at) {
      await ctx.store.transaction(async (client) => {
        await ctx.store.lapseWindowIfNeeded(client, w.id, now);
      });
    }
  }
  const fresh = await ctx.store.windowsFor(channel);
  sendJson(res, 200, { server_time: formatInstant(now), windows: fresh.map((w) => windowJson(w, now)) });
});

route("GET", "/api/windows/<id>", "signed-in", async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const w = await windowWithLapse(ctx, params.id!);
  if (!w) throw errNotFound();
  sendJson(res, 200, { server_time: formatInstant(Date.now()), window: windowJson(w, Date.now()) });
});

route("POST", "/api/channels/<id>/windows", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void url; void req;
  const b = body as { opens_at?: unknown; closes_at?: unknown; cap_ml_day?: unknown; rostered_operator?: unknown };
  const errors: Record<string, string> = {};
  const opensAt = typeof b.opens_at === "string" ? parseInstant(b.opens_at) : null;
  if (opensAt === null) errors.opens_at = "Give an instant like 2026-10-04T00:00:00Z.";
  const closesAt = typeof b.closes_at === "string" ? parseInstant(b.closes_at) : null;
  if (closesAt === null) errors.closes_at = "Give an instant like 2026-10-04T00:00:00Z.";
  const cap = typeof b.cap_ml_day === "string" ? b.cap_ml_day : "";
  if (decParse(cap) === null) errors.cap_ml_day = "Cap must be a number with at most three decimals.";
  const rostered = typeof b.rostered_operator === "string" ? b.rostered_operator : "";
  if (rostered === "") errors.rostered_operator = "The rostered operator must be a district operator who has not been erased.";
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);

  const { windowId, revision } = await createWindow(ctx.store, params.id!, user!.id, {
    opens_at: opensAt!, closes_at: closesAt!, capMlDay: cap, rosteredOperator: rostered,
  }, Date.now());
  const w = await ctx.store.windowById(windowId);
  sendJson(res, 201, { window: windowJson(w!, Date.now()), capacity_revision: revision });
});

route("GET", "/api/windows/<id>/notices", [DISPATCHER, CLERK], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  await windowWithLapse(ctx, params.id!);
  const rows = await ctx.store.query<{ kind: string; grower_id: number; grower_name: string; subject: string; state: string; created_at: Date }>(
    `SELECT n.kind, n.grower_id, p.name AS grower_name, n.subject, n.state, n.created_at
     FROM notices n JOIN people p ON p.id = n.grower_id WHERE n.window_id = $1 ORDER BY n.id`,
    [params.id!],
  );
  sendJson(res, 200, {
    notices: rows.rows.map((r) => ({
      kind: r.kind,
      grower_id: r.grower_id,
      grower_name: r.grower_name,
      subject: r.subject,
      state: r.state,
      created_at: formatInstant(new Date(r.created_at).getTime()),
    })),
  });
});

// --- turnouts and operators -----------------------------------------------------

route("GET", "/api/turnouts", [GROWER, DISPATCHER, CLERK], async (ctx, req, res, user, url) => {
  void url; void req;
  const growerId = user!.role === "grower" ? user!.id : null;
  sendJson(res, 200, { turnouts: await ctx.store.turnoutsFor(growerId) });
});

route("GET", "/api/operators", [GROWER, OPERATOR, DISPATCHER, CLERK], async (ctx, req, res) => {
  void req;
  sendJson(res, 200, { operators: await ctx.store.operators() });
});

// --- quote and orders ------------------------------------------------------------

route("GET", "/api/orders/quote", [GROWER], async (ctx, req, res, user, url) => {
  void req;
  const now = Date.now();
  const windowId = url.searchParams.get("window");
  const turnoutCode = url.searchParams.get("turnout");
  const volumeRaw = url.searchParams.get("volume_ml");
  if (!windowId) throw fieldErrors({ window: "Choose a delivery window." });
  const w = await windowWithLapse(ctx, windowId);
  if (!w) throw errNotFound();
  // the window must be on one of the caller's channels
  const own = await ctx.store.turnoutsFor(user!.id);
  if (!own.some((t) => t.channel_id === w.channel_id)) throw errNotFound();

  let turnoutMax: string | null = null;
  if (turnoutCode !== null) {
    const t = own.find((x) => x.code === turnoutCode);
    if (!t || t.channel_id !== w.channel_id) {
      throw fieldErrors({ turnout: "Choose one of your turnouts on this window's channel." });
    }
    turnoutMax = turnoutMaxMl(t.max_rate_ml_day, w.hours);
  }

  let rate: string | null = null;
  if (volumeRaw !== null) {
    const d = decParse(volumeRaw);
    if (d === null || decCmp(d, decParse("0.000")!) <= 0 || decCmp(d, decParse("500.000")!) > 0 || (volumeRaw.split(".")[1] ?? "").length > 3) {
      throw fieldErrors({ volume_ml: "Volume must be greater than 0 and at most 500.000 ML." });
    }
    if (turnoutMax !== null && decCmp(decParse(volumeRaw)!, decParse(turnoutMax)!) > 0) {
      throw fieldErrors({ volume_ml: `More than ${turnoutCode} can pass in this window: ${turnoutMax} ML.` });
    }
    rate = rateMlDay(volumeRaw, w.hours);
  }
  sendJson(res, 200, {
    rate_ml_day: rate,
    turnout_max_ml: turnoutMax,
    window: windowJson(w, now),
  });
});

route("POST", "/api/orders", [GROWER], async (ctx, req, res, user, url, body) => {
  void url; void req;
  const b = body as Record<string, unknown>;
  const turnout = typeof b.turnout === "string" ? b.turnout : "";
  const windowId = typeof b.window_id === "string" ? b.window_id : "";
  const volume = typeof b.volume_ml === "string" ? b.volume_ml : typeof b.volume_ml === "number" ? String(b.volume_ml) : "";
  const operatorCode = typeof b.operator_code === "string" ? b.operator_code : "";
  const standby = typeof b.standby_code === "string" ? b.standby_code : null;
  if (!turnout) throw fieldErrors({ turnout: "Choose one of your turnouts." });
  if (!windowId) throw fieldErrors({ window_id: "Choose a delivery window." });
  try {
    const out = await placeOrder(ctx.store, user!.id, {
      turnout, windowId, volumeMl: volume, operatorCode, standbyCode: standby,
    }, Date.now());
    sendJson(res, 201, { order: orderJson(out.order), window: windowJson(out.window, Date.now()), allocation: allocationJson(out.allocation) });
  } catch (e: unknown) {
    if (e instanceof NoticeAndError) {
      // the refusal's conflict notice is queued outside the rolled-back step
      await queueNoticeAfterRefusal(ctx.store, e.notice);
      throw e.error;
    }
    throw e;
  }
});

route("GET", "/api/orders", [GROWER, DISPATCHER, CLERK], async (ctx, req, res, user, url) => {
  void req;
  const windowId = url.searchParams.get("window");
  if (windowId) {
    await windowWithLapse(ctx, windowId);
  }
  const growerId = user!.role === "grower" ? user!.id : null;
  const orders = await ctx.store.ordersFor(windowId, growerId);
  // growers' names for the board's Grower column, keyed by grower id
  const ids = [...new Set(orders.map((o) => o.grower_id))];
  const nameRows = await ctx.store.query<{ id: number; name: string }>(
    "SELECT id, name FROM people WHERE id = ANY($1::int[])",
    [ids],
  );
  const names: Record<string, string> = {};
  for (const r of nameRows.rows) names[String(r.id)] = r.name;
  sendJson(res, 200, { orders: orders.map(orderJson), growers: names });
});

route("GET", "/api/orders/<number>", [GROWER, DISPATCHER, CLERK], async (ctx, req, res, user, url, body, params) => {
  void url; void body; void req;
  const order = await ctx.store.orderRow(params.number!);
  if (!order) throw errNotFound();
  if (user!.role === "grower" && order.grower_id !== user!.id) throw errNotFound();
  await windowWithLapse(ctx, order.window_id);
  const fresh = await ctx.store.orderRow(params.number!);
  sendJson(res, 200, { order: orderJson(fresh!) });
});

route("POST", "/api/orders/<number>/cancel", [GROWER], async (ctx, req, res, user, url, body, params) => {
  void url; void body; void req;
  const order = await ctx.store.orderRow(params.number!);
  if (!order) throw errNotFound();
  if (order.grower_id !== user!.id) throw errNotFound();
  const out = await closeOrder(ctx.store, params.number!, user!.id, Date.now());
  const result: Record<string, unknown> = { order: orderJson(out.order), window: windowJson(out.window, Date.now()) };
  if (out.allocation) result.allocation = allocationJson(out.allocation);
  sendJson(res, 200, result);
});

route("POST", "/api/orders/<number>/schedule", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const out = await scheduleOrder(ctx.store, params.number!, Date.now());
  sendJson(res, 200, { order: orderJson(out.order), window: windowJson(out.window, Date.now()) });
});

route("POST", "/api/orders/<number>/close", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const out = await closeOrder(ctx.store, params.number!, null, Date.now());
  sendJson(res, 200, { order: orderJson(out.order), window: windowJson(out.window, Date.now()) });
});

route("POST", "/api/orders/<number>/reopen", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const out = await reopenOrder(ctx.store, params.number!, Date.now());
  sendJson(res, 200, { order: orderJson(out.order), window: windowJson(out.window, Date.now()) });
});

// --- ration and restrictions -----------------------------------------------------

route("POST", "/api/windows/<id>/ration", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const out = await rationWindow(ctx.store, params.id!, Date.now());
  sendJson(res, 200, {
    window: windowJson(out.window, Date.now()),
    rationed: out.rationed,
    left_requested: out.left_requested,
  });
});

route("POST", "/api/windows/<id>/restrictions", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void req;
  const b = body as { cap_ml_day?: unknown; reason?: unknown };
  const cap = typeof b.cap_ml_day === "string" ? b.cap_ml_day : "";
  const reason = typeof b.reason === "string" ? b.reason : "";
  const out = await publishRestriction(ctx.store, params.id!, cap, reason, Date.now());
  sendJson(res, 201, {
    restriction: out.restriction,
    window: windowJson(out.window, Date.now()),
    moved_orders: out.moved_orders,
  });
});

route("GET", "/api/restrictions/<id>", [DISPATCHER, CLERK, REVIEWER], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const r = await ctx.store.query<{ id: number; window_id: string; cap_ml_day: string; reason: string; effective_at: Date }>(
    "SELECT id, window_id, cap_ml_day, reason, effective_at FROM restrictions WHERE id = $1",
    [Number(params.id)],
  );
  const row = r.rows[0];
  if (!row) throw errNotFound();
  const w = await windowWithLapse(ctx, row.window_id);
  const orders = await ctx.store.ordersFor(row.window_id, null);
  sendJson(res, 200, {
    restriction: {
      id: row.id,
      window_id: row.window_id,
      cap_ml_day: row.cap_ml_day,
      reason: row.reason,
      effective_at: formatInstant(new Date(row.effective_at).getTime()),
    },
    window: w ? windowJson(w, Date.now()) : null,
    moved_orders: orders.filter((o) => o.conflict === "restriction").map((o) => o.number),
  });
});

// --- gate cards --------------------------------------------------------------------

route("GET", "/api/gate-cards", [OPERATOR, DISPATCHER], async (ctx, req, res, user, url) => {
  void req;
  const windowId = url.searchParams.get("window");
  if (windowId) await windowWithLapse(ctx, windowId);
  const cards = user!.role === "operator" ? await operatorCards(ctx, user!) : await ctx.store.allOpenCards();
  const fresh = user!.role === "operator" ? await operatorCards(ctx, user!) : await ctx.store.allOpenCards();
  void cards;
  const now = Date.now();
  const windows = await ctx.store.windowsFor(null);
  const statusOf = (windowId2: string) => {
    const w = windows.find((x) => x.id === windowId2);
    return w ? windowStatus(w.opens_at, w.closes_at, now) : "closed";
  };
  sendJson(res, 200, { cards: fresh.map((c) => cardJson(c, statusOf)) });
});

route("POST", "/api/gate-cards/<id>/stroke", [OPERATOR], async (ctx, req, res, user, url, body, params) => {
  void url; void body; void req;
  const out = await commitStroke(ctx.store, Number(params.id), user!.operator_code!, Date.now());
  if (out.status === 202) {
    // try to write the stroke record now; the retry loop finishes it later
    const stored = await writeStrokeRecord(ctx.cfg.s3, out.card, user!.operator_code!, out.card.stroke!.committed_at);
    if (stored) {
      const confirmed = await confirmStroke(ctx.store, Number(params.id), Date.now());
      if (confirmed) {
        sendJson(res, 200, {
          card: cardJson(confirmed.card, () => "open"),
          order: orderJson(confirmed.order),
          window: windowJson(confirmed.window, Date.now()),
        });
        return;
      }
    }
    sendJson(res, 202, { card: cardJson(out.card, () => "open") });
    return;
  }
  sendJson(res, 200, { card: cardJson(out.card, () => "open") });
});

route("POST", "/api/gate-cards/<id>/remove-holder", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const out = await removeHolder(ctx.store, Number(params.id), Date.now());
  sendJson(res, 200, { card: cardJson(out.card, () => "open"), order: orderJson(out.order) });
});

// --- capacity ---------------------------------------------------------------------

route("GET", "/api/channels/<id>/capacity", [DISPATCHER, CLERK, REVIEWER], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const ch = await ctx.store.query<{ id: string }>("SELECT id FROM channels WHERE id = $1", [params.id!]);
  if (!ch.rows[0]) throw errNotFound();
  const out = await readCapacity(ctx.store, params.id!);
  sendJson(res, 200, out);
});

route("PUT", "/api/channels/<id>/capacity", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void url; void req;
  const b = body as { base_revision?: unknown; cells?: unknown };
  const baseRevision = typeof b.base_revision === "number" ? b.base_revision : NaN;
  if (!Number.isInteger(baseRevision)) throw fieldErrors({ base_revision: "Give the revision you based your edit on." });
  const cellsRaw = Array.isArray(b.cells) ? b.cells : null;
  if (!cellsRaw) throw fieldErrors({ cells: "Send the cells you changed." });
  const cells = cellsRaw.map((c) => {
    const cell = c as { window_id?: unknown; cap_ml_day?: unknown };
    return { window_id: String(cell.window_id ?? ""), cap_ml_day: String(cell.cap_ml_day ?? "") };
  });
  const ch = await ctx.store.query<{ id: string }>("SELECT id FROM channels WHERE id = $1", [params.id!]);
  if (!ch.rows[0]) throw errNotFound();
  const out = await saveCapacity(ctx.store, params.id!, user!.id, baseRevision, cells, Date.now());
  if (out.ok) {
    sendJson(res, 200, { revision: out.revision, cells: out.cells });
  } else {
    sendJson(res, 409, {
      error: "revision_conflict",
      message: "Another dispatcher saved first. Each cap settled to the lower value.",
      revision: out.revision,
      cells: out.settled,
      submitted: out.submitted,
    });
  }
});

route("POST", "/api/channels/<id>/capacity/revisions/<revision>/restore", [DISPATCHER], async (ctx, req, res, user, url, body, params) => {
  void url; void body; void req;
  const revision = Number(params.revision);
  if (!Number.isInteger(revision)) throw fieldErrors({ revision: "Choose a revision." });
  const out = await restoreRevision(ctx.store, params.id!, user!.id, revision, Date.now());
  sendJson(res, 201, out);
});

// --- search -------------------------------------------------------------------------

route("GET", "/api/search", "signed-in", async (ctx, req, res, user, url) => {
  void req;
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 60) throw fieldErrors({ q: "Type at least two characters." });
  sendJson(res, 200, { suggestions: await searchSuggestions(ctx, user!, q) });
});

// --- totals ---------------------------------------------------------------------------

route("GET", "/api/totals", [DISPATCHER, CLERK, REVIEWER], async (ctx, req, res, user, url) => {
  void user; void req;
  const now = Date.now();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let fromStr: string | null = null;
  let toStr: string | null = null;
  if (from !== null || to !== null) {
    if (from === null || to === null) {
      const errors: Record<string, string> = {};
      if (from === null) errors.from = "Give a district date like 2026-10-04.";
      if (to === null) errors.to = "Give a district date like 2026-10-04.";
      throw fieldErrors(errors);
    }
    const period = validatePeriod(from, to);
    fromStr = period.from;
    toStr = period.to;
    // lapse windows first so totals are settled
    const all = await ctx.store.windowsFor(null);
    for (const w of all) {
      if (now >= w.closes_at) {
        await ctx.store.transaction(async (client) => {
          await ctx.store.lapseWindowIfNeeded(client, w.id, now);
        });
      }
    }
  }
  const windows = await ctx.store.windowsFor(null);
  const covered = windows.filter((w) => {
    if (fromStr === null) return true;
    const local = districtDate(w.opens_at);
    return local >= fromStr && local <= toStr!;
  });
  const channels = await ctx.store.channelList();
  const out = channels
    .map((c) => {
      const cw = covered.filter((w) => w.channel_id === c.id);
      const sum = (sel: (w: WindowRow) => string): string => {
        let acc = decParse("0.000")!;
        for (const w of cw) acc = decAdd(acc, decParse(sel(w))!);
        return decStr3(acc);
      };
      return {
        channel_id: c.id,
        cap_volume_ml: sum((w) => w.cap_volume_ml),
        committed_ml: sum((w) => w.committed_ml),
        delivered_ml: sum((w) => w.delivered_ml),
        remaining_ml: sum((w) => w.remaining_ml),
        windows: cw.map((w) => ({
          window_id: w.id,
          label: w.label,
          cap_volume_ml: w.cap_volume_ml,
          committed_ml: w.committed_ml,
          delivered_ml: w.delivered_ml,
          remaining_ml: w.remaining_ml,
        })),
      };
    })
    .filter((c) => fromStr === null || c.windows.length > 0);
  sendJson(res, 200, { channels: out });
});

// --- packs ------------------------------------------------------------------------------

route("GET", "/api/packs/preview", [CLERK], async (ctx, req, res, user, url) => {
  void user; void req;
  const period = validatePeriod(url.searchParams.get("from"), url.searchParams.get("to"));
  const signatory = validateSignatory(url.searchParams.get("signatory"));
  const doc = await buildPackDocument(ctx.store, period.from, period.to, signatory);
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end(doc);
});

route("POST", "/api/packs", [CLERK], async (ctx, req, res, user, url, body) => {
  void url; void req;
  const b = body as { from?: unknown; to?: unknown; signatory?: unknown; document?: unknown };
  const pack = await submitPack(ctx.store, user!.id, {
    from: String(b.from ?? ""),
    to: String(b.to ?? ""),
    signatory: String(b.signatory ?? ""),
    document: typeof b.document === "string" ? b.document : "",
  });
  // try the store now; the retry loop finishes it later
  await tryAdvancePack(ctx, pack.id);
  const fresh = await packById(ctx, pack.id);
  sendJson(res, 202, { pack: packJson(fresh!) });
});

route("GET", "/api/packs", [CLERK, REVIEWER], async (ctx, req, res, user) => {
  void req;
  const rows = await ctx.store.query<{
    id: string; number: string; from_date: string; to_date: string; signatory: string; state: string;
    stalled_on: string | null; object_key: string | null; sha256: string | null; created_at: Date; mailed_at: Date | null;
  }>("SELECT * FROM packs ORDER BY created_at DESC, number DESC");
  const packs = rows.rows
    .map((r) => toPackRow(r))
    .filter((p) => (user!.role === CLERK ? true : p.state === "mailed"));
  sendJson(res, 200, { packs });
});

route("GET", "/api/packs/<id>", [CLERK, REVIEWER], async (ctx, req, res, user, url, body, params) => {
  void url; void body; void req;
  const pack = await packById(ctx, params.id!);
  if (!pack) throw errNotFound();
  if (user!.role === REVIEWER && pack.state !== "mailed") throw errNotFound();
  sendJson(res, 200, { pack: packJson(pack) });
});

route("GET", "/api/packs/<id>/document", [CLERK, REVIEWER], async (ctx, req, res, user, url, body, params) => {
  void url; void body; void req;
  const pack = await packById(ctx, params.id!);
  if (!pack) throw errNotFound();
  if (user!.role === REVIEWER && pack.state !== "mailed") throw errNotFound();
  if (pack.state !== "stored" && pack.state !== "mailed") {
    throw new ApiError(409, "not_stored", "The pack is not stored yet.");
  }
  const bytes = await s3Get(ctx.cfg.s3, pack.key!);
  if (bytes === null) throw new ApiError(409, "not_stored", "The pack is not stored yet.");
  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": `attachment; filename="${pack.number}.txt"`,
  });
  res.end(bytes);
});

route("DELETE", "/api/packs/<id>", [CLERK], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const pack = await packById(ctx, params.id!);
  if (!pack) throw errNotFound();
  if (pack.state === "mailed") throw new ApiError(409, "pack_mailed", "This pack has already been mailed.");
  if (pack.state === "withdrawn") throw new ApiError(409, "illegal_transition", "That change is not allowed for this order now.");
  // delete any stored object, retrying until the store accepts
  const deleted = pack.key ? await s3Delete(ctx.cfg.s3, pack.key) : true;
  if (pack.key && !deleted) {
    // keep it withdrawn and let the retry loop finish the delete; no mail is
    // ever sent for a withdrawn pack
  }
  await ctx.store.query(
    `UPDATE packs SET state = 'withdrawn', stalled_on = $1 WHERE id = $2`,
    [pack.key && !deleted ? "store" : null, pack.id],
  );
  const fresh = await packById(ctx, pack.id);
  sendJson(res, 200, { pack: packJson(fresh!) });
});

// --- contractors ---------------------------------------------------------------------------

route("GET", "/api/contractors", [DISPATCHER, CLERK], async (ctx, req, res) => {
  void req;
  const rows = await ctx.store.query<{ code: string; name: string | null; phone: string | null; erased: boolean }>(
    "SELECT operator_code AS code, name, phone, erased FROM people WHERE role = 'operator' AND operator_kind = 'contractor' ORDER BY operator_code",
  );
  sendJson(res, 200, { contractors: rows.rows.map((r) => ({ code: r.code, name: r.erased ? null : r.name, phone: r.erased ? null : r.phone, erased: r.erased })) });
});

route("DELETE", "/api/contractors/<code>", [CLERK], async (ctx, req, res, user, url, body, params) => {
  void user; void url; void body; void req;
  const out = await eraseContractor(ctx.store, params.code!, Date.now());
  sendJson(res, 200, { contractor: { code: out.code, name: null, phone: null, erased: true }, handed_over: out.handed_over });
});

// --- health -----------------------------------------------------------------------------------

route("GET", "/api/health", "any", async (ctx, req, res) => {
  void req;
  if (!ctx.dbReady) throw errDatabaseUnavailable();
  sendJson(res, 200, { status: "ok" });
});

// ---------------------------------------------------------------------------
// helpers

async function operatorCards(ctx: Ctx, user: UserRow): Promise<CardRow[]> {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const rows = await ctx.store.query(
    `SELECT * FROM gate_cards WHERE (holder_code = $1 AND state = 'open') OR (stroke_operator = $1 AND stroke_confirmed_at >= $2)
     ORDER BY id DESC`,
    [user.operator_code, new Date(cutoff)],
  );
  return rows.rows.map((r) => ({
    id: r.id,
    order_number: r.order_number,
    turnout: r.turnout,
    channel_id: r.channel_id,
    window_id: r.window_id,
    kind: r.kind,
    state: r.state,
    holder_code: r.holder_code,
    from_ml_day: r.from_ml_day,
    to_ml_day: r.to_ml_day,
    stroke_key: r.stroke_key,
    stroke:
      r.stroke_key !== null
        ? {
            key: r.stroke_key,
            committed_at: formatInstant(r.stroke_committed_at ? new Date(r.stroke_committed_at).getTime() : 0),
            confirmed_at: r.stroke_confirmed_at ? formatInstant(new Date(r.stroke_confirmed_at).getTime()) : null,
            operator_code: r.stroke_operator ?? "",
          }
        : null,
    created_at: r.created_at ? new Date(r.created_at).getTime() : 0,
  }));
}

function userJson(u: UserRow): Record<string, unknown> {
  return { id: u.id, name: u.name, email: u.email, role: u.role, operator_code: u.operator_code };
}

// --- search (one place for reach and shape) ---------------------------------

async function searchSuggestions(ctx: Ctx, user: UserRow, q: string): Promise<Array<{ kind: string; label: string; detail: string; href: string }>> {
  const needle = q.toLowerCase();
  const rail = await ctx.store.channelRailOrder();
  const channels = await ctx.store.query<{ id: string; name: string }>("SELECT id, name FROM channels ORDER BY rail_order");
  const out: Array<{ kind: string; label: string; detail: string; href: string }> = [];

  const windows = await ctx.store.windowsFor(null);
  const turnouts = user.role === GROWER || user.role === DISPATCHER || user.role === CLERK ? await ctx.store.turnoutsFor(user.role === GROWER ? user.id : null) : [];
  const operators = user.role === GROWER || user.role === DISPATCHER || user.role === CLERK ? await ctx.store.operators() : [];

  // channels
  if (user.role === GROWER || user.role === OPERATOR || user.role === DISPATCHER || user.role === CLERK || user.role === REVIEWER) {
    const ownChannelIds = new Set(user.role === GROWER ? turnouts.map((t) => t.channel_id) : channels.rows.map((c) => c.id));
    for (const c of channels.rows) {
      if (!ownChannelIds.has(c.id)) continue;
      if (!c.name.toLowerCase().includes(needle)) continue;
      const earliest = windows.find((w) => w.channel_id === c.id && w.closes_at > Date.now());
      let detail: string;
      let href: string;
      if (earliest) {
        detail = `${earliest.remaining_ml} ML left, ${earliest.label}${earliest.restriction_cap_ml_day ? `, restricted to ${earliest.restriction_cap_ml_day} ML/day` : ""}`;
        href =
          user.role === GROWER
            ? `/grower/orders/new?window=${earliest.id}`
            : user.role === DISPATCHER
              ? `/board?channels=${c.id}&window=${earliest.id}`
              : user.role === OPERATOR
                ? `/field`
                : `/channels/${c.id}/capacity`;
      } else {
        detail = "No open windows";
        href = user.role === GROWER ? "/grower/orders/new" : user.role === DISPATCHER ? `/board?channels=${c.id}` : user.role === OPERATOR ? "/field" : `/channels/${c.id}/capacity`;
      }
      out.push({ kind: "channel", label: c.name, detail, href });
    }
  }

  // turnouts
  if (user.role === GROWER || user.role === DISPATCHER || user.role === CLERK) {
    for (const t of turnouts) {
      if (!t.code.toLowerCase().includes(needle)) continue;
      const channelName = channels.rows.find((c) => c.id === t.channel_id)?.name ?? "";
      const grower = await ctx.store.query<{ name: string }>("SELECT name FROM people WHERE id = $1", [t.grower_id]);
      out.push({
        kind: "turnout",
        label: t.code,
        detail: `${channelName}, ${grower.rows[0]?.name ?? ""}`,
        href: user.role === GROWER ? "/grower" : user.role === DISPATCHER ? `/board?channels=${t.channel_id}` : `/channels/${t.channel_id}/capacity`,
      });
    }
  }

  // growers
  if (user.role === DISPATCHER || user.role === CLERK) {
    const growers = await ctx.store.query<{ id: number; name: string }>("SELECT id, name FROM people WHERE role = 'grower' ORDER BY name");
    for (const g of growers.rows) {
      if (!g.name.toLowerCase().includes(needle)) continue;
      const own = turnouts
        .filter((t) => t.grower_id === g.id)
        .sort((a, b) => (rail.get(a.channel_id) ?? 99) - (rail.get(b.channel_id) ?? 99) || a.code.localeCompare(b.code))
        .map((t) => t.code);
      const channelIds = [...new Set(turnouts.filter((t) => t.grower_id === g.id).map((t) => t.channel_id))]
        .sort((a, b) => (rail.get(a) ?? 99) - (rail.get(b) ?? 99))
        .join(",");
      out.push({
        kind: "grower",
        label: g.name,
        detail: own.join(", "),
        href: user.role === DISPATCHER ? `/board?channels=${channelIds}` : `/channels/${turnouts.find((t) => t.grower_id === g.id)!.channel_id}/capacity`,
      });
    }
  }

  // operators
  if (user.role === GROWER || user.role === DISPATCHER || user.role === CLERK) {
    for (const o of operators) {
      let match = o.code.toLowerCase().includes(needle);
      if (!o.erased && o.name && o.name.toLowerCase().includes(needle)) match = true;
      if (!o.erased && user.role !== GROWER) {
        // phone digits for dispatchers and clerks
        const person = await ctx.store.query<{ phone: string | null }>("SELECT phone FROM people WHERE operator_code = $1", [o.code]);
        const phone = person.rows[0]?.phone;
        if (phone && phone.replace(/\D/g, "").includes(needle.replace(/\D/g, "")) && needle.replace(/\D/g, "").length >= 2) match = true;
      }
      if (!match) continue;
      const label = o.erased ? `Operator ${o.code}` : `${o.name} (${o.code})`;
      const detail = o.kind === "district" ? "District operator" : "Contractor";
      const href =
        user.role === GROWER
          ? "/grower/orders/new"
          : o.kind === "contractor"
            ? "/contractors"
            : user.role === DISPATCHER
              ? "/board"
              : "/packs";
      out.push({ kind: "operator", label, detail, href });
    }
  }

  const order: Record<string, number> = { channel: 0, turnout: 1, grower: 2, operator: 3 };
  return out
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.label.localeCompare(b.label))
    .slice(0, 8);
}

// --- packs helpers ----------------------------------------------------------

async function packById(ctx: Ctx, id: string): Promise<PackRow | null> {
  const rows = await ctx.store.query<{
    id: string; number: string; from_date: string; to_date: string; signatory: string; state: string;
    stalled_on: string | null; object_key: string | null; sha256: string | null; created_at: Date; mailed_at: Date | null;
  }>("SELECT * FROM packs WHERE id = $1", [id]);
  const r = rows.rows[0];
  if (!r) return null;
  return toPackRow(r);
}

function packJson(p: PackRow): Record<string, unknown> {
  return {
    id: p.id,
    number: p.number,
    from: p.from,
    to: p.to,
    signatory: p.signatory,
    state: p.state,
    stalled_on: p.stalled_on,
    key: p.key,
    sha256: p.sha256,
    created_at: p.created_at,
    mailed_at: p.mailed_at,
  };
}

// Advance a pack: building -> stored (store) -> mailed (mail).
async function tryAdvancePack(ctx: Ctx, packId: string): Promise<void> {
  const pack = await packById(ctx, packId);
  if (!pack) return;
  if (pack.state === "building") {
    const doc = await ctx.store.query<{ document: string }>("SELECT document FROM packs WHERE id = $1", [packId]);
    const bytes = Buffer.from(doc.rows[0]!.document, "utf8");
    const ok = await s3Put(ctx.cfg.s3, `packs/${pack.number}.txt`, bytes, "text/plain; charset=utf-8");
    if (ok) {
      await ctx.store.query(
        `UPDATE packs SET state = 'stored', sha256 = $1, stored_at = now(), stalled_on = null, object_key = $2 WHERE id = $3 AND state = 'building'`,
        [packSha256(doc.rows[0]!.document), `packs/${pack.number}.txt`, packId],
      );
    } else {
      await ctx.store.query(`UPDATE packs SET stalled_on = 'store' WHERE id = $1 AND state = 'building'`, [packId]);
      return;
    }
  }
  const stored = await packById(ctx, packId);
  if (stored && stored.state === "stored") {
    const doc = await ctx.store.query<{ document: string }>("SELECT document FROM packs WHERE id = $1", [packId]);
    const bytes = Buffer.from(doc.rows[0]!.document, "utf8");
    const digest = packSha256(doc.rows[0]!.document);
    const sent = await smtpSend(ctx.cfg.smtp, {
      to: REGULATOR_EMAIL,
      subject: `Ditchbook delivery pack ${stored.number}`,
      body: `Pack ${stored.number} for ${stored.from} to ${stored.to}. SHA-256 ${digest}`,
      attachment: { filename: `${stored.number}.txt`, contentType: "text/plain", bytes },
    });
    if (sent) {
      await ctx.store.query(`UPDATE packs SET state = 'mailed', mailed_at = now(), stalled_on = null WHERE id = $1 AND state = 'stored'`, [packId]);
    } else {
      await ctx.store.query(`UPDATE packs SET stalled_on = 'mail' WHERE id = $1 AND state = 'stored'`, [packId]);
    }
  }
}

function getSessionCookie(req: http.IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return null;
}

function setSessionCookie(res: http.ServerResponse, token: string): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(data);
}
