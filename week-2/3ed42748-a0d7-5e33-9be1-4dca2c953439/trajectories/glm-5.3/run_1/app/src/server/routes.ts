import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db, Tx } from "./db.js";
import { Errors, ApiError } from "./errors.js";
import type { AppConfig } from "./config.js";
import { courierForSession, serializeMe, type CourierRow } from "./domain.js";
import { checkContentType, isForeignOrigin, readBody, sendBytes, sendHtml, sendJson, escapeHtml, base } from "./http-util.js";
import { MAX_JSON_BYTES, MAX_PNG_BYTES, parseJsonBody, validTicket, findUnknownKeys, validateEmailField } from "./validate.js";
import * as api from "./api.js";
import * as founder from "./api-founder.js";
import { onlineNow, sweepPresence } from "./presence.js";
import { promoteDueMissions } from "./missions.js";
import type { PostcardStore } from "./store.js";
import type { PostOffice } from "./mail.js";

// One dispatch for the whole API. The steps follow the error precedence exactly once each.

export type ServerDeps = {
  db: Db;
  cfg: AppConfig;
  store: PostcardStore;
  postOffice: PostOffice;
  dbReady: () => boolean;
};

type Role = "none" | "any" | "courier" | "staff" | "founder";

type Reply = {
  status: number;
  body?: string;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  cookies?: string[];
};

type HandlerArgs = {
  req: IncomingMessage;
  cfg: AppConfig;
  url: URL;
  tx: Tx;
  courier: CourierRow | null;
  sessionToken: string | null;
  body: Buffer;
  json: Record<string, unknown> | null;
  params: Record<string, string>;
  deps: ServerDeps;
  reqHeaders: IncomingMessage["headers"];
};

type Route = {
  method: string;
  pattern: RegExp;
  body: "json" | "png" | "none";
  role: Role;
  ticketHeader?: string;
  ifMatch?: boolean;
  noTx?: boolean; // health and status answer even while the database is down
  handler: (a: HandlerArgs) => Promise<Reply>;
};

const P = (path: string) => new RegExp(`^${path.replace(/\{(\w+)\}/g, (_s, k) => `(?<${k}>[^/]+)`)}$`);

