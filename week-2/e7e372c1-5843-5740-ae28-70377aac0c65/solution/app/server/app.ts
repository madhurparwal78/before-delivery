// The HTTP surface: routing, boundary checks in the order the brief fixes, and every handler.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { boardPayload, citationPayload } from "./board.ts";
import { headerValue, parseJsonObject, readBody, refuseCrossSiteWrite } from "./boundary.ts";
import { isCalendarYear2026, sessionDay } from "./calendar.ts";
import { readMarketClock, setMarketClock } from "./clock.ts";
import { computationById } from "./computations.ts";
import { database, one, withTransaction } from "./db.ts";
import type { Config } from "./config.ts";
import { Refusal, failure, type Failure } from "./errors.ts";
import { answerExhibit, contentRange, exhibitHeaders, visibleExhibit } from "./exhibitAccess.ts";
import { uploadExhibit } from "./exhibitUpload.ts";
import { auditTrail, findRestatement, viewOf } from "./restatements.ts";
import { authenticate, clearedCookieHeader, cookieHeaderFor, endSession, signIn, type AuthenticatedSession } from "./sessions.ts";
import { staticFor } from "./staticFiles.ts";
import { currentTickKey, ingestTick } from "./ticks.ts";
import { readTape, setTapeState } from "./tape.ts";
import { getObject } from "./vault.ts";
import {
  clearRestatement,
  createRestatement,
  listRestatementViews,
  releaseRestatement,
  returnRestatement,
  saveRestatement,
  submitRestatement,
  withdrawRestatement,
} from "./workflow.ts";
import { formatCalendarDate, formatInstant, parseCalendarDate } from "../shared/newyork.ts";
import type { Role } from "../shared/domain.ts";
import type { Actor } from "../shared/restatementRules.ts";

interface Reply {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  raw?: Buffer | string;
}

interface Context {
  request: IncomingMessage;
  url: URL;
  params: string[];
  body: Record<string, unknown>;
  raw: Buffer;
  session: AuthenticatedSession | null;
}

type BodyKind = "json" | "pdf" | "none";
type Access = "public" | "staff" | Role;

interface Route {
  method: string;
  pattern: RegExp;
  body: BodyKind;
  access: Access;
  handle: (context: Context) => Promise<Reply>;
}

function actorOf(context: Context): Actor {
  if (!context.session) throw new Refusal("unauthenticated");
  return { id: context.session.user.id, roles: context.session.user.roles };
}

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,100}$/;

