// Accounts, sessions and devices (API: "Accounts, sessions and devices").
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { pool, transaction } from "../db.ts";
import { ApiError, jsonBody, notFound, route, sendJson, validationError, type Ctx } from "../http.ts";
import { approvalEmail, enqueue, sendSoon } from "../mail.ts";
import { hashPassword, newToken, tokenHash, verifyPassword } from "../passwords.ts";
import { accountJson, COOKIE, deviceJson, requireSession, startSession, type AccountRow, type DeviceRow } from "../session.ts";
import { isTimeZone } from "../../shared/time.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const length = (value: string) => [...value].length;
const text = (value: unknown) => (typeof value === "string" ? value : "");

export function emailProblem(value: unknown): string | null {
  return typeof value === "string" && EMAIL.test(value) && value.length <= 254 ? null : "Enter a valid email address of up to 254 characters.";
}

function deviceNameProblem(value: unknown): string | null {
  return typeof value === "string" && length(value.trim()) >= 1 && length(value) <= 40 ? null : "Name this device in 1 to 40 characters.";
}

const ACCOUNT_COLUMNS = "id, email, display_name, time_zone, operator";

route("POST", "/api/accounts", async (ctx: Ctx) => {
  const body = jsonBody(ctx);
  if (typeof body.email === "string") {
    const taken = await pool.query("SELECT 1 FROM accounts WHERE lower(email) = lower($1)", [body.email]);
    if (taken.rowCount) throw new ApiError(409, "email_taken", "An account with this email already exists.");
  }
  const fields: Record<string, string> = {};
  const email = emailProblem(body.email);
  if (email) fields.email = email;
  const password = text(body.password);
  if (typeof body.password !== "string" || length(password) < 10 || length(password) > 128) fields.password = "Use 10 to 128 characters.";
  const name = text(body.display_name);
  if (typeof body.display_name !== "string" || length(name.trim()) < 1 || length(name) > 60) fields.display_name = "Use 1 to 60 characters.";
  if (typeof body.time_zone !== "string" || !isTimeZone(body.time_zone)) fields.time_zone = "Use an IANA time zone name, such as Europe/Lisbon.";
  const device = deviceNameProblem(body.device_name);
  if (device) fields.device_name = device;
  if (Object.keys(fields).length) throw validationError(fields);

  const accountId = randomUUID();
  const deviceId = randomUUID();
  const passwordHash = await hashPassword(password);
  const created = await transaction(async (db) => {
    try {
      const account = await db.query<AccountRow>(
        `INSERT INTO accounts (id, email, password_hash, display_name, time_zone) VALUES ($1, $2, $3, $4, $5) RETURNING ${ACCOUNT_COLUMNS}`,
        [accountId, text(body.email), passwordHash, name, body.time_zone]);
      const dev = await db.query<DeviceRow>(
        "INSERT INTO devices (id, account_id, name, approved) VALUES ($1, $2, $3, true) RETURNING id, name, approved, created_at",
        [deviceId, accountId, text(body.device_name)]);
      return { account: account.rows[0], device: dev.rows[0] };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ApiError(409, "email_taken", "An account with this email already exists.");
      throw error;
    }
  });
  await startSession(ctx.res, accountId, deviceId);
  sendJson(ctx.res, 201, { account: accountJson(created.account), device: deviceJson(created.device) });
});

route("POST", "/api/sessions", async (ctx: Ctx) => {
  const body = jsonBody(ctx);
  const found = await pool.query<AccountRow & { password_hash: string }>(
    `SELECT ${ACCOUNT_COLUMNS}, password_hash FROM accounts WHERE lower(email) = lower($1)`, [text(body.email)]);
  const account = found.rows[0];
  if (!account || !(await verifyPassword(text(body.password), account.password_hash))) {
    throw new ApiError(401, "invalid_credentials", "Wrong email or password.");
  }
  const problem = deviceNameProblem(body.device_name);
  if (problem) throw validationError({ device_name: problem });

  const reused = typeof body.device_id === "string"
    ? (await pool.query<DeviceRow>("SELECT id, name, approved, created_at FROM devices WHERE id::text = $1 AND account_id = $2",
      [body.device_id, account.id])).rows[0]
    : undefined;
  const device = reused ?? await transaction(async (db) => {
    await db.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [account.id]);
    const approvedOnes = await db.query("SELECT 1 FROM devices WHERE account_id = $1 AND approved", [account.id]);
    const first = approvedOnes.rowCount === 0;
    const created = await db.query<DeviceRow>(
      "INSERT INTO devices (id, account_id, name, approved) VALUES ($1, $2, $3, $4) RETURNING id, name, approved, created_at",
      [randomUUID(), account.id, text(body.device_name).trim(), first]);
    const dev = created.rows[0];
    if (!first) {
      const token = newToken();
      await db.query("INSERT INTO device_approvals (token_hash, device_id, created_at) VALUES ($1, $2, $3)",
        [tokenHash(token), dev.id, dev.created_at]);
      const expires = new Date(dev.created_at.getTime() + config.timers.deviceApprovalTtl * 1000);
      await enqueue(db, approvalEmail(account.email, dev.name, dev.created_at, expires, account.time_zone, token));
    }
    return dev;
  });
  sendSoon();
  await startSession(ctx.res, account.id, device.id);
  sendJson(ctx.res, 200, { account: accountJson(account), device: deviceJson(device) });
});

route("DELETE", "/api/sessions/current", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [session.tokenHash]);
  ctx.res.writeHead(204, { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
  ctx.res.end();
});

route("GET", "/api/me", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  sendJson(ctx.res, 200, { account: accountJson(session.account), device: deviceJson(session.device) });
});

route("GET", "/api/devices", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const { rows } = await pool.query<DeviceRow>(
    "SELECT id, name, approved, created_at FROM devices WHERE account_id = $1 ORDER BY created_at, id", [session.account.id]);
  sendJson(ctx.res, 200, { devices: rows.map(deviceJson) });
});

route("POST", "/api/device-approvals/:token", async (ctx: Ctx) => {
  const device = await transaction(async (db) => {
    const { rows } = await db.query<{ device_id: string; created_at: Date; used_at: Date | null }>(
      "SELECT device_id, created_at, used_at FROM device_approvals WHERE token_hash = $1 FOR UPDATE", [tokenHash(ctx.params.token)]);
    const approval = rows[0];
    if (!approval) throw notFound();
    if (approval.used_at) throw new ApiError(409, "link_used", "This device is already approved.");
    if (Date.now() >= approval.created_at.getTime() + config.timers.deviceApprovalTtl * 1000) {
      throw new ApiError(410, "link_expired", "This approval link has expired.");
    }
    await db.query("UPDATE device_approvals SET used_at = now() WHERE token_hash = $1", [tokenHash(ctx.params.token)]);
    const updated = await db.query<DeviceRow>(
      "UPDATE devices SET approved = true WHERE id = $1 RETURNING id, name, approved, created_at", [approval.device_id]);
    return updated.rows[0];
  });
  sendJson(ctx.res, 200, { device: deviceJson(device) });
});
