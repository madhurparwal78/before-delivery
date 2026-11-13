import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { copy } from "./copy.js";
import { createDb, type Db } from "./db.js";
import { createServices, type Services } from "./services.js";
import { setClock, now } from "./clock.js";
import {
  asRecord,
  asString,
  clearSessionCookie,
  err,
  parseJsonBody,
  readBody,
  readCookies,
  sameOrigin,
  route,
  sendError,
  sendJson,
  setSessionCookie,
  type Ctx,
  type Route,
  type SessionUser,
} from "./http.js";
import * as api from "./api.js";
import * as scoring from "./scoring.js";
import { buildScorecard } from "./scorecard.js";
import { buildState } from "./state.js";
import { computeMatch, loadMatch } from "./match.js";
import { newInviteToken, newViewerCode, newPenId } from "./ids.js";
import { careersJson } from "./careers.js";
import { pageRoute } from "./pages.js";
import { seedRoute } from "./grading.js";

const deps = { db: null as unknown as Db, services: null as unknown as Services };

const routeDefs: { method: string; path: string; handler: (ctx: Ctx) => Promise<unknown> }[] = [
  { method: "POST", path: "/api/auth/signup", handler: async (ctx) => api.signUp(deps, ctx) },
  { method: "POST", path: "/api/auth/signin", handler: async (ctx) => api.signIn(deps, ctx) },
  {
    method: "POST",
    path: "/api/auth/signout",
    handler: async (ctx) => {
      await deps.db.query(`DELETE FROM sessions WHERE token = $1`, [ctx.cookies.oc_session]);
      clearSessionCookie(ctx.res);
      return null;
    },
  },
  { method: "GET", path: "/api/me", handler: async (ctx) => ({ user: ctx.session }) },
  {
    method: "GET",
    path: "/api/teams",
    handler: async (ctx) => {
      const rows = await deps.db.query<{ id: string; name: string; logo_key: string | null }>(
        `SELECT id, name, logo_key FROM teams WHERE organiser_id = $1 ORDER BY created_at`,
        [ctx.session!.id],
      );
      return { teams: rows.map((r) => ({ id: r.id, name: r.name, logo_url: r.logo_key ? `/api/teams/${r.id}/logo` : null })) };
    },
  },
  { method: "POST", path: "/api/teams", handler: async (ctx) => api.createTeam(deps, ctx) },
  {
    method: "GET",
    path: "/api/teams/:id",
    handler: async (ctx) => {
      const team = await deps.db.query<{ organiser_id: string }>(`SELECT organiser_id FROM teams WHERE id = $1`, [ctx.params.id]);
      if (team.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
      const allowed = await canSeeTeam(ctx.session!.id, ctx.params.id);
      if (!allowed) throw err(404, "NOT_FOUND", copy.notFound);
      return api.teamJson(deps, ctx.params.id);
    },
  },
  { method: "POST", path: "/api/teams/:id/players", handler: async (ctx) => api.addPlayer(deps, ctx) },
  { method: "POST", path: "/api/teams/:id/logo", handler: async (ctx) => uploadLogo(ctx) },
  { method: "GET", path: "/api/teams/:id/logo", handler: async (ctx) => serveLogo(ctx) },
  {
    method: "GET",
    path: "/api/players",
    handler: async (ctx) => {
      const rows = await deps.db.query<{ id: string; name: string; short_name: string; team_id: string; team_name: string }>(
        `SELECT p.id, p.name, p.short_name, p.team_id, t.name AS team_name
         FROM players p JOIN teams t ON t.id = p.team_id
         WHERE t.organiser_id = $1
            OR EXISTS (SELECT 1 FROM match_scorers ms JOIN matches m ON m.id = ms.match_id WHERE ms.user_id = $1 AND (m.home_team_id = p.team_id OR m.away_team_id = p.team_id))
         ORDER BY t.name, p.batting_order`,
        [ctx.session!.id],
      );
      return {
        players: rows.map((r) => ({ id: r.id, name: r.name, short_name: r.short_name, team: { id: r.team_id, name: r.team_name } })),
      };
    },
  },
  { method: "GET", path: "/api/players/:id", handler: async (ctx) => careersJson(deps, ctx.params.id, ctx.session!.id) },
  {
    method: "GET",
    path: "/api/tournaments",
    handler: async (ctx) => {
      const rows = await deps.db.query<{ id: string; name: string }>(
        `SELECT id, name FROM tournaments WHERE organiser_id = $1 ORDER BY created_at`,
        [ctx.session!.id],
      );
      return { tournaments: rows };
    },
  },
  { method: "POST", path: "/api/tournaments", handler: async (ctx) => api.createTournament(deps, ctx) },
  {
    method: "GET",
    path: "/api/tournaments/:id",
    handler: async (ctx) => {
      const t = await deps.db.query<{ organiser_id: string }>(`SELECT organiser_id FROM tournaments WHERE id = $1`, [ctx.params.id]);
      if (t.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
      const allowed = await canSeeTournament(ctx.session!.id, ctx.params.id);
      if (!allowed) throw err(404, "NOT_FOUND", copy.notFound);
      return api.tournamentJson(deps, ctx.params.id);
    },
  },
  {
    method: "GET",
    path: "/api/matches",
    handler: async (ctx) => {
      const rows = await deps.db.query<{ id: string; title: string; status: string; played_on: string | null; result: string | null }>(
        `SELECT m.id, m.status, m.played_on, m.result, h.name || ' v ' || a.name AS title
         FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
         WHERE m.organiser_id = $1 OR EXISTS (SELECT 1 FROM match_scorers ms WHERE ms.match_id = m.id AND ms.user_id = $1)
         ORDER BY m.created_at DESC`,
        [ctx.session!.id],
      );
      return { matches: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, played_on: r.played_on, result: r.result })) };
    },
  },
  { method: "POST", path: "/api/matches", handler: async (ctx) => scoring.createMatch(deps, ctx) },
  {
    method: "GET",
    path: "/api/matches/:id",
    handler: async (ctx) => {
      await scoring.loadOpenMatch(deps, ctx, ctx.params.id);
      return scoring.matchJson(deps, ctx.params.id);
    },
  },
  {
    method: "PATCH",
    path: "/api/matches/:id/viewer-link",
    handler: async (ctx) => {
      const loaded = await scoring.loadOrganiserMatch(deps, ctx, ctx.params.id);
      const body = asRecord(ctx.body);
      const on = body.on === true;
      let code = loaded.match.viewer_code;
      if (on && !loaded.match.viewer_link) code = newViewerCode();
      await deps.db.query(`UPDATE matches SET viewer_link = $2, viewer_code = $3 WHERE id = $1`, [ctx.params.id, on, code]);
      if (!on) {
        await deps.services.bus.publish(`match:${ctx.params.id}`, JSON.stringify({ type: "link-off" }));
      }
      return { viewer_link: on, viewer_code: code };
    },
  },
  { method: "POST", path: "/api/matches/:id/invitations", handler: async (ctx) => sendInvitation(ctx) },
  { method: "GET", path: "/api/invitations/:token", handler: async (ctx) => invitationStatus(ctx) },
  { method: "POST", path: "/api/invitations/:token/accept", handler: async (ctx) => acceptInvitation(ctx) },
  {
    method: "GET",
    path: "/api/matches/:id/state",
    handler: async (ctx) => {
      const loaded = await scoring.loadOpenMatch(deps, ctx, ctx.params.id);
      const computed = computeMatch(loaded);
      return { ...buildState(loaded, computed), viewer_link: loaded.match.viewer_link, viewer_code: loaded.match.viewer_code };
    },
  },
  {
    method: "GET",
    path: "/api/matches/:id/scorecard",
    handler: async (ctx) => {
      await scoring.loadOpenMatch(deps, ctx, ctx.params.id);
      return scoring.scorecardResponse(deps, ctx.params.id);
    },
  },
  { method: "POST", path: "/api/matches/:id/innings", handler: async (ctx) => scoring.startInnings(deps, ctx) },
  { method: "POST", path: "/api/matches/:id/overs", handler: async (ctx) => scoring.startOver(deps, ctx) },
  { method: "POST", path: "/api/matches/:id/deliveries", handler: async (ctx) => scoring.recordDelivery(deps, ctx) },
  { method: "PUT", path: "/api/matches/:id/deliveries/:seq", handler: async (ctx) => scoring.changeDelivery(deps, ctx) },
  { method: "DELETE", path: "/api/matches/:id/deliveries/last", handler: async (ctx) => scoring.undoLast(deps, ctx) },
  { method: "POST", path: "/api/matches/:id/retirements", handler: async (ctx) => scoring.retireBatter(deps, ctx) },
  { method: "GET", path: "/api/live/:code/state", handler: async (ctx) => viewerState(ctx) },
  { method: "GET", path: "/api/live/:code/scorecard", handler: async (ctx) => viewerScorecard(ctx) },
  { method: "GET", path: "/api/live/:code/teams/:id/logo", handler: async (ctx) => serveLogo(ctx) },
  { method: "GET", path: "/api/config", handler: async () => ({ live_delay_ms: config.liveDelayMs, tick_ms: config.tickMs, tick_stagger_ms: config.tickStaggerMs }) },
  { method: "GET", path: "/api/health", handler: async () => ({ status: "ok" }) },
  { method: "GET", path: "/api/services", handler: async () => deps.services.status() },
  { method: "POST", path: "/api/grading/seed", handler: async (ctx) => seedRoute(deps, ctx) },
  { method: "POST", path: "/api/grading/clock", handler: async (ctx) => clockRoute(ctx) },
];

