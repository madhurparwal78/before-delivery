// The API: one table of endpoints with the roles allowed to call each, and the single precedence
// order every request goes through (415/413, 503, 401, 403, then the handler's 404, 422 and 409).
import type { IncomingMessage, ServerResponse } from "node:http";
import { SESSION_COOKIE, clearedCookie, sessionCookie, sessionUser, signIn, signOut, type Role, type User } from "./auth.ts";
import { getCapacity, createWindow, restoreRevision, saveCapacity } from "./capacity.ts";
import { listCards, removeHolder, strokeCard, strokesSettled } from "./cards.ts";
import { eraseContractor, listContractors } from "./contractors.ts";
import { isReady, read, tx } from "./db.ts";
import { formatMl } from "./decimal.ts";
import {
  ApiError,
  ValidationError,
  databaseUnavailable,
  forbidden,
  isJson,
  notFound,
  notSignedIn,
  parseCookies,
  readBody,
  sendBytes,
  sendError,
  sendJson,
} from "./http.ts";
import { windowNotices } from "./notices.ts";
import {
  cancelOrder,
  closeOrder,
  getOrder,
  lapseClosedWindows,
  listOrders,
  placeOrder,
  quoteOrder,
  reopenOrder,
  scheduleOrder,
} from "./orders.ts";
import { getPack, listPacks, packDocumentBytes, previewPack, submitPack, withdrawPack } from "./packs.ts";
import { allocationRecord, loadWindow, loadWindows, windowRecord } from "./records.ts";
import { rationWindow } from "./ration.ts";
import { getRestriction, publishRestriction } from "./restrictions.ts";
import { search } from "./search.ts";
import { isoInstant } from "./time.ts";
import { channelTotals } from "./totals.ts";

const BODY_LIMIT = 16_384;
const PACK_LIMIT = 2_000_000;

interface Context {
  user: User;
  token: string;
  params: string[];
  query: URLSearchParams;
  body: unknown;
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> } | { status: number; bytes: Buffer; headers: Record<string, string> };

interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: RegExp;
  roles: readonly Role[] | "signed-in";
  limit?: number;
  handle: (ctx: Context) => Promise<Reply>;
}

const G: Role = "grower";
const O: Role = "operator";
const D: Role = "dispatcher";
const C: Role = "clerk";
const R: Role = "reviewer";
const ALL = [G, O, D, C, R] as const;

const ok = (body: unknown, status = 200): Reply => ({ status, body });
const param = (ctx: Context, index = 0) => ctx.params[index]!;
const numeric = (text: string) => (/^\d{1,9}$/.test(text) ? Number(text) : -1);

