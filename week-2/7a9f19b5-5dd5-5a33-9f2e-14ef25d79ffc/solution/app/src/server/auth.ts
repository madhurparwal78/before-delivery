import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import { isDialMode, type DialMode } from "../shared/dial.js";
import type { Occupation, Role, TradeStatus, User } from "../shared/types.js";
import { pool, transaction } from "./db.js";
import { apiError, validation } from "./errors.js";
import { Fields } from "./fields.js";
import { json, type Route } from "./http.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

const SESSION_COOKIE = "lf_session";
const SESSION_DAYS = 30;
const OCCUPATIONS: readonly Occupation[] = ["electrician", "architect", "lighting_designer", "wholesaler"];

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  trade_status: TradeStatus | null;
  dial_mode: DialMode;
  kb_account_id: string | null;
}

export const USER_COLUMNS = "u.id, u.email, u.name, u.role, u.trade_status, u.dial_mode, u.kb_account_id";

export function isApprovedTrade(user: UserRow | null): boolean {
  return user?.role === "trade" && user.trade_status === "approved";
}

/** Approved trade buyers and admins see trade prices. */
export function seesTradePrices(user: UserRow | null): boolean {
  return isApprovedTrade(user) || user?.role === "admin";
}

function publicUser(user: UserRow): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    trade_status: user.trade_status,
    dial_mode: user.dial_mode,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash ?? "", "base64");
  const actual = await scryptAsync(password, Buffer.from(salt ?? "", "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [tokenHash(token), userId]);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

function cookieToken(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return undefined;
}

export async function sessionUser(req: IncomingMessage): Promise<UserRow | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const found = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.created_at > now() - interval '${SESSION_DAYS} days'`,
    [tokenHash(token)],
  );
  return found.rows[0] ?? null;
}

export const authRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/auth/signup",
    access: "public",
    async handler({ body }) {
      const fields = new Fields(body);
      const email = fields.email("email");
      const password = fields.text("password", { min: 10, max: 200, minCode: "too_short" });
      const name = fields.text("name", { max: 100 });
      const accountType = fields.choice("account_type", ["retail", "trade"] as const);
      let trade: { business: string; nzbn: string; occupation: Occupation } | null = null;
      if (accountType === "trade") {
        const nested = new Fields(fields.object("trade"));
        const business = nested.text("business_name", { max: 120 });
        const nzbn = nested.text("nzbn", { max: 13 });
        if (nzbn && !/^94\d{11}$/.test(nzbn)) nested.fail("nzbn", "invalid");
        if (fields.has("trade")) trade = { business, nzbn, occupation: nested.choice("occupation", OCCUPATIONS) };
        fields.merge(nested);
      }
      if (email) {
        const taken = await pool.query("SELECT 1 FROM users WHERE lower(email) = $1", [email]);
        if (taken.rowCount) throw apiError(409, "email_taken");
      }
      fields.done();
      const user = await transaction(async (client) => {
        const inserted = await client.query<UserRow>(
          `INSERT INTO users AS u (email, name, password_hash, role, trade_status) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING RETURNING ${USER_COLUMNS}`,
          [email, name, await hashPassword(password), trade ? "trade" : "retail", trade ? "submitted" : null],
        );
        const row = inserted.rows[0];
        if (!row) throw apiError(409, "email_taken");
        if (trade) {
          await client.query(
            "INSERT INTO trade_applications (user_id, business_name, nzbn, occupation) VALUES ($1, $2, $3, $4)",
            [row.id, trade.business, trade.nzbn, trade.occupation],
          );
        }
        return row;
      });
      return json(201, { user: publicUser(user) }, { "Set-Cookie": await startSession(user.id) });
    },
  },
  {
    method: "POST",
    path: "/api/auth/signin",
    access: "public",
    async handler({ body }) {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const found = await pool.query<UserRow & { password_hash: string }>(
        `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE lower(u.email) = $1`,
        [email],
      );
      const row = found.rows[0];
      if (!row || !password || !(await passwordMatches(password, row.password_hash))) {
        throw apiError(401, "invalid_credentials");
      }
      return json(200, { user: publicUser(row) }, { "Set-Cookie": await startSession(row.id) });
    },
  },
  {
    method: "POST",
    path: "/api/auth/signout",
    access: "user",
    async handler({ req }) {
      await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(cookieToken(req) ?? "")]);
      return json(204, undefined, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    },
  },
  {
    method: "GET",
    path: "/api/me",
    access: "user",
    async handler({ user }) {
      return json(200, { user: publicUser(user!) });
    },
  },
  {
    method: "PUT",
    path: "/api/me/dial",
    access: "user",
    async handler({ body, user }) {
      if (!isDialMode(body.mode)) throw validation({ mode: body.mode === undefined ? "required" : "invalid" });
      await pool.query("UPDATE users SET dial_mode = $1 WHERE id = $2", [body.mode, user!.id]);
      return json(200, { dial_mode: body.mode });
    },
  },
];