const routes: Route[] = routeDefs.map((r) => route(r.method, r.path, r.handler));

const canSeeTeam = async (userId: string, teamId: string): Promise<boolean> => {
  const owned = await deps.db.query(`SELECT 1 FROM teams WHERE id = $1 AND organiser_id = $2`, [teamId, userId]);
  if (owned.length > 0) return true;
  const scoring = await deps.db.query(
    `SELECT 1 FROM match_scorers ms JOIN matches m ON m.id = ms.match_id WHERE ms.user_id = $1 AND (m.home_team_id = $2 OR m.away_team_id = $2)`,
    [userId, teamId],
  );
  return scoring.length > 0;
};

const canSeeTournament = async (userId: string, tournamentId: string): Promise<boolean> => {
  const owned = await deps.db.query(`SELECT 1 FROM tournaments WHERE id = $1 AND organiser_id = $2`, [tournamentId, userId]);
  if (owned.length > 0) return true;
  const scoring = await deps.db.query(
    `SELECT 1 FROM match_scorers ms JOIN matches m ON m.id = ms.match_id WHERE ms.user_id = $1 AND m.tournament_id = $2`,
    [userId, tournamentId],
  );
  return scoring.length > 0;
};

const matchOfCode = async (code: string): Promise<string | null> => {
  const rows = await deps.db.query<{ id: string }>(
    `SELECT id FROM matches WHERE viewer_code = $1 AND viewer_link = true`,
    [code],
  );
  return rows.length > 0 ? rows[0].id : null;
};

