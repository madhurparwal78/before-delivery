// Every /api endpoint, who may call it, and the order its errors are checked in.
import type { IncomingMessage, ServerResponse } from "node:http";
import { flagShort, listBags, listFlags, packItem } from "./bags.js";
import { creditOf } from "./credit.js";
import {
  applyEdit, bumpRevision, checkEditable, checkRevision, createDraft, cycleJson, cycleProducts, cycleRow, cycleSummary,
  etag, givenFields, readCycleFields, visibleCycle, visibleCycles,
} from "./cycles.js";
import { all, isBusy, databaseBusy, one, transaction } from "./db.js";
import { checkUpload, type DocumentKind, downloadDocument, listDocuments, UPLOAD_LIMIT, uploadDocument } from "./documents.js";
import { ApiError, forbidden, invalid, notFound, type Reply } from "./errors.js";
import { checkOrigin, JSON_LIMIT, parseJson, readBody, sendReply } from "./http.js";
import { attempt, idempotencyKey, idempotentCall, idempotentWrite } from "./idempotency.js";
import { paymentsStatus } from "./killbill.js";
import { historyPage } from "./ledger.js";
import { sendQueuedMail } from "./mail.js";
import { lineShares, pledgesByDay, resolveLine, setPledge, withdrawPledge } from "./pledges.js";
import { allow, currentViewer, signIn, signOut, type Viewer, viewerJson } from "./session.js";
import { householdRow } from "./households.js";
import { recordShort } from "./shipments.js";
import { listTopUps, topUp } from "./topups.js";
import { closeCycle, receiptsOf, transition } from "./transitions.js";

interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  params: string[];
  raw: Buffer;
  body: Record<string, unknown>;
  viewer: Viewer;
  url: URL;
  upload: ReturnType<typeof checkUpload> | null;
}

type Handler = (ctx: Context) => Reply | Promise<Reply> | null | Promise<null>;

interface Route {
  method: string;
  pattern: RegExp;
  handle: Handler;
  open?: boolean;
  upload?: boolean;
}

const ok = (body: unknown, headers?: Record<string, string>): Reply => ({ status: 200, body, ...(headers ? { headers } : {}) });

function club() {
  return one<{ name: string; time_zone: string; distributor: string }>("SELECT name, time_zone, distributor FROM club")!;
}

const ID = "([^/]+)";

