// Sign-in, the signed-in user, and the dependency status probe.
import type { SystemStatus, User } from "../../shared/api.js";
import { endSession, startSession, USER_COLUMNS } from "../auth.js";
import { one, pool } from "../db.js";
import { ApiError, invalid } from "../errors.js";
import { json, route } from "../http.js";
import { killBillReachable } from "../killbill.js";
import { mailReachable } from "../mail.js";
import { PASSCODE } from "../seed.js";
import { storageReachable } from "../storage.js";
import { text } from "./common.js";

route("POST", "/api/session", "public", async (ctx) => {
  const email = text(ctx.body.email)?.trim().toLowerCase() ?? "";
  const passcode = text(ctx.body.passcode) ?? "";
  const fields: Record<string, string> = {};
  if (!email) fields.email = "Enter your email.";
  if (!passcode) fields.passcode = "Enter the passcode.";
  if (Object.keys(fields).length) throw invalid(fields);
  const user = await one<User>(pool, `SELECT ${USER_COLUMNS} FROM users u WHERE lower(u.email) = $1`, [email]);
  if (!user || passcode !== PASSCODE) throw new ApiError("invalid_credentials");
  return json(200, { user }, { "set-cookie": await startSession(user.id) });
});

route("DELETE", "/api/session", "signed-in", async (ctx) => ({ status: 204, headers: { "set-cookie": await endSession(ctx.req) } }));

route("GET", "/api/me", "signed-in", async (ctx) => json(200, { user: ctx.user }));

route("GET", "/api/system/status", "public", async () => {
  const [killbill, mail, storage] = await Promise.all([killBillReachable(), mailReachable(), storageReachable()]);
  const status: SystemStatus = {
    postgres: "up",
    killbill: killbill ? "up" : "down",
    mail: mail ? "up" : "down",
    storage: storage ? "up" : "down",
  };
  return json(200, status);
});