const viewerState = async (ctx: Ctx): Promise<unknown> => {
  const matchId = await matchOfCode(ctx.params.code);
  if (matchId === null) throw err(404, "NOT_FOUND", copy.notFound);
  const loaded = await loadMatch(deps.db, matchId);
  if (!loaded) throw err(404, "NOT_FOUND", copy.notFound);
  const computed = computeMatch(loaded);
  return buildState(loaded, computed);
};

const viewerScorecard = async (ctx: Ctx): Promise<unknown> => {
  const matchId = await matchOfCode(ctx.params.code);
  if (matchId === null) throw err(404, "NOT_FOUND", copy.notFound);
  const loaded = await loadMatch(deps.db, matchId);
  if (!loaded) throw err(404, "NOT_FOUND", copy.notFound);
  const computed = computeMatch(loaded);
  return buildScorecard(loaded, computed);
};

const sendInvitation = async (ctx: Ctx): Promise<unknown> => {
  const loaded = await scoring.loadOrganiserMatch(deps, ctx, ctx.params.id);
  void loaded;
  const body = asRecord(ctx.body);
  const email = asString(body.email)?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { email: copy.invalidEmail } });
  }
  // Rolling hour rate limit by the server clock.
  const anHourAgo = new Date(now().getTime() - 60 * 60 * 1000);
  const recent = await deps.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM invitations WHERE match_id = $1 AND sent_at > $2`,
    [ctx.params.id, anHourAgo],
  );
  if (recent[0].n >= config.inviteRatePerHour) throw err(429, "RATE_LIMITED", copy.rateLimited);

  const token = newInviteToken();
  const title = await matchTitle(ctx.params.id);
  const link = `${config.appBaseUrl}/invitations/${token}`;
  const mailLine = copy.invitationMailLine(config.inviteTtlHours);
  const sent = await deps.services.mail.send(email, `Score ${title} on Overcall`, `${link}\n\n${mailLine}\n`);
  if (!sent) throw err(503, "MAIL_UNAVAILABLE", copy.mailOutage);
  await deps.db.query(
    `INSERT INTO invitations (token, match_id, email, sent_at) VALUES ($1, $2, $3, $4)`,
    [token, ctx.params.id, email, now()],
  );
  return { message: copy.invitationSent(email) };
};

const matchTitle = async (matchId: string): Promise<string> => {
  const rows = await deps.db.query<{ title: string }>(
    `SELECT h.name || ' v ' || a.name AS title FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id WHERE m.id = $1`,
    [matchId],
  );
  return rows[0]?.title ?? "";
};

const invitationStatus = async (ctx: Ctx): Promise<unknown> => {
  const rows = await deps.db.query<{ match_id: string; sent_at: Date; accepted_at: Date | null }>(
    `SELECT match_id, sent_at, accepted_at FROM invitations WHERE token = $1`,
    [ctx.params.token],
  );
  if (rows.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
  const r = rows[0];
  const title = await matchTitle(r.match_id);
  const ageMs = now().getTime() - new Date(r.sent_at).getTime();
  const expired = ageMs >= config.inviteTtlHours * 60 * 60 * 1000;
  const status = r.accepted_at !== null ? "used" : expired ? "expired" : "open";
  return { match: { id: r.match_id, title }, status };
};

const acceptInvitation = async (ctx: Ctx): Promise<unknown> => {
  const rows = await deps.db.query<{ match_id: string; sent_at: Date; accepted_at: Date | null }>(
    `SELECT match_id, sent_at, accepted_at FROM invitations WHERE token = $1`,
    [ctx.params.token],
  );
  if (rows.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
  if (ctx.session === null) throw err(401, "SIGN_IN_REQUIRED", copy.signInRequired);
  const r = rows[0];
  if (r.accepted_at !== null) throw err(409, "INVITATION_USED", copy.invitationUsed);
  const ageMs = now().getTime() - new Date(r.sent_at).getTime();
  if (ageMs >= config.inviteTtlHours * 60 * 60 * 1000) throw err(409, "INVITATION_EXPIRED", copy.invitationExpired);
  await deps.db.query(`UPDATE invitations SET accepted_at = $2, accepted_by = $3 WHERE token = $1`, [
    ctx.params.token,
    now(),
    ctx.session!.id,
  ]);
  await deps.db.query(
    `INSERT INTO match_scorers (match_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [r.match_id, ctx.session!.id],
  );
  return { match_id: r.match_id };
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG1 = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG2 = Buffer.from([0xff, 0xd9]);