const routes: Route[] = [
  {
    method: "DELETE", path: /^\/api\/session$/, roles: "signed-in",
    handle: async ({ token }) => {
      await read((db) => signOut(db, token));
      return { status: 204, body: null, headers: { "Set-Cookie": clearedCookie() } };
    },
  },
  { method: "GET", path: /^\/api\/me$/, roles: "signed-in", handle: async ({ user }) => ok({ user }) },
  { method: "GET", path: /^\/api\/me\/allocation$/, roles: [G], handle: ({ user }) => read(async (db) => ok(await allocationRecord(db, user.id))) },
  {
    method: "GET", path: /^\/api\/channels$/, roles: ALL,
    handle: () => read(async (db) => ok({
      channels: (await db.query("SELECT id, name, capacity_revision FROM channel ORDER BY rail_order")).rows,
    })),
  },
  {
    method: "GET", path: /^\/api\/windows$/, roles: ALL,
    handle: ({ query }) => read(async (db) => {
      const channel = query.get("channel");
      const windows = channel === null ? await loadWindows(db) : await loadWindows(db, "WHERE w.channel_id = $1", [channel]);
      return ok({ server_time: isoInstant(new Date()), windows: windows.map(windowRecord) });
    }),
  },
  {
    method: "GET", path: /^\/api\/windows\/([^/]+)$/, roles: ALL,
    handle: ({ params }) => read(async (db) => {
      const window = await loadWindow(db, params[0]!);
      if (!window) throw notFound();
      return ok({ server_time: isoInstant(new Date()), window: windowRecord(window) });
    }),
  },
  { method: "POST", path: /^\/api\/channels\/([^/]+)\/windows$/, roles: [D], handle: async (ctx) => ok(await createWindow(ctx.user, param(ctx), ctx.body), 201) },
  {
    method: "GET", path: /^\/api\/windows\/([^/]+)\/notices$/, roles: [D, C],
    handle: (ctx) => read(async (db) => {
      if (!(await loadWindow(db, param(ctx)))) throw notFound();
      return ok({ notices: await windowNotices(db, param(ctx)) });
    }),
  },
  {
    method: "GET", path: /^\/api\/turnouts$/, roles: [G, D, C],
    handle: ({ user }) => read(async (db) => ok({
      turnouts: (await db.query<{ code: string; channel_id: string; grower_id: number; max_rate_milli: bigint }>(
        "SELECT code, channel_id, grower_id, max_rate_milli FROM turnout WHERE $1::int IS NULL OR grower_id = $1 ORDER BY code",
        [user.role === "grower" ? user.id : null],
      )).rows.map(({ max_rate_milli, ...t }) => ({ ...t, max_rate_ml_day: formatMl(max_rate_milli) })),
    })),
  },
  {
    method: "GET", path: /^\/api\/operators$/, roles: [G, O, D, C],
    handle: () => read(async (db) => ok({
      operators: (await db.query(
        "SELECT operator_code AS code, operator_kind AS kind, name FROM person WHERE operator_code IS NOT NULL ORDER BY operator_code",
      )).rows,
    })),
  },
  { method: "POST", path: /^\/api\/orders$/, roles: [G], handle: async (ctx) => ok(await placeOrder(ctx.user, ctx.body), 201) },
  { method: "GET", path: /^\/api\/orders$/, roles: [G, D, C], handle: ({ user, query }) => read(async (db) => ok({ orders: await listOrders(db, user, query.get("window")) })) },
  { method: "GET", path: /^\/api\/orders\/quote$/, roles: [G], handle: ({ user, query }) => read(async (db) => ok(await quoteOrder(db, user, query))) },
  { method: "GET", path: /^\/api\/orders\/([^/]+)$/, roles: [G, D, C], handle: (ctx) => read(async (db) => ok({ order: await getOrder(db, ctx.user, param(ctx)) })) },
  { method: "POST", path: /^\/api\/orders\/([^/]+)\/cancel$/, roles: [G], handle: async (ctx) => ok(await cancelOrder(ctx.user, param(ctx))) },
  { method: "POST", path: /^\/api\/orders\/([^/]+)\/schedule$/, roles: [D], handle: async (ctx) => ok(await scheduleOrder(param(ctx))) },
  { method: "POST", path: /^\/api\/orders\/([^/]+)\/close$/, roles: [D], handle: async (ctx) => ok(await closeOrder(param(ctx))) },
  { method: "POST", path: /^\/api\/orders\/([^/]+)\/reopen$/, roles: [D], handle: async (ctx) => ok(await reopenOrder(param(ctx))) },
  { method: "GET", path: /^\/api\/gate-cards$/, roles: [O, D], handle: async ({ user, query }) => { await strokesSettled(); return read(async (db) => ok({ cards: await listCards(db, user, query.get("window")) })); } },
  {
    method: "POST", path: /^\/api\/gate-cards\/([^/]+)\/stroke$/, roles: [O],
    handle: async (ctx) => {
      const { status, body } = await strokeCard(ctx.user, numeric(param(ctx)));
      return ok(body, status);
    },
  },
  { method: "POST", path: /^\/api\/gate-cards\/([^/]+)\/remove-holder$/, roles: [D], handle: async (ctx) => ok(await removeHolder(numeric(param(ctx)))) },
  { method: "POST", path: /^\/api\/windows\/([^/]+)\/ration$/, roles: [D], handle: async (ctx) => ok(await rationWindow(param(ctx))) },
  { method: "POST", path: /^\/api\/windows\/([^/]+)\/restrictions$/, roles: [D], handle: async (ctx) => ok(await publishRestriction(param(ctx), ctx.body), 201) },
  { method: "GET", path: /^\/api\/restrictions\/([^/]+)$/, roles: [D, C, R], handle: (ctx) => read(async (db) => ok(await getRestriction(db, numeric(param(ctx))))) },
  { method: "GET", path: /^\/api\/channels\/([^/]+)\/capacity$/, roles: [D, C, R], handle: (ctx) => read(async (db) => ok(await getCapacity(db, param(ctx)))) },
  { method: "PUT", path: /^\/api\/channels\/([^/]+)\/capacity$/, roles: [D], handle: async (ctx) => ok(await saveCapacity(ctx.user, param(ctx), ctx.body)) },
  {
    method: "POST", path: /^\/api\/channels\/([^/]+)\/capacity\/revisions\/([^/]+)\/restore$/, roles: [D],
    handle: async (ctx) => ok(await restoreRevision(ctx.user, param(ctx), numeric(param(ctx, 1))), 201),
  },
  { method: "GET", path: /^\/api\/search$/, roles: ALL, handle: ({ user, query }) => read(async (db) => ok(await search(db, user, query.get("q")))) },
  { method: "GET", path: /^\/api\/totals$/, roles: [D, C, R], handle: ({ query }) => read(async (db) => ok(await channelTotals(db, query))) },
  {
    method: "GET", path: /^\/api\/packs\/preview$/, roles: [C],
    handle: ({ query }) => read(async (db) => ({
      status: 200, bytes: await previewPack(db, query), headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    })),
  },
  { method: "POST", path: /^\/api\/packs$/, roles: [C], limit: PACK_LIMIT, handle: async (ctx) => ok(await submitPack(ctx.body), 202) },
  { method: "GET", path: /^\/api\/packs$/, roles: [C, R], handle: ({ user }) => read(async (db) => ok({ packs: await listPacks(db, user) })) },
  { method: "GET", path: /^\/api\/packs\/([^/]+)$/, roles: [C, R], handle: (ctx) => read(async (db) => ok({ pack: await getPack(db, ctx.user, param(ctx)) })) },
  {
    method: "GET", path: /^\/api\/packs\/([^/]+)\/document$/, roles: [C, R],
    handle: (ctx) => read(async (db) => {
      const { number, bytes } = await packDocumentBytes(db, ctx.user, param(ctx));
      return {
        status: 200, bytes,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${number}.txt"`, "Cache-Control": "no-store" },
      };
    }),
  },
  { method: "DELETE", path: /^\/api\/packs\/([^/]+)$/, roles: [C], handle: async (ctx) => ok(await withdrawPack(param(ctx))) },
  { method: "GET", path: /^\/api\/contractors$/, roles: [D, C], handle: () => read(async (db) => ok({ contractors: await listContractors(db) })) },
  { method: "DELETE", path: /^\/api\/contractors\/([^/]+)$/, roles: [C], handle: async (ctx) => ok(await eraseContractor(param(ctx))) },
];

