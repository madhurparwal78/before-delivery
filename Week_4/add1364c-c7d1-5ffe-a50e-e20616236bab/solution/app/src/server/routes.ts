import type { IncomingMessage, ServerResponse } from "node:http";
import { db } from "./db.js";
import { page as auditPage, type AuditOrder } from "./audit.js";
import { now } from "./clock.js";
import { attach } from "./events.js";
import {
  ApiError,
  BODY_LIMIT,
  Fields,
  IMPORT_BODY_LIMIT,
  STREAMING,
  forbidden,
  notFound,
  ok,
  parseJson,
  readBody,
  sameOrigin,
  sendError,
  sendJson,
  type Reply,
} from "./http.js";
import { withIdempotency } from "./idempotency.js";
import { isDesk, type PersonRow } from "./model.js";
import { isRealDate, officeDate, officeMoment, OFFICE_TIME_ZONE, utcIso } from "./office-time.js";
import { addJoiner, addTravel, cancelTravel, changeAccess, confirmLeave, listPeople } from "./people.js";
import { personJson } from "./people-view.js";
import { authenticate, refuseWhileLocked, signIn, signOut, type Session } from "./sessions.js";
import * as drawer from "./drawer.js";
import * as rulesApi from "./rules-api.js";
import * as rotations from "./rotation-api.js";
import * as reviews from "./reviews.js";
import * as imports from "./imports.js";
import * as healthApi from "./health.js";
import { billingJson } from "./billing.js";
import { visibleVaultIds } from "./visibility.js";
import { syncAccess } from "./access-sync.js";
import { afterWrites, ping } from "./db.js";
import { serveClient } from "./static.js";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  raw: Buffer;
  person: PersonRow;
  session: Session;
  json: () => unknown;
}

type Handler = (ctx: Ctx) => Promise<Reply | typeof STREAMING>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  idempotent: boolean;
}

const routes: Route[] = [];