const sniffLogo = (buf: Buffer): "image/png" | "image/jpeg" | null => {
  if (buf.length >= 8 && PNG.equals(buf.subarray(0, 4))) return "image/png";
  if (buf.length >= 3 && JPEG1.equals(buf.subarray(0, 3)) && buf.length >= 4 && JPEG2.equals(buf.subarray(buf.length - 2))) return "image/jpeg";
  return null;
};

const uploadLogo = async (ctx: Ctx): Promise<unknown> => {
  const teamId = ctx.params.id;
  const team = await deps.db.query<{ organiser_id: string }>(`SELECT organiser_id FROM teams WHERE id = $1`, [teamId]);
  if (team.length === 0 || team[0].organiser_id !== ctx.session!.id) throw err(404, "NOT_FOUND", copy.notFound);

  const contentType = ctx.req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw err(415, "UNSUPPORTED_MEDIA_TYPE", copy.unexpected);
  }
  const fields = parseMultipart(ctx.rawBody, contentType);
  const file = fields.get("logo");
  if (!file) throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { logo: copy.logoWrongType } });
  const type = sniffLogo(file.data);
  if (type === null) throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { logo: copy.logoWrongType } });
  if (file.data.length > config.logoMaxBytes) {
    throw err(422, "VALIDATION", copy.fieldErrorsSummary, {
      fields: { logo: copy.logoTooLarge(config.logoMaxBytes) },
    });
  }
  const count = await deps.db.query<{ n: number }>(`SELECT logo_upload_count AS n FROM teams WHERE id = $1`, [teamId]);
  const next = (count[0]?.n ?? 0) + 1;
  const ext = type === "image/png" ? "png" : "jpg";
  const key = `logos/${teamId}/${next}.${ext}`;
  const ok = await deps.services.storage.put(key, file.data, type);
  if (!ok) throw err(503, "STORAGE_UNAVAILABLE", copy.storageOutage);
  await deps.db.query(`UPDATE teams SET logo_key = $2, logo_upload_count = $3 WHERE id = $1`, [teamId, key, next]);
  return { logo_url: `/api/teams/${teamId}/logo` };
};

