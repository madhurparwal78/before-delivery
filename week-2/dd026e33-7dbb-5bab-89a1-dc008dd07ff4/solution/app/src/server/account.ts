// Sign-in, sign-out, the signed-in user, unit settings, house settings, health and service status.
import { HOUSE_NAME } from "../shared/domain.js";
import { honouredReturnAddress, ROLE_HOME } from "../shared/returnAddress.js";
import type { Me } from "../shared/api.js";
import type { Units } from "../shared/units.js";
import { HOUSE_TIME_ZONE } from "../shared/zurich.js";
import { clearedCookie, sessionCookie, signIn, signOut, type SessionUser } from "./auth.js";
import { one, type Db } from "./db.js";
import { FieldErrors, invalidCredentials } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { VAT_RATE_TEXT, chf, LABOUR_RATE_CENTIMES } from "./money.js";
import { CLEARANCE_MM } from "./bays.js";
import { serviceStatus } from "./status.js";

export async function createSession(ctx: Ctx): Promise<Reply> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const errors = new FieldErrors();
  if (email === "") errors.add("email", "Enter your email and password.");
  if (password === "") errors.add("password", "Enter your email and password.");
  errors.throwIfAny();
  const started = await signIn(email, password);
  if (!started) throw invalidCredentials();
  const redirect = honouredReturnAddress(body.next) ?? ROLE_HOME[started.user.role];
  return { status: 200, body: { user: started.user, redirect }, headers: { "Set-Cookie": sessionCookie(started.token) } };
}

export async function deleteSession(ctx: Ctx): Promise<Reply> {
  await signOut(ctx.db, ctx.user.sessionId);
  return { status: 204, headers: { "Set-Cookie": clearedCookie() } };
}

async function unitsOf(db: Db, userId: string): Promise<Units> {
  const row = await one<{ film: Units["film"]; pressure: Units["pressure"]; distance: Units["distance"] }>(
    db,
    "SELECT units_film AS film, units_pressure AS pressure, units_distance AS distance FROM users WHERE id = $1",
    [userId],
  );
  return row ?? { film: "um", pressure: "bar", distance: "km" };
}

/** The signed-in user and their units, as GET /api/me answers. */
export async function meOf(db: Db, user: SessionUser): Promise<Me> {
  const { id, name, email, role } = user;
  return { user: { id, name, email, role }, units: await unitsOf(db, id) };
}

export async function getMe(ctx: Ctx): Promise<Reply> {
  return { status: 200, body: await meOf(ctx.db, ctx.user) };
}

export async function putUnits(ctx: Ctx): Promise<Reply> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors = new FieldErrors();
  const message = "Choose one of the listed units.";
  if (body.film !== "um" && body.film !== "mil") errors.add("film", message);
  if (body.pressure !== "bar" && body.pressure !== "psi") errors.add("pressure", message);
  if (body.distance !== "km" && body.distance !== "mi") errors.add("distance", message);
  errors.throwIfAny();
  await ctx.db.query("UPDATE users SET units_film = $2, units_pressure = $3, units_distance = $4 WHERE id = $1", [
    ctx.user.id,
    body.film,
    body.pressure,
    body.distance,
  ]);
  return { status: 200, body: { units: await unitsOf(ctx.db, ctx.user.id) } };
}

export async function getHouse(): Promise<Reply> {
  return {
    status: 200,
    body: {
      name: HOUSE_NAME,
      time_zone: HOUSE_TIME_ZONE,
      currency: "CHF",
      vat_rate: VAT_RATE_TEXT,
      labour_rate: chf(LABOUR_RATE_CENTIMES),
      clearance_mm: CLEARANCE_MM,
    },
  };
}

export async function getHealth(): Promise<Reply> {
  return { status: 200, body: { status: "ok" } };
}

export async function getStatus(): Promise<Reply> {
  return { status: 200, body: await serviceStatus() };
}
