import type { IncomingMessage } from "node:http";

import { copy } from "../src/shared/hour";
import { clearTestClock, now, parseInstant, setTestClock } from "./clock";
import { config } from "./config";
import { ensureDatabase } from "./db";
import { KEY_PATTERN } from "./guards";
import { ApiError, assertSameOrigin, invalid, isObject, readBody, unaccepted, type Reply } from "./http";
import { createDraft, createShare, eraseVisitor, keepingTonight, readPlan, readShared, revokeShare, updatePlan } from "./plans";
import { sendDueReminders } from "./reminders";
import { clearedSession, endSession, requestSignIn, verifyLink, visitorOf } from "./sessions";

interface Call {
  request: IncomingMessage;
  body: unknown;
  match: RegExpExecArray;
}

type Handler = (call: Call) => Promise<Reply>;

interface Route {
  path: RegExp;
  methods: Partial<Record<string, Handler>>;
  /** Data routes answer 503 while the database is unreachable; health never touches it. */
  data: boolean;
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function idempotencyKey(request: IncomingMessage) {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) throw new ApiError("idempotency_key_required");
  return key;
}

const signedIn = (handler: (visitorId: string, call: Call) => Promise<Reply>): Handler =>
  async (call) => handler(await visitorOf(call.request), call);

const routes: Route[] = [
  { path: /^\/api\/health$/, data: false, methods: { GET: async () => ({ status: 200, body: { status: "ok" } }) } },
  { path: /^\/api\/tonight$/, data: true, methods: { GET: () => keepingTonight() } },
  { path: /^\/api\/plans$/, data: true, methods: { POST: async ({ request, body }) => createDraft(body, idempotencyKey(request)) } },
  { path: /^\/api\/session\/request$/, data: true, methods: { POST: ({ body }) => requestSignIn(body) } },
  { path: /^\/api\/session\/verify$/, data: true, methods: { POST: ({ body }) => verifyLink(body) } },
  { path: /^\/api\/session\/end$/, data: true, methods: { POST: ({ request }) => endSession(request) } },
  {
    path: /^\/api\/me\/plan$/,
    data: true,
    methods: {
      GET: signedIn((visitorId) => readPlan(visitorId)),
      PATCH: signedIn((visitorId, { request, body }) => {
        const ifMatch = request.headers["if-match"];
        return updatePlan(visitorId, body, Array.isArray(ifMatch) ? ifMatch.join(",") : ifMatch);
      }),
    },
  },
  {
    path: /^\/api\/me\/share$/,
    data: true,
    methods: { POST: signedIn((visitorId) => createShare(visitorId)), DELETE: signedIn((visitorId) => revokeShare(visitorId)) },
  },
  {
    path: /^\/api\/me$/,
    data: true,
    methods: {
      DELETE: signedIn(async (visitorId) => ({ ...(await eraseVisitor(visitorId)), headers: clearedSession() })),
    },
  },
  { path: /^\/api\/share\/([^/]+)$/, data: true, methods: { GET: ({ match }) => readShared(match[1]) } },
];

if (config.testClock) {
  routes.push({
    path: /^\/api\/test\/clock$/,
    data: true,
    methods: {
      PUT: async ({ body }) => {
        const fields = isObject(body) ? unaccepted(body, ["now"]) : {};
        const instant = parseInstant(isObject(body) ? body.now : undefined);
        if (!instant) fields.now = copy.now;
        if (!instant || Object.keys(fields).length) throw invalid(fields);
        await setTestClock(instant);
        await sendDueReminders();
        return { status: 200, body: { now: now().toISOString() } };
      },
      DELETE: async () => {
        await clearTestClock();
        return { status: 204 };
      },
    },
  });
}

/**
 * Answers one /api request, checking in the published order: unknown path 404, wrong method 405,
 * cross-origin write 403, then the body (415, 413, 400), then 503 on a data route while the database is
 * unreachable; each handler then checks its session, key, resources, versions, rules and limits.
 */
export async function handleApi(request: IncomingMessage, pathname: string): Promise<Reply> {
  for (const route of routes) {
    const match = route.path.exec(pathname);
    if (!match) continue;
    const method = request.method === "HEAD" ? "GET" : (request.method ?? "GET");
    const handler = route.methods[method];
    if (!handler) throw new ApiError("method_not_allowed", undefined, { allow: Object.keys(route.methods).join(", ") });
    const writes = WRITES.has(method);
    if (writes) assertSameOrigin(request);
    const body = writes ? await readBody(request) : undefined;
    if (route.data) await ensureDatabase();
    return handler({ request, body, match });
  }
  throw new ApiError("not_found");
}
