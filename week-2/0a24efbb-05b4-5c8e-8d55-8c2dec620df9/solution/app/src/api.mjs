import { trailCsv, verifyTrail, wholeTrail } from "./audit.mjs";
import { health } from "./boot.mjs";
import { calendar } from "./calendar.mjs";
import { config } from "./config.mjs";
import { requireStoreReached } from "./db.mjs";
import { NotReady, Refusal, WORDING, jsonBody, refuse } from "./http.mjs";
import { etagOf, policyHistory, readPolicy, savePolicy } from "./policy.mjs";
import { cancel, decide, detail, queue, raise, readQueueQuery } from "./requests.mjs";
import { SESSION_COOKIE, endSession, presentedToken, requireCaller, signIn } from "./sessions.mjs";
import { mintShareLink, revokeShareLink } from "./share.mjs";

// The API surface is exactly this table. Each method says whether it needs a session and whether it needs a body.

const ROUTES = [
  ["/api/health", {
    GET: { open: true, run: async () => {
      const flags = await health();
      if (!(flags.schema && flags.seeded && flags.realm)) throw new NotReady(flags);
      return { body: { status: "ok", ...flags } };
    } },
  }],
  ["/api/session", {
    POST: { open: true, body: "required", run: async ({ body, token }) => {
      const signedIn = await signIn(body, token);
      return {
        body: signedIn,
        headers: {
          "set-cookie": `${SESSION_COOKIE}=${signedIn.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionMaxSeconds}`,
        },
      };
    } },
    GET: { run: async ({ caller }) => ({
      body: { person: { name: caller.name, work_address: caller.workAddress }, role: caller.role },
    }) },
    DELETE: { run: async ({ token }) => {
      await endSession(token);
      return { status: 204, headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
    } },
  }],
  ["/api/requests", {
    GET: { run: async ({ caller, search }) => ({ body: await queue(caller, readQueueQuery(search)) }) },
    POST: { body: "required", run: async ({ caller, body, headers }) => {
      const { status, request, replayed } = await raise(caller, body, headers["idempotency-key"]);
      return { status, body: request, headers: replayed ? { "idempotent-replayed": "true" } : {} };
    } },
  }],
  [/^\/api\/requests\/([^/]+)$/, {
    GET: { run: async ({ caller, segment }) => ({ body: await detail(caller, segment) }) },
  }],
  [/^\/api\/requests\/([^/]+)\/decision$/, {
    POST: { body: "required", run: async ({ caller, segment, body }) => ({ body: await decide(caller, segment, body) }) },
  }],
  [/^\/api\/requests\/([^/]+)\/cancel$/, {
    POST: { run: async ({ caller, segment, body }) => ({ body: await cancel(caller, segment, body) }) },
  }],
  ["/api/policy", {
    GET: { run: async () => {
      const policy = await readPolicy();
      return { body: policy, headers: { etag: etagOf(policy.version) } };
    } },
    PUT: { body: "required", run: async ({ caller, body, headers }) => {
      const policy = await savePolicy(caller, body, headers["if-match"]);
      return { status: 201, body: policy, headers: { etag: etagOf(policy.version) } };
    } },
  }],
  ["/api/policy/history", {
    GET: { run: async ({ caller }) => {
      const versions = await policyHistory(caller);
      return { body: { versions }, headers: { etag: etagOf(versions[0].version) } };
    } },
  }],
  ["/api/audit", {
    GET: { run: async ({ caller }) => ({ body: { entries: await wholeTrail(caller) } }) },
  }],
  ["/api/trail.csv", {
    GET: { run: async ({ caller }) => ({
      body: await trailCsv(caller),
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="trail.csv"' },
    }) },
  }],
  ["/api/trail/verify", {
    GET: { run: async ({ caller }) => ({ body: await verifyTrail(caller) }) },
  }],
  ["/api/calendar", {
    GET: { run: async ({ caller, search }) => ({ body: await calendar(caller, search) }) },
  }],
  ["/api/share-links", {
    POST: { body: "required", run: async ({ caller, body }) => ({ status: 201, body: await mintShareLink(caller, body) }) },
  }],
  [/^\/api\/share-links\/([^/]+)$/, {
    DELETE: { run: async ({ caller, segment, body }) => {
      await revokeShareLink(caller, segment, body);
      return { status: 204 };
    } },
  }],
];

function match(path) {
  for (const [pattern, methods] of ROUTES) {
    if (typeof pattern === "string" ? pattern === path : pattern.test(path)) {
      return { methods, segment: typeof pattern === "string" ? undefined : pattern.exec(path)[1] };
    }
  }
  return null;
}

/** Send any refusal; anything else the desk could not complete becomes the bare 500. */
export function sendFailure(reply, error) {
  if (!(error instanceof Refusal)) {
    console.error(error);
    return sendFailure(reply, refuse(500, WORDING.failed));
  }
  return reply.code(error.status).headers(error.headers).send(error.body);
}

/** Answer one `/api` call: path, method, session, body, then the endpoint's own order. */
export async function dispatch(request, reply) {
  const [path, query = ""] = request.url.split(/\?(.*)/s);
  try {
    if (path !== "/api/health") await requireStoreReached();
    const found = match(path);
    if (!found) throw refuse(404, WORDING.noEndpoint);
    const handler = found.methods[request.method === "HEAD" ? "GET" : request.method];
    if (!handler) {
      const allow = Object.keys(found.methods);
      if (allow.includes("GET")) allow.push("HEAD");
      throw refuse(405, WORDING.noMethod, {}, { allow: allow.join(", ") });
    }
    const token = presentedToken(request.headers);
    const caller = handler.open ? null : await requireCaller(token);
    const body = jsonBody(request);
    if (body === undefined && handler.body === "required") throw refuse(400, WORDING.notObject);
    const result = await handler.run({
      caller, token, body, search: query, segment: found.segment, headers: request.headers,
    });
    reply.code(result.status ?? 200).headers(result.headers ?? {});
    return result.body === undefined ? reply.send() : reply.send(result.body);
  } catch (error) {
    return sendFailure(reply, error);
  }
}