const ROUTES: Route[] = [
  { method: "GET", pattern: P("/api/health"), body: "none", role: "none", noTx: true, handler: health },
  { method: "GET", pattern: P("/api/status"), body: "none", role: "none", noTx: true, handler: status },
  { method: "GET", pattern: P("/api/world"), body: "none", role: "none", handler: world },
  { method: "POST", pattern: P("/api/guest"), body: "json", role: "none", handler: guestStart },
  { method: "GET", pattern: P("/api/me"), body: "none", role: "any", handler: meGet },
  { method: "PATCH", pattern: P("/api/me"), body: "json", role: "any", handler: mePatch },
  { method: "GET", pattern: P("/api/me/ledger"), body: "none", role: "any", handler: ledgerGet },
  { method: "GET", pattern: P("/api/depot"), body: "none", role: "any", handler: depotGet },
  { method: "POST", pattern: P("/api/missions/{mission_id}/accept"), body: "json", role: "any", handler: accept },
  { method: "POST", pattern: P("/api/rush/{rush_id}/claim"), body: "json", role: "courier", handler: claim },
  { method: "POST", pattern: P("/api/acceptances/{acceptance_id}/drop"), body: "json", role: "any", handler: drop },
  { method: "POST", pattern: P("/api/deliveries"), body: "json", role: "any", ticketHeader: "Handover-Ticket", handler: deliver },
  { method: "GET", pattern: P("/api/outfitter"), body: "none", role: "any", handler: outfitterGet },
  { method: "POST", pattern: P("/api/outfitter/{satchel_id}/buy"), body: "json", role: "any", ticketHeader: "Purchase-Ticket", handler: buy },
  { method: "POST", pattern: P("/api/auth/postbox-key"), body: "json", role: "none", handler: postboxKey },
  { method: "POST", pattern: P("/api/auth/redeem"), body: "json", role: "none", handler: redeem },
  { method: "POST", pattern: P("/api/auth/sign-out"), body: "json", role: "any", handler: signOut },
  { method: "GET", pattern: P("/api/presence"), body: "none", role: "any", handler: presenceGet },
  { method: "POST", pattern: P("/api/presence"), body: "json", role: "any", handler: presencePost },
  { method: "GET", pattern: P("/api/postcards"), body: "none", role: "courier", handler: postcardsGet },
  { method: "POST", pattern: P("/api/postcards"), body: "png", role: "courier", handler: postcardsPost },
  { method: "DELETE", pattern: P("/api/postcards/{postcard_id}"), body: "none", role: "courier", handler: postcardDelete },
  { method: "POST", pattern: P("/api/postcards/{postcard_id}/mail"), body: "json", role: "courier", ticketHeader: "Mail-Ticket", handler: postcardMail },
  { method: "GET", pattern: P("/api/moderation/presence"), body: "none", role: "staff", handler: moderationPresence },
  { method: "POST", pattern: P("/api/moderation/{moderation_ref}/mute"), body: "json", role: "staff", handler: mute },
  { method: "POST", pattern: P("/api/moderation/{moderation_ref}/unmute"), body: "json", role: "staff", handler: unmute },
  { method: "POST", pattern: P("/api/moderation/{moderation_ref}/rename"), body: "json", role: "staff", handler: renameCourier },
  { method: "GET", pattern: P("/api/moderation/audit"), body: "none", role: "staff", handler: audit },
  { method: "GET", pattern: P("/api/founder/missions"), body: "none", role: "founder", handler: missionsGet },
  { method: "POST", pattern: P("/api/founder/missions"), body: "json", role: "founder", handler: missionsCreate },
  { method: "GET", pattern: P("/api/founder/missions/{mission_id}"), body: "none", role: "founder", handler: missionGet },
  { method: "PATCH", pattern: P("/api/founder/missions/{mission_id}"), body: "json", role: "founder", ifMatch: true, handler: missionPatch },
  { method: "POST", pattern: P("/api/founder/missions/{mission_id}/schedule"), body: "json", role: "founder", ifMatch: true, handler: missionSchedule },
  { method: "POST", pattern: P("/api/founder/missions/{mission_id}/unschedule"), body: "json", role: "founder", ifMatch: true, handler: missionUnschedule },
  { method: "POST", pattern: P("/api/founder/missions/{mission_id}/retire"), body: "json", role: "founder", ifMatch: true, handler: missionRetire },
  { method: "GET", pattern: P("/api/founder/studio"), body: "none", role: "founder", handler: studioGet },
  { method: "PATCH", pattern: P("/api/founder/studio"), body: "json", role: "founder", handler: studioPatch },
  { method: "GET", pattern: P("/api/founder/online"), body: "none", role: "founder", handler: onlineGet },
];

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function sessionCookie(token: string): string {
  return `pm_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${400 * 86400}`;
}

function clearCookie(): string {
  return "pm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function emit(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.cookies) headers["Set-Cookie"] = reply.cookies.join(", ");
  if (reply.bytes !== undefined) {
    sendBytes(res, reply.status, reply.bytes, reply.contentType ?? "application/octet-stream", headers);
    return;
  }
  sendJson(res, reply.status, reply.body ?? "", headers);
}

