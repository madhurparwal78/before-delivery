/**
 * The platform and grading routes.
 */
import type { Request, Response, Router } from "express";
import { checkPassword, hashPassword, newSessionToken, sha256 } from "./auth";
import { config, browserSettings, setRateOverride, clearRateOverrides } from "./config";
import { nowIso, nowMs, secondsToNextMinute, setClock } from "./clock";
import { ApiError, apiErrorHandler, errors } from "./errors";
import { nextId, pool, withDb } from "./db";
import { hitRate, loadContext, parseCookies, rateIdentity } from "./context";
import { broadcastToSpace, currentSeq, initSeq, nextSeq, publish, type LiveKind } from "./bus";
import { isValidTimeZone } from "../shared/tz";

interface SignupBody {
  username?: unknown;
  password?: unknown;
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export function platformRoutes(router: Router): void {
  router.get("/api/health", async (_req: Request, res: Response) => {
    let dbOk = true;
    let storageOk = true;
    try {
      await pool.query("SELECT 1");
    } catch {
      dbOk = false;
    }
    try {
      const { storageHealthy } = await import("./storage.js");
      storageOk = await storageHealthy();
    } catch {
      storageOk = false;
    }
    res.status(200).json({ status: dbOk && storageOk ? "ok" : "unavailable" });
  });

  router.get("/api/config", (_req: Request, res: Response) => {
    res.json({ grading: config().grading, settings: browserSettings() });
  });

  router.get("/api/time", (_req: Request, res: Response) => {
    res.json({ now: nowIso(), now_ms: nowMs() });
  });

  router.post("/api/signup", async (req: Request, res: Response) => {
    const body = req.body as SignupBody;
    const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fields: Record<string, string> = {};
    if (!USERNAME_RE.test(username)) {
      fields.username = "Use 3 to 24 characters: a-z, 0-9 or _.";
    }
    if (password.length < 8) {
      fields.password = "Use at least 8 characters.";
    }
    if (Object.keys(fields).length > 0) {
      throw errors.invalid(fields);
    }
    const created = await withDb(async (db) => {
      const existing = await db.query("SELECT id FROM users WHERE username = $1", [username]);
      if (existing.rows.length > 0) {
        throw errors.nameTaken("username", "That username is taken.");
      }
      const id = nextId();
      const hash = await hashPassword(password);
      const spaceId = nextId();
      await db.query("BEGIN");
      await db.query(
        "INSERT INTO users (id, username, password_hash, time_zone, current_space, created_at) VALUES ($1,$2,$3,'UTC',$4,now())",
        [id, username, hash, username],
      );
      await db.query("INSERT INTO spaces (id, slug, name, seq, created_at) VALUES ($1,$2,$3,0,now())", [
        spaceId,
        username,
        username,
      ]);
      await db.query("INSERT INTO members (space_id, user_id, role) VALUES ($1,$2,'admin')", [spaceId, id]);
      await db.query("COMMIT");
      return { id };
    });
    const token = newSessionToken();
    await pool.query("INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,now())", [
      token,
      created.id,
    ]);
    res.setHeader(
      "Set-Cookie",
      `spoor_session=${token}; HttpOnly; SameSite=Lax; Path=/`,
    );
    res.status(201).json({ username, space: username });
  });

  router.post("/api/signin", async (req: Request, res: Response) => {
    const body = req.body as SignupBody;
    const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    // Sign-in is the one exception: 429 comes before 401.
    try {
      hitRate("login", `login:${username}`);
    } catch {
      throw errors.rateLimited(secondsToNextMinute());
    }
    const res0 = await pool.query("SELECT id, password_hash FROM users WHERE username = $1", [username]);
    const row = res0.rows[0];
    if (!row || !(await checkPassword(password, String(row.password_hash)))) {
      throw errors.badCredentials();
    }
    const token = newSessionToken();
    await pool.query("INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,now())", [
      token,
      row.id,
    ]);
    const me = await pool.query<{ current_space: string }>("SELECT current_space FROM users WHERE id = $1", [
      row.id,
    ]);
    res.setHeader("Set-Cookie", `spoor_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    res.status(200).json({ username, space: me.rows[0]?.current_space ?? username });
  });

  router.post("/api/signout", async (req: Request, res: Response) => {
    const cookies = await parseCookies(req);
    const token = cookies["spoor_session"];
    if (token) {
      await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    }
    res.setHeader("Set-Cookie", "spoor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.status(204).end();
  });

  router.get("/api/me", async (req: Request, res: Response) => {
    await withDb(async (db) => {
      const ctx = await loadContext(db, req, null);
      if (!ctx || ctx.kind !== "session") throw errors.unauthenticated();
      const user = await db.query<{ username: string; time_zone: string }>(
        "SELECT username, time_zone FROM users WHERE id = $1",
        [ctx.userId],
      );
      const spaces = await db.query(
        "SELECT s.slug, s.name, m.role FROM members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = $1",
        [ctx.userId],
      );
      const space = await db.query("SELECT slug, name FROM spaces WHERE id = $1", [ctx.spaceId]);
      res.json({
        username: user.rows[0].username,
        time_zone: user.rows[0].time_zone,
        space: {
          slug: space.rows[0].slug,
          name: space.rows[0].name,
          role: ctx.role,
        },
        spaces: spaces.rows,
        seq: currentSeq(ctx.spaceId),
      });
    });
  });

  router.patch("/api/me", async (req: Request, res: Response) => {
    const body = req.body as { time_zone?: unknown; space?: unknown };
    await withDb(async (db) => {
      const ctx = await loadContext(db, req, null);
      if (!ctx || ctx.kind !== "session") throw errors.unauthenticated();
      const fields: Record<string, string> = {};
      if (body.time_zone !== undefined) {
        if (typeof body.time_zone !== "string" || !isValidTimeZone(body.time_zone)) {
          throw errors.invalid({ time_zone: `Unknown time zone ${String(body.time_zone)}.` });
        }
      }
      if (body.space !== undefined) {
        const member = await db.query(
          "SELECT 1 FROM members m JOIN spaces s ON s.id = m.space_id WHERE s.slug = $1 AND m.user_id = $2",
          [String(body.space), ctx.userId],
        );
        if (member.rows.length === 0) throw errors.notFound();
      }
      if (body.time_zone !== undefined) {
        await db.query("UPDATE users SET time_zone = $1 WHERE id = $2", [body.time_zone, ctx.userId]);
      }
      if (body.space !== undefined) {
        await db.query("UPDATE users SET current_space = $1 WHERE id = $2", [String(body.space), ctx.userId]);
      }
      const user = await db.query<{ username: string; time_zone: string; current_space: string }>(
        "SELECT username, time_zone, current_space FROM users WHERE id = $1",
        [ctx.userId],
      );
      const spaces = await db.query(
        "SELECT s.slug, s.name, m.role FROM members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = $1",
        [ctx.userId],
      );
      const space = await db.query("SELECT slug, name FROM spaces WHERE slug = $1", [user.rows[0].current_space]);
      res.json({
        username: user.rows[0].username,
        time_zone: user.rows[0].time_zone,
        space: {
          slug: space.rows[0].slug,
          name: space.rows[0].name,
          role: ctx.role,
        },
        spaces: spaces.rows,
        seq: currentSeq(ctx.spaceId),
      });
    });
  });

  router.get("/api/events", async (req: Request, res: Response) => {
    await withDb(async (db) => {
      const ctx = await loadContext(db, req, (req.query.space as string) ?? null);
      if (!ctx) throw errors.unauthenticated();
      const spaceId = ctx.spaceId;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ hello: true, seq: currentSeq(spaceId) })}\n\n`);
      const { addSseClient, removeSseClient } = await import("./bus.js");
      addSseClient(res, spaceId);
      req.on("close", () => removeSseClient(res));
    }).catch((err) => {
      apiErrorHandler(err, req, res, () => undefined);
    });
  });
}

export { setRateOverride, clearRateOverrides, nextSeq, initSeq, broadcastToSpace, publish, sha256, ApiError, errors, withDb, nextId };
export type { LiveKind };
