import type { Context } from "hono";
import { config } from "../config";
import { pool, query } from "../db";
import { type Account, accountForSession } from "../store/practice";
import type { Role } from "../../shared/types";
import { forbidden, notFound, signInRequired } from "./errors";

export type Env = { Variables: { body: unknown } };
export type Ctx = Context<Env>;

const COOKIE = "duefield_session";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

export function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function sessionToken(c: Ctx): string | undefined {
  const cookie = c.req.header("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim().split("=")).find(([name]) => name === COOKIE)?.[1];
}

export const startSessionCookie = (token: string): string =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`;

export const endSessionCookie = (): string => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function currentAccount(c: Ctx): Promise<Account | null> {
  const token = sessionToken(c);
  return token ? accountForSession(pool, token) : null;
}

interface Access {
  roles: Role[] | "either";
  /** The record the route names: unknown, another practice's or another client's all answer 404. */
  record?: { id: string; table: "returns" | "clients" };
}

/** Whether the account may open the record: its own practice's, and for an owner only their own client's. */
export async function canOpen(account: Account, record: NonNullable<Access["record"]>): Promise<boolean> {
  if (!isUuid(record.id)) return false;
  const clientColumn = record.table === "returns" ? "client_id" : "id";
  const rows = await query(pool,
    `SELECT 1 FROM ${record.table} WHERE id = $1 AND practice_id = $2 AND ($3::uuid IS NULL OR ${clientColumn} = $3)`,
    [record.id, account.practiceId, account.role === "owner" ? account.clientId : null]);
  return rows.length > 0;
}

/** The error order's first three steps: not found, then sign in required, then forbidden. */
export async function authorize(c: Ctx, access: Access): Promise<Account> {
  const account = await currentAccount(c);
  if (access.record && (!account || !(await canOpen(account, access.record)))) throw notFound();
  if (!account) throw signInRequired();
  if (access.roles !== "either" && !access.roles.includes(account.role)) throw forbidden();
  return account;
}