const serveLogo = async (ctx: Ctx): Promise<unknown> => {
  const rows = await deps.db.query<{ logo_key: string | null }>(`SELECT logo_key FROM teams WHERE id = $1`, [ctx.params.id]);
  if (rows.length === 0 || !rows[0].logo_key) throw err(404, "NOT_FOUND", copy.notFound);
  const obj = await deps.services.storage.get(rows[0].logo_key);
  if (!obj) throw err(404, "NOT_FOUND", copy.notFound);
  ctx.res.writeHead(200, { "Content-Type": obj.contentType, "Content-Length": obj.body.length, "Cache-Control": "no-cache" });
  ctx.res.end(obj.body);
  return "handled";
};

const parseMultipart = (body: Buffer, contentType: string): Map<string, { data: Buffer; filename: string | null }> => {
  const matchBoundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const boundary = matchBoundary ? matchBoundary[1] ?? matchBoundary[2] : null;
  const out = new Map<string, { data: Buffer; filename: string | null }>();
  if (!boundary) return out;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    parts.push(body.subarray(start + delimiter.length + 2, next - 2));
    start = next;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString("utf8");
    const data = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]*)"/.exec(headers);
    const fileMatch = /filename="([^"]*)"/.exec(headers);
    if (nameMatch) out.set(nameMatch[1], { data, filename: fileMatch ? fileMatch[1] : null });
  }
  return out;
};

const clockRoute = async (ctx: Ctx): Promise<unknown> => {
  const body = asRecord(ctx.body);
  const iso = asString(body.now);
  const value = iso === null ? null : iso;
  const result = setClock(value);
  return { now: result.toISOString() };
};

// ---------- static files ----------

const STATIC_FILES: Record<string, { file?: string; body?: string; type: string }> = {
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/logo.svg": {
    body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#16121f"/><circle cx="16" cy="16" r="7" fill="#c7f94b"/></svg>`,
    type: "image/svg+xml",
  },
  "/fonts/dela-gothic-one.woff2": { file: "fonts/dela-gothic-one.woff2", type: "font/woff2" },
  "/fonts/dm-sans-400.woff2": { file: "fonts/dm-sans-400.woff2", type: "font/woff2" },
  "/fonts/dm-sans-700.woff2": { file: "fonts/dm-sans-700.woff2", type: "font/woff2" },
  "/OFL.txt": { file: "OFL.txt", type: "text/plain; charset=utf-8" },
};

const { readFile } = await import("node:fs/promises");
const { resolve: resolvePath } = await import("node:path");

const serveStatic = async (res: ServerResponse, path: string): Promise<boolean> => {
  const entry = STATIC_FILES[path];
  if (!entry) return false;
  let body: Buffer;
  if (entry.body !== undefined) {
    body = Buffer.from(entry.body, "utf8");
  } else if (entry.file === "styles.css" || entry.file === "app.js") {
    const { clientAssets } = await import("./assets.js");
    body = Buffer.from(entry.file === "styles.css" ? clientAssets.css : clientAssets.js, "utf8");
  } else {
    try {
      body = await readFile(resolvePath("/app/public", entry.file as string));
    } catch {
      return false;
    }
  }
  res.writeHead(200, { "Content-Type": entry.type, "Content-Length": body.length, "Cache-Control": "no-cache" });
  res.end(body);
  return true;
};

// ---------- request handling ----------

