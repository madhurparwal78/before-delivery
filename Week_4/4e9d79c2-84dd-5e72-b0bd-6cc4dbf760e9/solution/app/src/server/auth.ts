import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import { nowSeconds, one, pool } from "./db.js";
import { hashToken, newToken, type Authenticate, type Desk } from "./http.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: string, length: number) => Promise<Buffer>;
const COOKIE = "wayticket_session";

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(password, salt, 32)).toString("hex")}`;
};
export const passwordMatches = async (password: string, stored: string): Promise<boolean> => {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(await scrypt(password, salt, 32), Buffer.from(hash, "hex"));
};

const cookieOf = (req: IncomingMessage): string | null => {
  const found = (req.headers.cookie ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  return found ? found.slice(COOKIE.length + 1) : null;
};
export const authenticate: Authenticate = async (req) => {
  const token = cookieOf(req);
  if (!token) return { desk: null, ended: false };
  const row = await one<Desk & { created_at: number; ended_at: number | null }>(pool, "SELECT d.id,d.name,d.email,s.created_at,s.ended_at FROM sessions s JOIN desks d ON d.id=s.desk_id WHERE s.token=$1", [hashToken(token)]);
  if (!row || row.ended_at !== null || row.created_at + config.sessionSeconds <= nowSeconds()) return { desk: null, ended: true };
  return { desk: { id: row.id, name: row.name, email: row.email }, ended: false };
};
export const sessionTokenOf = (req: IncomingMessage): string | null => {
  const token = cookieOf(req);
  return token ? hashToken(token) : null;
};
export const startSession = async (desk: Desk): Promise<Record<string, string>> => {
  const token = newToken();
  await pool.query("INSERT INTO sessions (token,desk_id,created_at) VALUES ($1,$2,$3)", [hashToken(token), desk.id, nowSeconds()]);
  return { "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` };
};
