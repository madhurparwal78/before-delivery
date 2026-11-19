import { Router, type Request, type Response } from "express";
import { Database, newToken, verifyPassword } from "../db.js";
import type { Config } from "../config.js";
import { errors } from "../api-errors.js";
import type { Role } from "../auth.js";
import { loadSession, sessionLanding, type AppLocals } from "../auth.js";

interface SignInBody {
  email?: unknown;
  password?: unknown;
}

export function sessionRouter(): Router {
  const router = Router();

  router.post("/session", async (req, res, next) => {
    try {
      const { cfg, db } = res.locals as unknown as AppLocals;
      const body = req.body as SignInBody;
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!email || !password) {
        next(errors.invalidCredentials());
        return;
      }
      const lock = await checkLock(db, cfg, email);
      if (lock !== null) {
        res.setHeader("Retry-After", String(lock));
        next(errors.tooManyAttempts(lock));
        return;
      }
      const person = await findPersonByEmail(db, email);
      if (!person || !verifyPassword(password, person.password_hash)) {
        await recordFailure(db, email);
        next(errors.invalidCredentials());
        return;
      }
      await clearFailures(db, email);
      const token = newToken();
      const expiresAt = new Date(Date.now() + cfg.session_seconds * 1000);
      await db.withClient(async (client) => {
        await client.query("INSERT INTO sessions (token, person_id, operator_id, expires_at) VALUES ($1,$2,$3,$4)", [
          token,
          person.id,
          person.operator_id,
          expiresAt,
        ]);
      });
      const storeIds = await managedStoreIds(db, person.id);
      setSessionCookie(res, token, cfg, expiresAt);
      res.json({
        user: { id: person.id, name: person.name, email: person.email, role: person.role, operator_id: person.operator_id },
        landing: sessionLanding(person.role, storeIds),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", async (req, res, next) => {
    try {
      const { cfg, db } = res.locals as unknown as AppLocals;
      const auth = await loadSession(req, db, cfg);
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      res.json({
        user: {
          id: auth.user.id,
          name: auth.user.name,
          email: auth.user.email,
          role: auth.user.role,
          operator_id: auth.user.operatorId,
        },
        operator: { id: auth.user.operatorId, name: auth.user.operatorName },
        store_ids: auth.storeIds,
        session_expires_at: auth.sessionExpiresAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/session", async (req, res, next) => {
    try {
      const { cfg, db } = res.locals as unknown as AppLocals;
      const auth = await loadSession(req, db, cfg);
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const token = readToken(req);
      if (token) {
        await db.withClient(async (client) => {
          await client.query("DELETE FROM sessions WHERE token = $1", [token]);
        });
      }
      res.clearCookie("tramela_session", { path: "/" });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export async function checkLock(db: Database, cfg: Config, email: string): Promise<number | null> {
  return db.withClient(async (client) => {
    const windowStart = new Date(Date.now() - cfg.sign_in_window_seconds * 1000);
    const rows = await client.query<{ at: Date }>(
      "SELECT at FROM sign_in_attempts WHERE email = $1 AND at >= $2 ORDER BY at DESC LIMIT 5",
      [email, windowStart],
    );
    if (rows.rowCount === null || rows.rowCount < 5) return null;
    const oldest = rows.rows[rows.rows.length - 1].at;
    const retryAfter = Math.ceil((oldest.getTime() + cfg.sign_in_window_seconds * 1000 - Date.now()) / 1000);
    return Math.max(retryAfter, 0);
  });
}

async function recordFailure(db: Database, email: string): Promise<void> {
  await db.withClient(async (client) => {
    await client.query("INSERT INTO sign_in_attempts (email, at) VALUES ($1, now())", [email]);
  });
}

async function clearFailures(db: Database, email: string): Promise<void> {
  await db.withClient(async (client) => {
    await client.query("DELETE FROM sign_in_attempts WHERE email = $1", [email]);
  });
}

interface PersonRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  operator_id: string;
  password_hash: string;
}

async function findPersonByEmail(db: Database, email: string): Promise<PersonRow | null> {
  return db.withClient(async (client) => {
    const result = await client.query<PersonRow>(
      "SELECT id, email, name, role, operator_id, password_hash FROM people WHERE lower(email) = $1",
      [email],
    );
    return result.rows[0] ?? null;
  });
}

async function managedStoreIds(db: Database, personId: string): Promise<string[]> {
  return db.withClient(async (client) => {
    const result = await client.query<{ store_id: string }>(
      "SELECT store_id FROM store_managers WHERE person_id = $1 ORDER BY store_id",
      [personId],
    );
    return result.rows.map((row) => row.store_id);
  });
}

function setSessionCookie(res: Response, token: string, cfg: Config, expiresAt: Date): void {
  const maxAgeSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
  res.cookie("tramela_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
  void cfg;
}

function readToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "tramela_session") return decodeURIComponent(rest.join("="));
  }
  return null;
}