const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/api\/health$/, open: true, handle: () => ok({ status: "ok" }) },
  {
    method: "POST",
    pattern: /^\/api\/session$/,
    open: true,
    handle: ({ body }) => {
      const { viewer, cookie } = transaction(() => signIn(body.code));
      return { status: 200, body: viewerJson(viewer), headers: { "Set-Cookie": cookie } };
    },
  },
  { method: "GET", pattern: /^\/api\/me$/, handle: ({ viewer }) => ok(viewerJson(viewer)) },
  {
    method: "DELETE",
    pattern: /^\/api\/session$/,
    handle: ({ req }) => ({ status: 204, headers: { "Set-Cookie": transaction(() => signOut(req)) } }),
  },
  { method: "GET", pattern: /^\/api\/club$/, handle: () => ok(club()) },
  {
    method: "GET",
    pattern: /^\/api\/catalog$/,
    handle: ({ viewer }) => {
      allow(viewer, "coordinator");
      return ok({ products: all("SELECT id, case_name, pack, unit, price_cents FROM products ORDER BY position") });
    },
  },
  { method: "GET", pattern: /^\/api\/cycles$/, handle: ({ viewer }) => ok({ cycles: visibleCycles(viewer).map(cycleSummary) }) },
  {
    method: "POST",
    pattern: /^\/api\/cycles$/,
    handle: ({ viewer, body }) =>
      transaction(() => {
        allow(viewer, "coordinator");
        const edit = readCycleFields({ ...body, name: body.name }, { cutoff_at: null, pickup_start_at: null, pickup_end_at: null }, "save", []);
        const c = createDraft({ ...edit, name: edit.name! });
        const created = cycleRow(c.id)!;
        return { status: 201, body: cycleJson(created, viewer), headers: { ETag: etag(created) } };
      }),
  },
  {
    method: "GET",
    pattern: new RegExp(`^/api/cycles/${ID}$`),
    handle: ({ viewer, params }) => {
      const c = visibleCycle(params[0]!, viewer);
      return ok(cycleJson(c, viewer), { ETag: etag(c) });
    },
  },
  {
    method: "PATCH",
    pattern: new RegExp(`^/api/cycles/${ID}$`),
    handle: ({ viewer, params, req, body }) =>
      transaction(() => {
        const c = visibleCycle(params[0]!, viewer);
        allow(viewer, "coordinator");
        checkRevision(req, c);
        const mode = checkEditable(c, givenFields(body));
        applyEdit(c, readCycleFields(body, c, mode, cycleProducts(c.id)));
        bumpRevision(c);
        const saved = cycleRow(c.id)!;
        return ok(cycleJson(saved, viewer), { ETag: etag(saved) });
      }),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/cycles/${ID}/transitions$`),
    handle: async ({ viewer, params, req, body, raw }) => {
      const closing = body.to === "closed";
      const key = idempotencyKey(req, closing);
      const a = key === null ? null : attempt(viewer.person, key, req, raw.toString("utf8"));
      if (closing) {
        const reply = await idempotentCall(a!, () => closeCycle(viewer, params[0]!, key!));
        sendQueuedMail();
        return reply;
      }
      return idempotentWrite(a, () => transition(viewer, req, params[0]!, body));
    },
  },
  {
    method: "PUT",
    pattern: new RegExp(`^/api/cycles/${ID}/lines/${ID}/pledge$`),
    handle: ({ viewer, params, req, body, raw }) => {
      const a = attempt(viewer.person, idempotencyKey(req, true)!, req, raw.toString("utf8"));
      return idempotentWrite(a, () => setPledge(viewer, params[0]!, params[1]!, body));
    },
  },
  {
    method: "DELETE",
    pattern: new RegExp(`^/api/cycles/${ID}/lines/${ID}/pledge$`),
    handle: ({ viewer, params, req, raw }) => {
      const a = attempt(viewer.person, idempotencyKey(req, true)!, req, raw.toString("utf8"));
      return idempotentWrite(a, () => withdrawPledge(viewer, params[0]!, params[1]!));
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^/api/cycles/${ID}/lines/${ID}/shares$`),
    handle: ({ viewer, params }) => lineShares(viewer, params[0]!, params[1]!),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/cycles/${ID}/lines/${ID}/resolution$`),
    handle: ({ viewer, params, body }) => transaction(() => resolveLine(viewer, params[0]!, params[1]!, body)),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/cycles/${ID}/lines/${ID}/shorts$`),
    handle: async ({ viewer, params, req, body, raw }) => {
      const a = attempt(viewer.person, idempotencyKey(req, true)!, req, raw.toString("utf8"));
      const reply = await idempotentWrite(a, () => recordShort(viewer, params[0]!, params[1]!, body));
      sendQueuedMail();
      return reply;
    },
  },
  {
    method: "PUT",
    pattern: new RegExp(`^/api/cycles/${ID}/documents/(invoice|packing-slip)$`),
    upload: true,
    handle: ({ viewer, params, raw, upload }) => uploadDocument(viewer, params[0]!, params[1] as DocumentKind, upload!, raw),
  },
  { method: "GET", pattern: new RegExp(`^/api/cycles/${ID}/documents$`), handle: ({ viewer, params }) => listDocuments(viewer, params[0]!) },
  {
    method: "GET",
    pattern: new RegExp(`^/api/cycles/${ID}/documents/${ID}$`),
    handle: async ({ viewer, params, res }) => {
      const doc = await downloadDocument(viewer, params[0]!, params[1]!);
      res
        .writeHead(200, {
          "Content-Type": doc.contentType,
          "Content-Disposition": `attachment; filename="${doc.filename}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          "Content-Length": String(doc.data.length),
        })
        .end(doc.data);
      return null;
    },
  },
  { method: "GET", pattern: new RegExp(`^/api/cycles/${ID}/bags$`), handle: ({ viewer, params }) => listBags(viewer, params[0]!) },
  {
    method: "PUT",
    pattern: new RegExp(`^/api/cycles/${ID}/bags/${ID}/items/${ID}$`),
    handle: ({ viewer, params, body }) => transaction(() => packItem(viewer, params[0]!, params[1]!, params[2]!, body)),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/cycles/${ID}/bags/${ID}/flags$`),
    handle: ({ viewer, params, body }) => transaction(() => flagShort(viewer, params[0]!, params[1]!, body)),
  },
  { method: "GET", pattern: new RegExp(`^/api/cycles/${ID}/flags$`), handle: ({ viewer, params }) => listFlags(viewer, params[0]!) },
  {
    method: "GET",
    pattern: new RegExp(`^/api/cycles/${ID}/daily$`),
    handle: ({ viewer, params }) => pledgesByDay(viewer, params[0]!, club().time_zone),
  },
  { method: "GET", pattern: new RegExp(`^/api/cycles/${ID}/receipts$`), handle: ({ viewer, params }) => receiptsOf(viewer, params[0]!) },
  {
    method: "POST",
    pattern: /^\/api\/topups$/,
    handle: ({ viewer, req, body, raw }) => {
      const key = idempotencyKey(req, true)!;
      return idempotentCall(attempt(viewer.person, key, req, raw.toString("utf8")), () => topUp(viewer, key, body));
    },
  },
  { method: "GET", pattern: /^\/api\/topups$/, handle: ({ viewer }) => listTopUps(viewer) },
  { method: "GET", pattern: /^\/api\/payments\/status$/, handle: async () => ok({ payments: await paymentsStatus() }) },
  {
    method: "GET",
    pattern: new RegExp(`^/api/households/${ID}/ledger$`),
    handle: ({ viewer, params, url }) => {
      const code = params[0]!;
      if (!householdRow(code)) throw notFound("No such household.");
      if (!(viewer.role === "coordinator" || (viewer.role === "member" && viewer.household_code === code))) throw forbidden();
      const limitText = url.searchParams.get("limit");
      const limit = limitText === null ? 20 : /^\d+$/.test(limitText) ? Number(limitText) : 0;
      if (limit < 1 || limit > 50) throw invalid("limit", "Ask for 1 to 50 movements.");
      const page = historyPage(code, limit, url.searchParams.get("before"));
      return ok({ household_code: code, ...creditOf(code), ...page });
    },
  },
];

function match(method: string, pathname: string): { route: Route; params: string[] } | null {
  for (const route of ROUTES) {
    const found = route.method === method ? route.pattern.exec(pathname) : null;
    if (found) return { route, params: found.slice(1).map(decodeURIComponent) };
  }
  return null;
}

/** Errors are checked in the published order: 413, 415, 401, then each endpoint's own order. */
async function answer(req: IncomingMessage, res: ServerResponse): Promise<Reply | null> {
  checkOrigin(req);
  const url = new URL(req.url ?? "/", "http://local");
  const found = match(req.method ?? "GET", url.pathname);
  if (!found) {
    req.resume();
    throw notFound("No such endpoint.");
  }
  const { route, params } = found;
  const raw = await readBody(req, route.upload ? UPLOAD_LIMIT : JSON_LIMIT);
  const body = route.upload ? {} : parseJson(req, raw);
  const upload = route.upload ? checkUpload(params[1] as DocumentKind, req.headers["content-type"], raw) : null;
  const viewer = route.open ? null : currentViewer(req);
  if (!route.open && !viewer) throw new ApiError(401, "unauthenticated", "Sign in first.");
  return route.handle({ req, res, params, raw, body, viewer: viewer!, url, upload });
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let reply: Reply | null;
  try {
    reply = await answer(req, res);
  } catch (error) {
    if (error instanceof ApiError) reply = error.toReply();
    else if (isBusy(error)) reply = databaseBusy().toReply();
    else {
      console.error(error);
      reply = new ApiError(500, "internal", "Something went wrong on the server.").toReply();
    }
  }
  if (reply) sendReply(res, reply);
}