function match(method: string, path: string): { route: Route; params: string[] } | null {
  for (const route of routes) {
    const found = route.method === method ? route.path.exec(path) : null;
    if (found) return { route, params: found.slice(1).map(decodeURIComponent) };
  }
  return null;
}

async function parseJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return {};
  const hasBody = Number(req.headers["content-length"] ?? "0") > 0 || req.headers["transfer-encoding"] !== undefined;
  if (hasBody && !isJson(req)) {
    req.resume();
    throw new ApiError(415, "unsupported_type", "Send the request body as application/json.");
  }
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ValidationError({ body: "Send a valid JSON body." });
  }
}

/** POST /api/session is the one endpoint that needs no session. */
async function sessionEndpoint(res: ServerResponse, body: unknown): Promise<void> {
  const { user, token } = await tx((db) => signIn(db, body), { lock: false });
  res.setHeader("Set-Cookie", sessionCookie(token));
  sendJson(res, 200, { user });
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    const method = req.method ?? "GET";
    const found = match(method, url.pathname);
    const isSignIn = method === "POST" && url.pathname === "/api/session";
    const parsed = await parseJson(req, found?.route.limit ?? BODY_LIMIT).then(
      (body) => ({ body, invalid: null as ValidationError | null }),
      (error: unknown) => {
        if (error instanceof ValidationError) return { body: {}, invalid: error };
        throw error;
      },
    );
    if (!isReady()) throw databaseUnavailable();
    if (isSignIn) {
      if (parsed.invalid) throw parsed.invalid;
      return await sessionEndpoint(res, parsed.body);
    }
    if (!found) throw notFound();
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    const user = await read((db) => sessionUser(db, token));
    if (!user) throw notSignedIn();
    const { route, params } = found;
    if (route.roles !== "signed-in" && !route.roles.includes(user.role)) throw forbidden();
    // A path id holding a NUL byte names no record: 404 after the 401 and 403 checks, before 422.
    if (params.some((param) => param.includes("\0"))) throw notFound();
    if (parsed.invalid) throw parsed.invalid;
    await lapseClosedWindows();
    const reply = await route.handle({ user, token: token!, params, query: url.searchParams, body: parsed.body });
    if ("bytes" in reply) sendBytes(res, reply.status, reply.bytes, reply.headers);
    else if (reply.status === 204) res.writeHead(204, reply.headers).end();
    else sendJson(res, reply.status, reply.body);
  } catch (error) {
    if (error instanceof ApiError || error instanceof ValidationError) return sendError(res, error);
    if (/^(08|57P)|^ECONN|^ETIMEDOUT$/.test(String((error as { code?: unknown }).code ?? ""))) {
      return sendError(res, databaseUnavailable());
    }
    console.error(error);
    sendError(res, new ApiError(500, "internal_error", "Something went wrong on the server."));
  }
}