const handleApi = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path.startsWith("/api/live") && method !== "GET") {
    sendError(res, err(404, "NOT_FOUND", copy.notFound));
    return;
  }

  const isGrading = path.startsWith("/api/grading");
  if (isGrading) {
    const key = req.headers["x-grading-key"];
    const keyStr = typeof key === "string" ? key : Array.isArray(key) ? key[0] : "";
    if (keyStr !== config.gradingKey) {
      sendError(res, err(404, "NOT_FOUND", copy.notFound));
      return;
    }
  }

  let matched: Route | null = null;
  let params: Record<string, string> = {};
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (m) {
      matched = r;
      params = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      break;
    }
  }

  const cookies = readCookies(req);
  let session: SessionUser | null = null;
  if (!isGrading) {
    session = await api.sessionOf(deps, cookies.oc_session);
  }

  const ctx: Ctx = {
    req,
    res,
    method,
    path,
    query: url.searchParams,
    body: {},
    rawBody: Buffer.alloc(0),
    cookies,
    session,
    sessionToken: session ? cookies.oc_session : null,
    params,
  };

  try {
    if (!path.startsWith("/api/")) {
      const served = await serveStatic(res, path);
      if (served) return;
    }
    if (matched === null) {
      if (path.startsWith("/api/")) {
        sendError(res, err(404, "NOT_FOUND", copy.notFound));
        return;
      }
      await pageRoute(deps, ctx);
      return;
    }

    // Body checks: size and media type before anything else.
    const routePath = matched!.path;
    const isUpload = routePath === "/api/teams/:id/logo";
    const isSeed = routePath === "/api/grading/seed";
    const limit = isUpload ? config.maxLogoRequestBytes : isSeed ? config.maxSeedBytes : config.maxJsonBytes;
    if (method !== "GET" && method !== "HEAD") {
      ctx.rawBody = await readBody(req, limit);
    }
    const contentType = req.headers["content-type"] ?? "";
    if (!isUpload && ctx.rawBody.length > 0) {
      if (!contentType.includes("application/json")) {
        sendError(res, err(415, "UNSUPPORTED_MEDIA_TYPE", copy.unexpected));
        return;
      }
      ctx.body = parseJsonBody(ctx.rawBody);
    }

    // 401 for signed-in routes
    const openToAll =
      path.startsWith("/api/live") ||
      path === "/api/health" ||
      path === "/api/config" ||
      path === "/api/services" ||
      path === "/api/auth/signup" ||
      path === "/api/auth/signin" ||
      path.startsWith("/api/invitations/");
    const needsSignIn = !openToAll && !isGrading && path.startsWith("/api/");
    if (needsSignIn && ctx.session === null) {
      sendError(res, err(401, "SIGN_IN_REQUIRED", copy.signInRequired));
      return;
    }

    const result = await matched.handler(ctx);
    if (result === "handled") return;
    if (res.headersSent) return;
    // Published success codes: 201 for creation, 202 for an invitation, 200 elsewhere.
    let status = method === "PUT" ? 200 : 200;
    if (method === "POST") {
      const creationPaths = [
        "/api/auth/signup",
        "/api/teams",
        "/api/tournaments",
        "/api/matches",
        "/api/matches/:id/innings",
        "/api/matches/:id/overs",
        "/api/matches/:id/deliveries",
        "/api/matches/:id/retirements",
        "/api/teams/:id/players",
        "/api/teams/:id/logo",
        "/api/grading/seed",
      ];
      status =
        routePath === "/api/matches/:id/invitations" ? 202 : creationPaths.includes(routePath) ? 201 : 200;
    }
    if (method === "POST" && (path === "/api/auth/signin" || path === "/api/auth/signup") && ctx.sessionToken) {
      setSessionCookie(res, ctx.sessionToken);
    }
    if (result === null && method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }
    sendJson(res, status, result);
  } catch (e) {
    if (res.headersSent) return;
    if (typeof e === "object" && e !== null && "status" in e && "code" in e) {
      sendError(res, e as never);
      return;
    }
    sendError(res, err(500, "INTERNAL", copy.unexpected));
  }
};


const main = async (): Promise<void> => {
  const db = await createDb();
  const services = createServices();
  deps.db = db;
  deps.services = services;

  await services.connectRedis();
  services.bus.onMessage((channel, message) => {
    relay(channel, message);
  });

  const server = createServer((req, res) => {
    // Same origin only: a cross-origin request is refused without a 403.
    if (!sameOrigin(req)) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: copy.notFound } });
      return;
    }
    void handleApi(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!sameOrigin(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleSocket(ws, req);
    });
  });

  server.listen(config.port, config.host, () => {
    console.log(`Overcall listening on http://${config.host}:${config.port}`);
  });
};

