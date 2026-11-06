/**
 * Accounts: sign-up as a retail customer or a trade applicant, sign-in, sign-out,
 * the current caller and the lighting dial choice.
 */

import { query, queryOne, transaction } from "../db/pool.js";
import { hashPassword, verifyPassword } from "../passwords.js";
import { isValidEmail, isValidNzbn, LIMITS } from "../../shared/domain.js";
import type { DialMode, Occupation, User } from "../../shared/types.js";
import { readJson, sendJson, sendNoContent, type Ctx } from "../http/context.js";
import { emailTaken, invalidCredentials } from "../http/errors.js";
import {
  clearedSessionCookieHeader,
  createSession,
  destroySession,
  sessionCookieHeader,
  toUser,
} from "../http/session.js";
import { requireUser } from "../http/router.js";
import { FieldErrors, oneOf, requiredString } from "../http/validate.js";

const OCCUPATIONS: readonly Occupation[] = ["electrician", "architect", "lighting_designer", "wholesaler"];
const DIAL_MODES: readonly DialMode[] = ["auto", "morning", "day", "evening", "night", "gallery"];

interface SignupBody {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  account_type?: unknown;
  trade?: { business_name?: unknown; nzbn?: unknown; occupation?: unknown };
}

interface UserRowWithHash {
  id: string;
  email: string;
  name: string;
  role: "retail" | "trade" | "admin";
  trade_status: User["trade_status"];
  dial_mode: DialMode;
  password_hash: string;
}

export async function signup(ctx: Ctx): Promise<void> {
  const body = readJson<SignupBody>(ctx);
  const errors = new FieldErrors();

  const email = requiredString(errors, "email", body.email, { max: 254 }).toLowerCase();
  if (email !== "" && !isValidEmail(email)) errors.set("email", "invalid");

  const password = typeof body.password === "string" ? body.password : "";
  if (password === "") errors.set("password", "required");
  else if (password.length < LIMITS.password.min) errors.set("password", "too_short");

  const name = requiredString(errors, "name", body.name, { max: 120 });
  const accountType = oneOf(errors, "account_type", body.account_type, ["retail", "trade"] as const);

  let businessName = "";
  let nzbn = "";
  let occupation: Occupation = "electrician";
  if (accountType === "trade") {
    if (body.trade === undefined || body.trade === null || typeof body.trade !== "object") {
      errors.set("trade", "required");
    } else {
      businessName = requiredString(errors, "business_name", body.trade.business_name, { max: 160 });
      nzbn = requiredString(errors, "nzbn", body.trade.nzbn, { max: 13 });
      if (nzbn !== "" && !isValidNzbn(nzbn)) errors.set("nzbn", "invalid");
      occupation = oneOf(errors, "occupation", body.trade.occupation, OCCUPATIONS);
    }
  }

  errors.throwIfAny();

  const existing = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing) throw emailTaken();

  const passwordHash = await hashPassword(password);
  const created = await transaction(async (client) => {
    const inserted = await client.query<UserRowWithHash>(
      `INSERT INTO users (email, name, password_hash, role, trade_status)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, email, name, role, trade_status, dial_mode, password_hash`,
      [email, name, passwordHash, accountType, accountType === "trade" ? "submitted" : null],
    );
    const user = inserted.rows[0];
    if (!user) throw new Error("failed to create the account");

    if (accountType === "trade") {
      await client.query(
        `INSERT INTO trade_applications (user_id, business_name, nzbn, occupation, status)
         VALUES ($1,$2,$3,$4,'submitted')`,
        [user.id, businessName, nzbn, occupation],
      );
    }
    return user;
  });

  const token = await createSession(created.id);
  sendJson(ctx.res, 201, { user: toUser(created) }, { "set-cookie": sessionCookieHeader(token) });
}

export async function signin(ctx: Ctx): Promise<void> {
  const body = readJson<{ email?: unknown; password?: unknown }>(ctx);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const found = await queryOne<UserRowWithHash>(
    "SELECT id, email, name, role, trade_status, dial_mode, password_hash FROM users WHERE email = $1",
    [email],
  );
  if (!found || !(await verifyPassword(password, found.password_hash))) throw invalidCredentials();

  const token = await createSession(found.id);
  sendJson(ctx.res, 200, { user: toUser(found) }, { "set-cookie": sessionCookieHeader(token) });
}

export async function signout(ctx: Ctx): Promise<void> {
  requireUser(ctx);
  await destroySession(ctx.headers);
  sendNoContent(ctx.res, { "set-cookie": clearedSessionCookieHeader() });
}

export async function me(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  sendJson(ctx.res, 200, { user });
}

export async function setDial(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const body = readJson<{ mode?: unknown }>(ctx);
  const errors = new FieldErrors();
  const mode = oneOf(errors, "mode", body.mode, DIAL_MODES);
  errors.throwIfAny();

  await query("UPDATE users SET dial_mode = $2 WHERE id = $1", [user.id, mode]);
  sendJson(ctx.res, 200, { dial_mode: mode });
}
