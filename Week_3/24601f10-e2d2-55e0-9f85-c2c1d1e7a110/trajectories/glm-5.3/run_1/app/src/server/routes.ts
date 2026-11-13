import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { errors, sendJson, ApiError } from "./errors.js";
import {
  userFromRequest,
  createSession,
  clearSessionCookie,
  destroySession,
  signup,
  signin,
  findUserByUsername,
  isoNow,
} from "./auth.js";
import { all, query } from "./db.js";
import * as T from "./tournaments.js";
import { FIELD_ERRORS } from "../shared/types.js";
import type { Tournament, TournamentFormat, TrophyFill } from "../shared/types.js";
import { newId } from "./auth.js";

// The browser's canonical zone list, with UTC added because it is the create form's default.
const TIME_ZONES: string[] = (() => {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
})();

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const method = req.method ?? "GET";
  const user = await userFromRequest(req);

  try {
    // health and config
    if (pathname === "/api/health") {
      if (method !== "GET") throw errors.notFound();
      const pg = await (async () => {
        try {
          await query("SELECT 1");
          return true;
        } catch {
          return false;
        }
      })();
      if (!pg) {
        sendJson(res, 503, { status: "starting" });
        return;
      }
      const { storageReachable } = await import("./storage.js");
      const storage = await storageReachable();
      sendJson(res, 200, { status: storage ? "ok" : "unavailable" });
      return;
    }
    if (pathname === "/api/config") {
      if (method !== "GET") throw errors.notFound();
      sendJson(res, 200, {
        server_time: isoNow(),
        confirm_window_ms: config.confirmWindowMs,
        match_limit_ms: config.matchLimitMs,
        swiss_round_ms: config.swissRoundMs,
        toast_ms: config.toastMs,
        roster_max_bytes: config.rosterMaxBytes,
        logo_max_bytes: config.logoMaxBytes,
      });
      return;
    }

    // share read-only enforcement: any method other than GET under /api/share/
    if (pathname.startsWith("/api/share/") && method !== "GET") {
      throw errors.readOnly();
    }

    // grading
    if (pathname.startsWith("/api/grading/")) {
      const { handleGrading } = await import("./grading.js");
      await handleGrading(req, res, pathname, method);
      return;
    }

    // auth
    if (pathname === "/api/auth/signup" && method === "POST") {
      const body = await readJson(req);
      const b = body as { username?: string; password?: string };
      const u = await signup(String(b.username ?? ""), String(b.password ?? ""));
      await createSession(res, u.id);
      sendJson(res, 201, { user: { username: u.username } });
      return;
    }
    if (pathname === "/api/auth/signin" && method === "POST") {
      const body = await readJson(req);
      const b = body as { username?: string; password?: string };
      const u = await signin(String(b.username ?? ""), String(b.password ?? ""));
      await createSession(res, u.id);
      sendJson(res, 200, { user: { username: u.username } });
      return;
    }
    if (pathname === "/api/auth/signout" && method === "POST") {
      await destroySession(req);
      clearSessionCookie(res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname === "/api/me" && method === "GET") {
      if (!user) throw errors.unauthenticated();
      sendJson(res, 200, { user: { username: user.username } });
      return;
    }

    if (pathname === "/api/users" && method === "GET") {
      throw errors.notFound();
    }

    if (pathname.startsWith("/api/users/")) {
      const username = pathname.split("/")[3] ?? "";
      if (pathname.endsWith("/history") && method === "GET") {
        const target = await findUserByUsername(username);
        if (!target) throw errors.notFound();
        const rows = await all<{
          tournament_id: string;
          tournament_name: string;
          place: number;
          field_size: number;
          finished_on: string;
        }>(
          `SELECT tournament_id, tournament_name, place, field_size, to_char(finished_on, 'YYYY-MM-DD') as finished_on
           FROM history_rows WHERE user_id = $1 ORDER BY created_at DESC`,
          [target.id]
        );
        sendJson(res, 200, {
          rows: rows.map((r) => ({
            tournament_id: r.tournament_id,
            tournament_name: r.tournament_name,
            place: r.place,
            field_size: r.field_size,
            finished_on: r.finished_on,
            text: `${r.tournament_name} · ${ordinal(r.place)} of ${r.field_size} · ${r.finished_on}`,
          })),
        });
        return;
      }
      throw errors.notFound();
    }

    // tournaments collection
    if (pathname === "/api/tournaments") {
      if (method === "GET") {
        if (!user) throw errors.unauthenticated();
        const rows = await all<{ id: string }>(
          `SELECT DISTINCT t.id FROM tournaments t
           LEFT JOIN co_organizers c ON c.tournament_id = t.id AND c.user_id = $1
           LEFT JOIN entrants e ON e.tournament_id = t.id AND e.user_id = $1
           WHERE t.organizer_id = $1 OR c.user_id = $1 OR e.user_id = $1
           ORDER BY t.id`,
          [user.id]
        );
        const out: Tournament[] = [];
        for (const r of rows) {
          const t = await T.getTournamentRow(r.id);
          if (t) out.push(await T.toTournament(t, user.id, true));
        }
        sendJson(res, 200, { tournaments: out });
        return;
      }
      if (method === "POST") {
        if (!user) throw errors.unauthenticated();
        const body = (await readJson(req)) as Record<string, unknown>;
        const name = String(body.name ?? "");
        const format = String(body.format ?? "");
        const timeZone = String(body.time_zone ?? "");
        const fill = String(body.fill ?? "");
        const fields: Record<string, string> = {};
        if (name.length < 1 || name.length > 60) fields.name = FIELD_ERRORS.name;
        if (!["single_elimination", "double_elimination", "round_robin", "swiss"].includes(format)) fields.format = FIELD_ERRORS.format;
        if (!TIME_ZONES.includes(timeZone)) fields.time_zone = FIELD_ERRORS.time_zone;
        if (!["lilac", "lemon", "mint"].includes(fill)) fields.fill = FIELD_ERRORS.fill;
        if (Object.keys(fields).length > 0) throw errors.validation(fields);
        const id = newId();
        const shareCode = shareCodeNew();
        await query(
          `INSERT INTO tournaments (id, name, format, state, fill, time_zone, organizer_id, share_code, seeding_version)
           VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,1)`,
          [id, name, format as TournamentFormat, fill as TrophyFill, timeZone, user.id, shareCode]
        );
        const t = (await T.getTournamentRow(id))!;
        sendJson(res, 201, { tournament: await T.toTournament(t, user.id, true) });
        return;
      }
      throw errors.notFound();
    }

    // share endpoints
    if (pathname.startsWith("/api/share/")) {
      const { handleShare } = await import("./share-routes.js");
      await handleShare(res, pathname);
      return;
    }

    const matchRoute = pathname.match(/^\/api\/matches\/([^/]+)\/(call|report|confirm|dispute|result|resolve|edit-preview|edit)$/);
    if (matchRoute) {
      if (!user) throw errors.unauthenticated();
      const [, matchId, action] = matchRoute;
      const { handleMatchAction } = await import("./match-routes.js");
      await handleMatchAction(req, res, method, matchId!, action!, user);
      return;
    }
    const entrantRoute = pathname.match(/^\/api\/entrants\/([^/]+)(\/checkin)?$/);
    if (entrantRoute) {
      if (!user) throw errors.unauthenticated();
      const [, entrantId, checkinPart] = entrantRoute;
      const ER = await import("./tournament-routes.js");
      if (method === "PATCH" && !checkinPart) {
        await ER.handleEntrantPatch(req, res, entrantId!, user);
        return;
      }
      if (method === "DELETE" && !checkinPart) {
        await ER.handleEntrantDelete(res, entrantId!, user);
        return;
      }
      if (method === "PUT" && checkinPart) {
        await ER.handleOrganizerCheckinToggle(req, res, entrantId!, user);
        return;
      }
      throw errors.notFound();
    }

    const tRoute = pathname.match(/^\/api\/tournaments\/([^/]+)(\/.*)?$/);
    if (tRoute) {
      const tid = tRoute[1]!;
      const rest = tRoute[2] ?? "";
      const { handleTournamentRoutes } = await import("./tournament-routes.js");
      await handleTournamentRoutes(req, res, method, tid, rest, user);
      return;
    }

    throw errors.notFound();
  } catch (e) {
    if (e instanceof ApiError) {
      sendJson(res, e.status, { error: e.code, message: e.message, ...e.extra });
    } else {
      console.error("api error", e);
      sendJson(res, 500, { error: "internal", message: "Something went wrong." });
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > 65536) throw errors.tooLargeJson();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 65536) throw errors.tooLargeJson();
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errors.validationMsg("Check the highlighted fields.");
  }
}

function shareCodeNew(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 22; i++) out += chars[bytes[i]! % 64];
  return out;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export { readJson };