// ---------- live connection ----------

interface SocketState {
  userId: string | null;
  watches: Set<string>; // "match:<id>", "tournament:<id>" or "score:<id>"
  penMatch: string | null;
  penId: string | null;
  holderName: string | null;
  renewTimer: NodeJS.Timeout | null;
}

const sockets = new Map<WebSocket, SocketState>();

const relay = (channel: string, message: string): void => {
  for (const [ws, state] of sockets) {
    if (state.watches.has(channel)) {
      ws.send(message);
    }
  }
};

const sendPenToWatchers = async (matchId: string): Promise<void> => {
  const { penId, holder } = await scoring.holderOf(deps, matchId);
  for (const [ws, state] of sockets) {
    if (state.watches.has(`score:${matchId}`)) {
      ws.send(JSON.stringify({ type: "pen", pen: penId, holder }));
    }
  }
};

const renewPen = async (state: SocketState): Promise<void> => {
  if (!state.penMatch || !state.penId) return;
  const ok = await deps.services.pen.renew(scoring.penKey(state.penMatch), `${state.penId}|${state.holderName ?? ""}`, config.penGraceMs);
  if (!ok) {
    // pen lost
    state.penId = null;
    await sendPenToWatchers(state.penMatch);
  }
};

declare module "./main.js" {
  interface SocketState {
    holderName?: string;
  }
}

const handleSocket = async (ws: WebSocket, req: IncomingMessage): Promise<void> => {
  const state: SocketState = { userId: null, watches: new Set(), penMatch: null, penId: null, holderName: null, renewTimer: null };
  sockets.set(ws, state);

  const cookies = readCookies(req);
  const session = await api.sessionOf(deps, cookies.oc_session);
  state.userId = session?.id ?? null;

  const closePen = async (): Promise<void> => {
    if (state.renewTimer) clearInterval(state.renewTimer);
    state.renewTimer = null;
    if (state.penMatch && state.penId) {
      const current = await scoring.holderOf(deps, state.penMatch);
      if (current.penId === state.penId) {
        // Let the pen lapse after the grace period; stop renewing now.
        state.penId = null;
        state.penMatch = null;
      }
    }
    sockets.delete(ws);
  };
  ws.on("close", () => void closePen());
  ws.on("message", (data) => {
    void (async () => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === "watch") {
          await handleWatch(ws, state, msg);
        } else if (msg.type === "score") {
          await handleScore(ws, state, msg);
        } else if (msg.type === "take-pen") {
          await handleTakePen(ws, state, msg);
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "NOT_FOUND" }));
        ws.close();
      }
    })();
  });
};

const handleWatch = async (ws: WebSocket, state: SocketState, msg: Record<string, unknown>): Promise<void> => {
  if (typeof msg.code === "string") {
    const matchId = await matchOfCode(msg.code);
    if (matchId === null) {
      ws.send(JSON.stringify({ type: "error", code: "NOT_FOUND" }));
      ws.close();
      return;
    }
    state.watches.add(`match:${matchId}`);
    await deps.services.bus.subscribe([`match:${matchId}`]);
    const loaded = await loadMatch(deps.db, matchId);
    if (loaded) {
      const computed = computeMatch(loaded);
      const viewerState = buildState(loaded, computed);
      ws.send(JSON.stringify({ type: "state", event: null, state: viewerState }));
    }
    return;
  }
  if (typeof msg.match === "string") {
    const allowed = await canOpenMatchFor(msg.match, state.userId);
    if (!allowed) {
      ws.send(JSON.stringify({ type: "error", code: "NOT_FOUND" }));
      ws.close();
      return;
    }
    state.watches.add(`match:${msg.match}`);
    await deps.services.bus.subscribe([`match:${msg.match}`]);
    const loaded = await loadMatch(deps.db, msg.match);
    if (loaded) {
      const computed = computeMatch(loaded);
      ws.send(JSON.stringify({ type: "state", event: null, state: buildState(loaded, computed) }));
    }
    return;
  }
  if (typeof msg.tournament === "string") {
    const allowed = await canSeeTournament(state.userId ?? "", msg.tournament);
    if (!allowed) {
      ws.send(JSON.stringify({ type: "error", code: "NOT_FOUND" }));
      ws.close();
      return;
    }
    state.watches.add(`tournament:${msg.tournament}`);
    await deps.services.bus.subscribe([`tournament:${msg.tournament}`]);
    const json = (await api.tournamentJson(deps, msg.tournament)) as { groups: unknown };
    ws.send(JSON.stringify({ type: "table", tournament: msg.tournament, groups: json.groups }));
  }
};