/** Handles an /api request. Returns false when the path isn't an API path. */
export async function handleApi(deps: ServerDeps, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  if (path !== "/api" && !path.startsWith("/api/")) return false;

  const matches = ROUTES.filter((r) => r.pattern.test(path));
  const route = matches.find((r) => r.method === req.method);
  const fail = (err: unknown): void => {
    if (err instanceof ApiError) emit(res, { status: err.status, body: err.body(), headers: err.headers });
    else {
      console.error("unexpected fault", err);
      emit(res, { status: 500, body: Errors.internal().body() });
    }
  };

  try {
    if (matches.length === 0) throw Errors.notFound();
    if (!route) throw Errors.methodNotAllowed();

    // 1. Cross-origin refusal for state-changing requests, before anything else.
    if (req.method !== "GET" && req.method !== "HEAD" && isForeignOrigin(deps.cfg, req)) throw Errors.crossOrigin();

    // 2. Body size and content type.
    let body: Buffer;
    if (route.body === "png") {
      body = await readBody(req, MAX_PNG_BYTES);
      checkContentType(req, "png");
    } else if (route.body === "json") {
      body = await readBody(req, MAX_JSON_BYTES);
      if (body.length > 0) checkContentType(req, "json");
    } else {
      body = Buffer.alloc(0);
    }

    // A zero-byte body on a JSON endpoint is judged as {}.
    let json: Record<string, unknown> | null = null;
    if (route.body === "json") {
      if (body.length === 0) {
        json = {};
      } else {
        const parsed = parseJsonBody(body.toString("utf8"));
        if (!parsed.ok) throw Errors.validation(parsed.fields);
        if (parsed.value === null || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
          throw Errors.validation({ body: "invalid" });
        }
        json = parsed.value as Record<string, unknown>;
      }
    }

    // 4. Ticket header checks.
    if (route.ticketHeader) {
      const ticket = req.headers[route.ticketHeader.toLowerCase()] as string | undefined;
      if (!validTicket(ticket)) throw Errors.validation({ [route.ticketHeader]: "invalid" });
    }

    const params = (route.pattern.exec(path)?.groups ?? {}) as Record<string, string>;
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies["pm_session"] ?? null;

    let reply: Reply;
    try {
      const run = async (tx: Tx): Promise<Reply> => {
        let courier: CourierRow | null = null;
        if (tx && sessionToken) {
          const found = await courierForSession(tx, sessionToken);
          courier = found ? found.courier : null;
        }
        // 3. A route that needs a session without one.
        if (route.role !== "none" && !courier) throw Errors.unauthenticated();
        // 7. Role refusals.
        if (courier && route.role !== "none" && route.role !== "any") {
          if (route.role === "courier" && courier.role === "guest") {
            throw Errors.forbidden("sign_in_required", "Claim your save to race for rush parcels.");
          }
          if (route.role === "staff" && courier.role !== "helper" && courier.role !== "founder") {
            throw Errors.forbidden("staff_only", "Only staff can open that.");
          }
          if (route.role === "founder" && courier.role !== "founder") {
            throw Errors.forbidden("founder_only", "Only the founder can open the console.");
          }
        }
        // 8. If-Match on founder mission changes, against the current revision.
        if (route.ifMatch && tx) {
          const header = req.headers["if-match"];
          const { rows } = await tx.query<{ revision: number }>(`SELECT revision FROM missions WHERE mission_id=$1`, [params.mission_id]);
          if (rows.length === 0) throw Errors.notFound();
          const current = rows[0].revision;
          if (header === undefined) throw Errors.preconditionRequired();
          const m = /^"(\d+)"$/.exec(header);
          if (!m || Number(m[1]) !== current) throw Errors.staleRevision(current);
        }
        return route.handler({
          req, cfg: deps.cfg, url, tx, courier, sessionToken, body, json, params, deps, reqHeaders: req.headers,
        });
      };
      reply = route.noTx
        ? await run(null as unknown as Tx)
        : await deps.db.tx(run);
    } catch (err) {
      fail(err);
      return true;
    }
    emit(res, reply);
    return true;
  } catch (err) {
    fail(err);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Handlers, each following the precedence's remaining steps (6, 9, 10, 11, 12).

async function health(a: HandlerArgs): Promise<Reply> {
  if (!a.deps.dbReady()) return { status: 503, body: JSON.stringify({ status: "waiting_for_database" }) };
  return { status: 200, body: JSON.stringify({ status: "ok" }) };
}

async function status(a: HandlerArgs): Promise<Reply> {
  const darkroom = await a.deps.store.isOpen();
  const post = await a.deps.postOffice.isOpen();
  return { status: 200, body: JSON.stringify({ darkroom: darkroom ? "open" : "closed", post_office: post ? "open" : "closed" }) };
}

async function world(a: HandlerArgs): Promise<Reply> {
  void a;
  return { status: 200, body: JSON.stringify(api.worldBody()) };
}

async function guestStart(a: HandlerArgs): Promise<Reply> {
  const outcome = await api.startGuest({ cfg: a.deps.cfg, store: a.deps.store, postOffice: a.deps.postOffice }, a.tx, a.courier);
  return { status: outcome.status, body: outcome.body, cookies: outcome.token ? [sessionCookie(outcome.token)] : undefined };
}

async function meGet(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: JSON.stringify(await serializeMe(a.tx, a.courier!)) };
}

async function mePatch(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await api.patchMe(a.tx, a.courier!, a.json!) };
}