export function createApp(config: Config): Server {
  const routes: Route[] = [
    {
      method: "GET",
      pattern: /^\/api\/health$/,
      body: "none",
      access: "public",
      handle: async () => {
        await one(database(), "SELECT 1");
        return { status: 200, json: { status: "ok" } };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/session$/,
      body: "json",
      access: "public",
      handle: async ({ body }) => {
        const fields: Record<string, string> = {};
        if (typeof body["email"] !== "string" || body["email"] === "") fields["email"] = "Enter your email.";
        if (typeof body["password"] !== "string" || body["password"] === "") fields["password"] = "Enter your password.";
        if (typeof body["email"] !== "string" || typeof body["password"] !== "string" || Object.keys(fields).length > 0) throw new Refusal("validation_failed", fields);
        const signedIn = await signIn(body["email"], body["password"]);
        if (!signedIn) throw new Refusal("invalid_credentials");
        return { status: 200, headers: { "set-cookie": cookieHeaderFor(signedIn.cookie) }, json: { user: signedIn.user } };
      },
    },
    { method: "GET", pattern: /^\/api\/session$/, body: "none", access: "staff", handle: async ({ session }) => ({ status: 200, json: { user: session?.user } }) },
    {
      method: "DELETE",
      pattern: /^\/api\/session$/,
      body: "none",
      access: "public",
      handle: async ({ request }) => {
        const session = await authenticate(request.headers.cookie);
        if (session) await endSession(session.sessionId);
        return { status: 204, headers: { "set-cookie": clearedCookieHeader() } };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/clock$/,
      body: "none",
      access: "public",
      handle: async () => {
        const clock = await readMarketClock(database());
        return { status: 200, json: { now: formatInstant(clock.now), rehearsal: clock.rehearsal } };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/session-calendar$/,
      body: "none",
      access: "public",
      handle: async ({ url }) => {
        const asked = url.searchParams.get("date") ?? "";
        const date = parseCalendarDate(asked);
        if (!date || !isCalendarYear2026(asked)) throw new Refusal("validation_failed", { date: "Use a date in 2026 as YYYY-MM-DD." });
        const day = sessionDay(formatCalendarDate(date));
        return {
          status: 200,
          json: {
            date: day.date,
            trading_day: day.tradingDay,
            holiday: day.holiday,
            opens_at: day.opensAt === null ? null : formatInstant(day.opensAt),
            closes_at: day.closesAt === null ? null : formatInstant(day.closesAt),
            early_close: day.earlyClose,
          },
        };
      },
    },
    { method: "GET", pattern: /^\/api\/board$/, body: "none", access: "public", handle: async () => ({ status: 200, json: await boardPayload(config.ethStaleSeconds) }) },
    {
      method: "GET",
      pattern: /^\/api\/computations\/([^/]+)$/,
      body: "none",
      access: "public",
      handle: async ({ params }) => {
        const computation = await computationById(database(), params[0] ?? "");
        if (!computation) throw new Refusal("not_found");
        return { status: 200, json: { computation } };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/citations\/([^/]+)\/([^/]+)$/,
      body: "none",
      access: "public",
      handle: async ({ params }) => ({ status: 200, json: await citationPayload(params[0] ?? "", params[1] ?? "") }),
    },
    {
      method: "GET",
      pattern: /^\/api\/exhibits\/([^/]+)$/,
      body: "none",
      access: "public",
      handle: async ({ request, params }) => exhibitReply(request, params[0] ?? ""),
    },
    {
      method: "GET",
      pattern: /^\/api\/restatements$/,
      body: "none",
      access: "staff",
      handle: async () => ({ status: 200, json: { restatements: await listRestatementViews() } }),
    },
    {
      method: "POST",
      pattern: /^\/api\/restatements$/,
      body: "json",
      access: "staff",
      handle: async (context) => ({ status: 201, json: { restatement: await createRestatement(actorOf(context), context.body) } }),
    },
    {
      method: "GET",
      pattern: /^\/api\/restatements\/([^/]+)$/,
      body: "none",
      access: "staff",
      handle: async ({ params }) => {
        const restatement = await withTransaction((tx) => findRestatement(tx, params[0] ?? "").then((found) => (found ? viewOf(tx, found) : null)));
        if (!restatement) throw new Refusal("not_found");
        return { status: 200, json: { restatement } };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/restatements\/([^/]+)\/audit$/,
      body: "none",
      access: "staff",
      handle: async ({ params }) => {
        const exists = await withTransaction((tx) => findRestatement(tx, params[0] ?? ""));
        if (!exists) throw new Refusal("not_found");
        return { status: 200, json: { entries: await auditTrail(database(), exists.id) } };
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/restatements\/([^/]+)$/,
      body: "json",
      access: "staff",
      handle: async (context) => ({ status: 200, json: { restatement: await saveRestatement(actorOf(context), context.params[0] ?? "", context.body) } }),
    },
    {
      method: "PUT",
      pattern: /^\/api\/restatements\/([^/]+)\/exhibit$/,
      body: "pdf",
      access: "staff",
      handle: async (context) => {
        const stored = await uploadExhibit(actorOf(context), context.params[0] ?? "", context.raw, headerValue(context.request, "X-Exhibit-SHA256"));
        return { status: 201, json: { restatement: await withTransaction((tx) => viewOf(tx, stored)) } };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/restatements\/([^/]+)\/submit$/,
      body: "json",
      access: "staff",
      handle: async (context) => ({ status: 200, json: { restatement: await submitRestatement(actorOf(context), context.params[0] ?? "") } }),
    },
    {
      method: "POST",
      pattern: /^\/api\/restatements\/([^/]+)\/return$/,
      body: "json",
      access: "staff",
      handle: async (context) => ({ status: 200, json: { restatement: await returnRestatement(actorOf(context), context.params[0] ?? "", context.body) } }),
    },
    {
      method: "POST",
      pattern: /^\/api\/restatements\/([^/]+)\/clear$/,
      body: "json",
      access: "staff",
      handle: async (context) => ({ status: 200, json: { restatement: await clearRestatement(actorOf(context), context.params[0] ?? "", context.body) } }),
    },
    {
      method: "POST",
      pattern: /^\/api\/restatements\/([^/]+)\/release$/,
      body: "json",
      access: "staff",
      handle: async (context) => {
        const key = headerValue(context.request, "Idempotency-Key");
        if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) throw new Refusal("validation_failed", { "Idempotency-Key": "Use 1 to 100 visible ASCII characters." });
        const released = await releaseRestatement(actorOf(context), context.params[0] ?? "", context.body, key);
        return { status: released.status, raw: released.body, headers: { "content-type": "application/json; charset=utf-8" } };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/restatements\/([^/]+)\/withdraw$/,
      body: "json",
      access: "staff",
      handle: async (context) => ({ status: 200, json: { restatement: await withdrawRestatement(actorOf(context), context.params[0] ?? "", context.body) } }),
    },
    { method: "GET", pattern: /^\/api\/operator\/tape$/, body: "none", access: "operator", handle: async () => ({ status: 200, json: await readTape() }) },
    {
      method: "PUT",
      pattern: /^\/api\/operator\/tape$/,
      body: "json",
      access: "operator",
      handle: async ({ body }) => {
        const state = body["state"];
        if (state !== "playing" && state !== "paused") throw new Refusal("validation_failed", { state: "Use playing or paused." });
        return { status: 200, json: await setTapeState(state) };
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/operator\/clock$/,
      body: "json",
      access: "operator",
      handle: async ({ body }) => {
        const at = body["at"];
        const instant = at === null ? null : typeof at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at) ? Date.parse(at) : Number.NaN;
        if (instant !== null && Number.isNaN(instant)) throw new Refusal("validation_failed", { at: "Use an ISO 8601 instant or null." });
        await setMarketClock(database(), instant);
        const clock = await readMarketClock(database());
        return { status: 200, json: { now: formatInstant(clock.now), rehearsal: clock.rehearsal } };
      },
    },
    { method: "GET", pattern: /^\/api\/operator\/tick-key$/, body: "none", access: "operator", handle: async () => ({ status: 200, json: { key: currentTickKey() } }) },
    {
      method: "POST",
      pattern: /^\/api\/internal\/ticks$/,
      body: "json",
      access: "public",
      handle: async ({ request, body, raw }) => {
        const result = await ingestTick(raw, body, headerValue(request, "X-Tick-Signature"));
        return { status: result.status, json: { tick: result.tick } };
      },
    },
  ];

  async function exhibitReply(request: IncomingMessage, sha256: string): Promise<Reply> {
    const session = await authenticate(request.headers.cookie);
    const exhibit = await visibleExhibit(database(), sha256, session !== null);
    if (!exhibit) throw new Refusal("not_found");
    const headers = exhibitHeaders(exhibit);
    const answer = answerExhibit(exhibit, { ifNoneMatch: headerValue(request, "If-None-Match"), range: headerValue(request, "Range") });
    if (answer.kind === "not_modified") return { status: 304, headers: headers.standing };
    if (answer.kind === "unsatisfiable") {
      return { status: 416, headers: { ...headers.standing, "Content-Range": contentRange(answer, exhibit.bytes) }, json: failure("range_not_satisfiable").body };
    }
    let bytes: Buffer;
    try {
      bytes = await getObject(exhibit.key);
    } catch (error) {
      if (error instanceof Refusal) return { status: error.failure.status, headers: headers.standing, json: error.failure.body };
      throw error;
    }
    if (answer.kind === "partial") {
      return { status: 206, headers: { ...headers.body, "Content-Range": contentRange(answer, exhibit.bytes) }, raw: bytes.subarray(answer.first, answer.last + 1) };
    }
    return { status: 200, headers: headers.body, raw: bytes };
  }

  /** A path segment as text; one that cannot be decoded, or holds a NUL, names nothing, so it is refused before any lookup. */
  function pathParam(part: string): string {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new Refusal("not_found");
    }
    if (decoded.includes("\u0000")) throw new Refusal("not_found");
    return decoded;
  }

  async function dispatch(request: IncomingMessage, url: URL): Promise<Reply> {
    refuseCrossSiteWrite(request.method ?? "GET", request.headers);
    const candidates = routes.filter((route) => route.pattern.test(url.pathname));
    if (candidates.length === 0) throw new Refusal("not_found");
    const route = candidates.find((candidate) => candidate.method === request.method);
    if (!route) throw new Refusal("method_not_allowed");
    let raw: Buffer = Buffer.alloc(0);
    let body: Record<string, unknown> = {};
    if (route.body !== "none") {
      raw = await readBody(request, route.body);
      if (route.body === "json") body = parseJsonObject(raw);
    }
    const session = route.access === "public" ? null : await authenticate(request.headers.cookie);
    if (route.access !== "public") {
      if (!session) throw new Refusal("unauthenticated");
      if (route.access !== "staff" && !session.user.roles.includes(route.access)) throw new Refusal("forbidden");
    }
    const params = (route.pattern.exec(url.pathname) ?? []).slice(1).map(pathParam);
    return route.handle({ request, url, params, body, raw, session });
  }

  function write(response: ServerResponse, reply: Reply): void {
    const headers: Record<string, string> = { "cache-control": "no-store" };
    for (const [name, value] of Object.entries(reply.headers ?? {})) headers[name.toLowerCase()] = value;
    if (reply.json !== undefined) {
      headers["content-type"] = "application/json; charset=utf-8";
      response.writeHead(reply.status, headers);
      response.end(JSON.stringify(reply.json));
      return;
    }
    response.writeHead(reply.status, headers);
    response.end(reply.raw);
  }

  function writeFailure(response: ServerResponse, refused: Failure): void {
    write(response, { status: refused.status, json: refused.body });
  }

  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://placeholder");
    const handle = async (): Promise<void> => {
      if (!url.pathname.startsWith("/api/")) {
        const file = request.method === "GET" || request.method === "HEAD" ? staticFor(url.pathname) : null;
        if (!file) return writeFailure(response, failure("not_found"));
        response.writeHead(200, { "content-type": file.type, "cache-control": file.immutable ? "public, max-age=31536000, immutable" : "no-cache", "x-content-type-options": "nosniff" });
        return void response.end(request.method === "HEAD" ? undefined : file.body);
      }
      try {
        write(response, await dispatch(request, url));
      } catch (error) {
        if (error instanceof Refusal) writeFailure(response, error.failure);
        else {
          process.stderr.write(`request failed: ${error instanceof Error ? error.name : "unknown"}\n`);
          writeFailure(response, failure("internal"));
        }
      }
    };
    handle().catch(() => {
      if (!response.headersSent) writeFailure(response, failure("internal"));
    });
  });
}