const canOpenMatchFor = async (matchId: string, userId: string | null): Promise<boolean> => {
  if (!userId) return false;
  const rows = await deps.db.query<{ organiser_id: string }>(`SELECT organiser_id FROM matches WHERE id = $1`, [matchId]);
  if (rows.length === 0) return false;
  if (rows[0].organiser_id === userId) return true;
  const scorer = await deps.db.query(`SELECT 1 FROM match_scorers WHERE match_id = $1 AND user_id = $2`, [matchId, userId]);
  return scorer.length > 0;
};

const handleScore = async (ws: WebSocket, state: SocketState, msg: Record<string, unknown>): Promise<void> => {
  if (typeof msg.match !== "string" || !state.userId) {
    ws.send(JSON.stringify({ type: "error", code: "NOT_FOUND" }));
    ws.close();
    return;
  }
  const allowed = await canOpenMatchFor(msg.match, state.userId);
  if (!allowed) {
    ws.send(JSON.stringify({ type: "error", code: "NOT_FOUND" }));
    ws.close();
    return;
  }
  state.watches.add(`match:${msg.match}`);
  state.watches.add(`score:${msg.match}`);
  await deps.services.bus.subscribe([`match:${msg.match}`]);

  // Ask for the pen: exactly one page wins, the others are told the holder.
  const penId = newPenId();
  const holderName = await displayNameOf(state.userId);
  const won = await deps.services.pen.takeIfFree(scoring.penKey(msg.match), `${penId}|${holderName}`, config.penGraceMs);
  if (won) {
    state.penMatch = msg.match;
    state.penId = penId;
    state.holderName = holderName;
    const renewMs = Math.max(100, Math.floor(config.penGraceMs / 5));
    state.renewTimer = setInterval(() => void renewPen(state), renewMs);
    ws.send(JSON.stringify({ type: "pen", pen: penId, holder: holderName }));
  } else {
    const stored = await deps.services.pen.get(scoring.penKey(msg.match));
    const sep = stored === null ? -1 : stored.indexOf("|");
    const otherHolder = sep === -1 || stored === null ? null : stored.slice(sep + 1);
    ws.send(JSON.stringify({ type: "pen", pen: null, holder: otherHolder }));
  }
  const loaded = await loadMatch(deps.db, msg.match);
  if (loaded) {
    const computed = computeMatch(loaded);
    ws.send(JSON.stringify({ type: "state", event: null, state: buildState(loaded, computed) }));
  }
};

const displayNameOf = async (userId: string): Promise<string> => {
  const rows = await deps.db.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [userId]);
  return rows[0]?.display_name ?? "";
};

const handleTakePen = async (ws: WebSocket, state: SocketState, msg: Record<string, unknown>): Promise<void> => {
  if (typeof msg.match !== "string" || !state.userId) return;
  const penId = newPenId();
  const holderName = await displayNameOf(state.userId);
  const won = await deps.services.pen.takeIfFree(scoring.penKey(msg.match), `${penId}|${holderName}`, config.penGraceMs);
  if (!won) {
    const stored = await deps.services.pen.get(scoring.penKey(msg.match));
    const sep = stored === null ? -1 : stored.indexOf("|");
    const otherHolder = sep === -1 || stored === null ? null : stored.slice(sep + 1);
    ws.send(JSON.stringify({ type: "pen", pen: null, holder: otherHolder }));
    return;
  }
  state.penMatch = msg.match;
  state.penId = penId;
  state.holderName = holderName;
  const renewMs = Math.max(100, Math.floor(config.penGraceMs / 5));
  if (state.renewTimer) clearInterval(state.renewTimer);
  state.renewTimer = setInterval(() => void renewPen(state), renewMs);
  ws.send(JSON.stringify({ type: "pen", pen: penId, holder: holderName }));
};

void main();