function define(method: string, path: string, handler: Handler, idempotent = false): void {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key: string) => (keys.push(key), "([^/]+)"))}$`);
  routes.push({ method, pattern, keys, handler, idempotent });
}

const deskOnly = (ctx: Ctx): void => {
  if (!isDesk(ctx.person.role)) throw forbidden();
};

// ---- sessions, clock ----
define("GET", "/api/me", async (ctx) =>
  ok({ person: await personJson(db, ctx.person, now()), session_ends_at: utcIso(ctx.session.endsAt) }),
);

// ---- people ----
define("GET", "/api/people", async (ctx) => (deskOnly(ctx), ok({ people: await listPeople() })));
define("POST", "/api/people", async (ctx) => ok(await addJoiner(ctx.person, ctx.json()), 201), true);
define("PATCH", "/api/people/:id", async (ctx) => ok(await changeAccess(ctx.person, ctx.params.id ?? "", ctx.json())));
define("POST", "/api/people/:id/leave", async (ctx) => ok(await confirmLeave(ctx.person, ctx.params.id ?? "", ctx.json())), true);
define("POST", "/api/people/:id/travel", async (ctx) => ok(await addTravel(ctx.person, ctx.params.id ?? "", ctx.json()), 201));
define("DELETE", "/api/people/:id/travel/:travel", async (ctx) => {
  await cancelTravel(ctx.person, ctx.params.id ?? "", ctx.params.travel ?? "");
  return { status: 204 };
});

// ---- vaults, vendors, logins ----
define("GET", "/api/vaults", async (ctx) => ok({ vaults: await drawer.listVaults(ctx.person) }));
define("GET", "/api/vaults/:id", async (ctx) => ok(await drawer.showVault(ctx.person, ctx.params.id ?? "")));
define("POST", "/api/vaults", async (ctx) => ok(await drawer.createVault(ctx.person, ctx.json()), 201));
define("PATCH", "/api/vaults/:id", async (ctx) => ok(await drawer.changeVault(ctx.person, ctx.params.id ?? "", ctx.json())));
define("GET", "/api/vendors", async () => ok({ vendors: await drawer.listVendors() }));
define("POST", "/api/vendors", async (ctx) => ok(await drawer.createVendor(ctx.person, ctx.json()), 201));
define("PATCH", "/api/vendors/:id", async (ctx) => ok(await drawer.changeVendor(ctx.person, ctx.params.id ?? "", ctx.json())));
define("POST", "/api/credentials", async (ctx) => ok(await drawer.createLogin(ctx.person, ctx.json()), 201));
define("GET", "/api/credentials/:id", async (ctx) => ok(await drawer.showLogin(ctx.person, ctx.params.id ?? "")));
define("PUT", "/api/credentials/:id/secret", async (ctx) => ok(await drawer.turnLogin(ctx.person, ctx.params.id ?? "", ctx.json())));
define("POST", "/api/credentials/:id/reveal", async (ctx) => ok(await drawer.revealLogin(ctx.person, ctx.params.id ?? "", ctx.json(), "reveal")));
define("POST", "/api/credentials/:id/copy", async (ctx) => ok(await drawer.revealLogin(ctx.person, ctx.params.id ?? "", ctx.json(), "copy")));

// ---- rules ----
define("GET", "/api/rules", async (ctx) => ok({ rules: await rulesApi.listRules(ctx.person, ctx.query.get("vault_id")) }));
define("GET", "/api/rules/:id", async (ctx) => ok(await rulesApi.showRule(ctx.person, ctx.params.id ?? "")));
define("POST", "/api/rules", async (ctx) => ok(await rulesApi.draftRule(ctx.person, ctx.json()), 201));
define("PATCH", "/api/rules/:id", async (ctx) => ok(await rulesApi.editRule(ctx.person, ctx.params.id ?? "", ctx.json())));
define("POST", "/api/rules/:id/sign", async (ctx) => ok(await rulesApi.signRule(ctx.person, ctx.params.id ?? "", ctx.json())));
define("GET", "/api/as-of", async (ctx) => ok(await rulesApi.asOf(ctx.person, ctx.query.get("night"))));

// ---- rotations ----
define("GET", "/api/rotations/calendar", async (ctx) => ok(await rotations.calendar(ctx.person, ctx.query.get("month"))));
define("POST", "/api/rotations", async (ctx) => ok(await rotations.scheduleRotation(ctx.person, ctx.json()), 201));
define("PATCH", "/api/rotations/:id", async (ctx) => ok(await rotations.changeRotation(ctx.person, ctx.params.id ?? "", ctx.json())));
define("GET", "/api/rotations/:id", async (ctx) => ok(await rotations.showRotation(ctx.person, ctx.params.id ?? "")));

// ---- reviews ----
define("GET", "/api/reviews", async (ctx) => ok({ reviews: await reviews.listReviews(ctx.person) }));
define("GET", "/api/reviews/:id", async (ctx) => ok(await reviews.showReview(ctx.person, ctx.params.id ?? "")));
define("POST", "/api/reviews/:id/lines/:line", async (ctx) =>
  ok(await reviews.decideLine(ctx.person, ctx.params.id ?? "", ctx.params.line ?? "", ctx.json())),
);
define("POST", "/api/reviews/:id/sign-off", async (ctx) => ok(await reviews.signOff(ctx.person, ctx.params.id ?? "")));

// ---- billing, health ----
define("GET", "/api/billing", async (ctx) => (deskOnly(ctx), ok(await billingJson())));
define("GET", "/api/health-report", async (ctx) => (deskOnly(ctx), ok(await healthApi.report(ctx.query.get("day")))));
define("POST", "/api/health-report/checks", async (ctx) => {
  if (ctx.person.role !== "office_manager") throw forbidden();
  return ok(await healthApi.manualCheck());
});

// ---- imports ----
define("POST", "/api/imports", async (ctx) => ok(await imports.importFile(ctx.person, ctx.json()), 201), true);
define("GET", "/api/imports/:id", async (ctx) => ok(await imports.showImport(ctx.person, ctx.params.id ?? "")));
define("POST", "/api/imports/:id/rows/:row/choice", async (ctx) =>
  ok(await imports.chooseHeld(ctx.person, ctx.params.id ?? "", ctx.params.row ?? "", ctx.json())),
);

// ---- audit ----
const AUDIT_LIMIT = { default: 50, max: 100 };

define("GET", "/api/audit", async (ctx) => {
  deskOnly(ctx);
  const fields = new Fields();
  const day = ctx.query.get("day") ?? officeDate(now());
  if (!isRealDate(day)) fields.add("day", "Use a date like 2026-11-05.");
  const order = ctx.query.get("order") ?? "oldest";
  if (order !== "oldest" && order !== "newest") fields.add("order", "Use oldest or newest.");
  const rawLimit = ctx.query.get("limit");
  const limit = rawLimit === null ? AUDIT_LIMIT.default : /^\d+$/.test(rawLimit) ? Number(rawLimit) : 0;
  if (limit < 1 || limit > AUDIT_LIMIT.max) fields.add("limit", "Use a whole number from 1 to 100.");
  fields.throwIfAny();
  return ok(await auditPage(db, day, order as AuditOrder, limit, ctx.query.get("after")));
});

// ---- the event stream ----
define("GET", "/api/events", async (ctx) => {
  ctx.res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  ctx.res.write("retry: 3000\n\n");
  // `seen` is what the page already shows. Seeding from it, rather than from what is visible now, is what lets
  // access that ended before this connection attached still be reported as ended, once, on attach.
  const seen = (ctx.query.get("seen") ?? "").split(",").filter((id) => id.length > 0);
  attach({
    res: ctx.res,
    personId: ctx.person.id,
    role: ctx.person.role,
    tokenHash: ctx.session.tokenHash,
    endsAt: ctx.session.endsAt,
    known: new Set(seen.length > 0 ? seen : await visibleVaultIds(db, ctx.person, now())),
  });
  if (seen.length > 0) await syncAccess(ctx.person.id, "change");
  return STREAMING;
});

// ---- dispatch ----

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function methodNotAllowed(): ApiError {
  return new ApiError(405, "method_not_allowed", "The audit trail cannot be changed.");
}

async function dispatchApi(req: IncomingMessage, res: ServerResponse, target: Target): Promise<void> {
  const method = req.method ?? "GET";
  const path = target.pathname.replace(/\/+$/, "");
  const write = WRITES.has(method);
  if (write && !sameOrigin(req)) throw new ApiError(403, "cross_origin", "That request came from another origin.");
  const raw = write ? await readBody(req, path === "/api/imports" ? IMPORT_BODY_LIMIT : BODY_LIMIT) : Buffer.alloc(0);
  if (write && raw.length > 0 && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
    throw new ApiError(415, "unsupported_media_type", "Send application/json.");
  }
  if (method === "GET" && path === "/api/health") {
    if (!(await ping())) throw new ApiError(503, "unavailable", "The database is not ready.");
    return sendJson(res, 200, { status: "ok" });
  }
  if (method === "GET" && path === "/api/clock") {
    const at = now();
    const moment = officeMoment(at);
    return sendJson(res, 200, { now: utcIso(at), office_date: moment.date, office_time: moment.time, offset: moment.offset, time_zone: OFFICE_TIME_ZONE });
  }
  if (path === "/api/audit" || path.startsWith("/api/audit/")) {
    if (write) throw methodNotAllowed();
  }
  if (method === "POST" && path === "/api/sessions") {
    let body: unknown = {};
    try {
      body = parseJson(raw);
    } catch {
      body = {};
    }
    await refuseWhileLocked(typeof body === "object" && body !== null ? (body as { username?: unknown }).username : undefined);
    const reply = await signIn(parseJson(raw));
    return sendJson(res, reply.status, reply.body, reply.headers);
  }
  if (method === "DELETE" && path === "/api/sessions") {
    const reply = await signOut(req);
    res.writeHead(reply.status, reply.headers ?? {});
    return void res.end();
  }
  const found = routes.find((candidate) => candidate.method === method && candidate.pattern.test(path));
  if (!found) {
    if (routes.some((candidate) => candidate.pattern.test(path))) throw new ApiError(405, "method_not_allowed", "That method is not allowed here.");
    throw notFound();
  }
  if (!write) await afterWrites();
  const session = await authenticate(req);
  const match = found.pattern.exec(path) ?? [];
  const params: Record<string, string> = {};
  found.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match[index + 1] ?? "");
  });
  const ctx: Ctx = { req, res, params, query: target.query, raw, person: session.person, session, json: () => parseJson(raw) };
  const run = (): Promise<Reply | typeof STREAMING> => found.handler(ctx);
  const reply = found.idempotent
    ? await withIdempotency(req, session.person.id, raw, run as () => Promise<Reply>)
    : await run();
  if (reply === STREAMING) return;
  if (reply.status === 204) {
    res.writeHead(204, reply.headers ?? {});
    return void res.end();
  }
  sendJson(res, reply.status, reply.body, reply.headers);
}

interface Target {
  pathname: string;
  query: URLSearchParams;
}

function targetOf(raw: string): Target {
  const mark = raw.indexOf("?");
  return { pathname: mark < 0 ? raw : raw.slice(0, mark), query: new URLSearchParams(mark < 0 ? "" : raw.slice(mark + 1)) };
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const target = targetOf(req.url ?? "/");
  try {
    if (target.pathname === "/api" || target.pathname.startsWith("/api/")) return await dispatchApi(req, res, target);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      return void res.end("Method not allowed");
    }
    return await serveClient(decodeURIComponent(target.pathname), res);
  } catch (error) {
    if (res.headersSent) return void res.end();
    if (error instanceof ApiError) return sendError(res, error);
    console.error("request failed:", error instanceof Error ? error.message : "unknown error");
    sendError(res, new ApiError(500, "internal", "Something went wrong on the server."));
  }
}
