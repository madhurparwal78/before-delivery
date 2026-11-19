import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, writeJson } from "./errors.ts";
import type { Database } from "./db.ts";
import { rows } from "./db.ts";
import type { Router } from "./http.ts";
import { parsedJson, requireUser } from "./http.ts";
import type { Account } from "../shared/types.ts";
import { object, parseBody, str } from "../shared/schema.ts";

export type AccountRow = Account;

const COOKIE = "ag_session";
const SESSION_SECONDS = 30 * 86_400;
const MESSAGES = {
  email: "Enter a valid email address",
  password: "Password must be at least 10 characters",
  display: "Display name must be 1 to 40 characters",
  taken: "An account with this email already exists",
  credentials: "Email or password is incorrect",
} as const;

function isValidEmail(email: string): boolean {
  if (email.length > 254 || /\s/.test(email)) return false;
  const parts = email.split("@");
  const [local, domain] = parts;
  if (parts.length !== 2 || !local || !domain) return false;
  const dot = domain.indexOf(".");
  return dot > 0 && domain.lastIndexOf(".") < domain.length - 1 && !domain.startsWith(".");
}

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => {
      if (error) reject(error);
      else resolve(`${salt.toString("hex")}:${key.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(":");
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt ?? "", "hex"), 32, (error, key) => {
      if (error) reject(error);
      else resolve(timingSafeEqual(key, Buffer.from(expected ?? "", "hex")));
    });
  });
}

const signupBody = object({
  email: str({ trim: true, valid: isValidEmail, message: MESSAGES.email }),
  password: str({ min: 10, message: MESSAGES.password }),
  display_name: str({ trim: true, min: 1, max: 40, message: MESSAGES.display }),
});

const loginBody = object({
  email: str({ trim: true, message: MESSAGES.credentials }),
  password: str({ message: MESSAGES.credentials }),
});

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

function cookieValue(req: IncomingMessage): string | null {
  for (const part of (req.headers["cookie"] ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

export class Accounts {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async resolve(req: IncomingMessage): Promise<AccountRow | null> {
    const token = cookieValue(req);
    if (!token) return null;
    const found = await rows<AccountRow>(this.db, 
      `SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash(token)],
    );
    return found[0] ?? null;
  }

  private async startSession(res: ServerResponse, status: number, user: AccountRow): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    await this.db.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
      [tokenHash(token), user.id, SESSION_SECONDS],
    );
    writeJson(res, status, { user }, {
      "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`,
    });
  }

  register(router: Router): void {
    router.add("POST", "/api/auth/signup", { body: "json", public: true }, async (ctx) => {
      const body = parsedJson(ctx, signupBody);
      const email = body.email.toLowerCase();
      const hash = await hashPassword(body.password);
      const created = await rows<AccountRow>(this.db, 
        `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING RETURNING id, email, display_name`,
        [email, body.display_name, hash],
      );
      const user = created[0];
      if (!user) throw new ApiError(409, "email_taken", MESSAGES.taken);
      await this.startSession(ctx.res, 201, user);
    });

    router.add("POST", "/api/auth/login", { body: "json", public: true }, async (ctx) => {
      const credentials = parseBody(loginBody, ctx.json ?? {});
      if (!credentials.ok) throw new ApiError(401, "invalid_credentials", MESSAGES.credentials);
      const found = await rows<AccountRow & { password_hash: string }>(this.db, 
        "SELECT id, email, display_name, password_hash FROM users WHERE email = $1", [credentials.value.email.toLowerCase()],
      );
      const row = found[0];
      if (!row || !(await verifyPassword(credentials.value.password, row.password_hash))) {
        throw new ApiError(401, "invalid_credentials", MESSAGES.credentials);
      }
      await this.startSession(ctx.res, 200, { id: row.id, email: row.email, display_name: row.display_name });
    });

    router.add("POST", "/api/auth/logout", {}, async (ctx) => {
      const token = cookieValue(ctx.req);
      if (token) await this.db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
      ctx.res.writeHead(204, { "set-cookie": `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
      ctx.res.end();
    });

    router.add("GET", "/api/me", {}, async (ctx) => {
      writeJson(ctx.res, 200, { user: requireUser(ctx) });
    });
  }
}