async function ledgerGet(a: HandlerArgs): Promise<Reply> {
  const q = a.url.searchParams;
  let limit = 20;
  if (q.has("limit")) {
    const raw = q.get("limit")!;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw Errors.validation({ limit: "invalid" });
    if (n < 1 || n > 50) throw Errors.validation({ limit: "out_of_range" });
    limit = n;
  }
  const before = q.has("before") ? q.get("before") : null;
  return { status: 200, body: await api.ledgerPage(a.tx, a.courier!.id, limit, before) };
}

async function depotGet(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await api.depotRead(a.tx, a.courier!.id) };
}

async function accept(a: HandlerArgs): Promise<Reply> {
  const position = api.validatedPosition(a.json!);
  const result = await api.acceptMission(a.tx, a.courier!.id, a.params.mission_id, position);
  return { status: result.status, body: result.body };
}

async function claim(a: HandlerArgs): Promise<Reply> {
  const position = api.validatedPosition(a.json!);
  const result = await api.claimRush(a.tx, a.courier!.id, a.params.rush_id, position, a.deps.cfg.rushHoldSeconds);
  return { status: result.status, body: result.body };
}

async function drop(a: HandlerArgs): Promise<Reply> {
  const unknown = findUnknownKeys(a.json!, {});
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);
  return { status: 200, body: await api.dropParcel(a.tx, a.courier!.id, a.params.acceptance_id) };
}

async function deliver(a: HandlerArgs): Promise<Reply> {
  if (typeof a.json!.acceptance_id !== "string" || a.json!.acceptance_id === "") {
    throw Errors.validation({ acceptance_id: "required" });
  }
  const position = api.validatedPosition(a.json!, { acceptance_id: null, position: api.positionSchemaPublic() });
  const result = await api.deliverParcel(
    a.tx, a.courier!.id, a.reqHeaders["handover-ticket"] as string, a.body.toString("utf8"),
    a.json!.acceptance_id, position,
  );
  return { status: result.status, body: result.body };
}

async function outfitterGet(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await api.outfitterList(a.tx, a.courier!.id) };
}

async function buy(a: HandlerArgs): Promise<Reply> {
  const result = await api.buySatchel(a.tx, a.courier!.id, a.reqHeaders["purchase-ticket"] as string, a.params.satchel_id);
  return { status: result.status, body: result.body };
}

async function postboxKey(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await api.requestPostboxKey({ cfg: a.deps.cfg, store: a.deps.store, postOffice: a.deps.postOffice }, a.tx, a.json!) };
}

async function redeem(a: HandlerArgs): Promise<Reply> {
  if (typeof a.json!.token !== "string" || a.json!.token === "") throw Errors.validation({ token: "required" });
  const outcome = await api.redeemKey({ cfg: a.deps.cfg, store: a.deps.store, postOffice: a.deps.postOffice }, a.tx, a.sessionToken, a.json!.token);
  return { status: outcome.status, body: outcome.body, cookies: [sessionCookie(outcome.sessionToken)] };
}

async function signOut(a: HandlerArgs): Promise<Reply> {
  if (a.sessionToken) await api.signOut(a.tx, a.sessionToken);
  return { status: 204, cookies: [clearCookie()] };
}

async function presenceGet(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await api.presenceGet(a.tx, a.courier!.id) };
}

async function presencePost(a: HandlerArgs): Promise<Reply> {
  if (!a.sessionToken) throw Errors.unauthenticated();
  return { status: 200, body: await api.presencePost(a.tx, a.courier!, a.sessionToken, a.json!) };
}

async function postcardsGet(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await api.listPostcards(a.tx, a.courier!.id) };
}

async function postcardsPost(a: HandlerArgs): Promise<Reply> {
  const result = await api.uploadPostcard({ cfg: a.deps.cfg, store: a.deps.store, postOffice: a.deps.postOffice }, a.tx, a.courier!.id, a.body);
  return { status: result.status, body: result.body };
}

async function postcardDelete(a: HandlerArgs): Promise<Reply> {
  await api.revokePostcard({ cfg: a.deps.cfg, store: a.deps.store, postOffice: a.deps.postOffice }, a.tx, a.courier!.id, a.params.postcard_id);
  return { status: 204 };
}

async function postcardMail(a: HandlerArgs): Promise<Reply> {
  const unknown = findUnknownKeys(a.json!, { to: null });
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);
  if (typeof a.json!.to !== "string" || a.json!.to === "") throw Errors.validation({ to: "required" });
  const reason = validateEmailField(a.json!.to, "to", 254);
  if (reason) throw Errors.validation({ to: reason });
  const result = await api.mailPostcard(
    { cfg: a.deps.cfg, store: a.deps.store, postOffice: a.deps.postOffice }, a.tx, a.courier!,
    a.params.postcard_id, a.reqHeaders["mail-ticket"] as string, a.json!.to,
  );
  return { status: result.status, body: result.body };
}

async function moderationPresence(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await api.moderationPresence(a.tx) };
}

async function mute(a: HandlerArgs): Promise<Reply> {
  const unknown = findUnknownKeys(a.json!, {});
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);
  return { status: 200, body: await api.moderationMute(a.tx, a.courier!, a.params.moderation_ref, true) };
}

async function unmute(a: HandlerArgs): Promise<Reply> {
  const unknown = findUnknownKeys(a.json!, {});
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);
  return { status: 200, body: await api.moderationMute(a.tx, a.courier!, a.params.moderation_ref, false) };
}

async function renameCourier(a: HandlerArgs): Promise<Reply> {
  const unknown = findUnknownKeys(a.json!, {});
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);
  return { status: 200, body: await api.moderationRename(a.tx, a.courier!, a.params.moderation_ref) };
}

async function audit(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await api.auditList(a.tx) };
}

async function missionsGet(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await founder.listMissions(a.tx) };
}

async function missionsCreate(a: HandlerArgs): Promise<Reply> {
  const result = await founder.createMission(a.tx, a.json!);
  return { status: 201, body: result.body, headers: { ETag: `"${result.revision}"` } };
}

async function missionGet(a: HandlerArgs): Promise<Reply> {
  const result = await founder.getMission(a.tx, a.params.mission_id);
  return { status: 200, body: result.body, headers: { ETag: `"${result.revision}"` } };
}

async function missionPatch(a: HandlerArgs): Promise<Reply> {
  const result = await founder.patchMission(a.tx, a.params.mission_id, a.json!);
  return { status: 200, body: result.body, headers: { ETag: `"${result.revision}"` } };
}

async function missionSchedule(a: HandlerArgs): Promise<Reply> {
  const result = await founder.scheduleMission(a.tx, a.params.mission_id, a.json!);
  return { status: 200, body: result.body, headers: { ETag: `"${result.revision}"` } };
}

async function missionUnschedule(a: HandlerArgs): Promise<Reply> {
  const result = await founder.unscheduleMission(a.tx, a.params.mission_id);
  return { status: 200, body: result.body, headers: { ETag: `"${result.revision}"` } };
}

async function missionRetire(a: HandlerArgs): Promise<Reply> {
  const result = await founder.retireMission(a.tx, a.params.mission_id);
  return { status: 200, body: result.body, headers: { ETag: `"${result.revision}"` } };
}

async function studioGet(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await founder.studioRead(a.tx) };
}

async function studioPatch(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: await founder.studioWrite(a.tx, a.json!) };
}

async function onlineGet(a: HandlerArgs): Promise<Reply> {
  return { status: 200, body: JSON.stringify(await onlineNow(a.tx)) };
}

// ---------------------------------------------------------------------------
// Periodic work: promote due missions and sweep presence rows past 60 seconds.

export async function tick(deps: ServerDeps): Promise<void> {
  if (!deps.dbReady()) return;
  await deps.db.tx(async (tx) => {
    await promoteDueMissions({ tx: async (fn) => { await fn(tx); } });
    await sweepPresence(tx);
  });
}

export { sendHtml, sendBytes, escapeHtml, base };
