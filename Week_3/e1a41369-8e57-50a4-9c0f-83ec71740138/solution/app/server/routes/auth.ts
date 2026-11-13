import { one, pool, transaction } from "../db.js";
import { FULL_HEALTH_TENTHS, loadUser } from "../domain/progress.js";
import { hashPassword, passwordMatches } from "../domain/passwords.js";
import { insertUser, validateCredentials, validateDayStartHour, validateZone } from "../domain/accounts.js";
import { scheduleClose, runDueCloses } from "../domain/close.js";
import { Message, Refusal, invalid } from "../errors.js";
import { SESSION_COOKIE, hashToken, newToken, reply, route, sessionToken, type Reply } from "../http.js";
import { mutate, serialized } from "../mutate.js";
import type { UserRow } from "../records.js";
import { playerView } from "../views.js";

export const UNIQUE_VIOLATION = "23505";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function startSession(user: UserRow, status: number): Promise<Reply> {
  const token = newToken();
  await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [hashToken(token), user.id]);
  return {
    status,
    body: await playerView(pool, user),
    headers: { "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}` },
  };
}

route("POST", "/api/auth/signup", async (c) => {
  const input = c.json(asObject);
  if (typeof input.username === "string" && (await one(pool, "SELECT 1 FROM users WHERE username = $1", [input.username]))) {
    throw Refusal.usernameTaken();
  }
  const { username, password } = validateCredentials(input.username, input.password);
  const passwordHash = await hashPassword(password);
  const created = await transaction((db) =>
    insertUser(
      db,
      { username, passwordHash, timeZone: "UTC", dayStartHour: 0, resting: false, level: 1, experience: 0, healthTenths: FULL_HEALTH_TENTHS, goldCents: 0 },
      new Date(),
    ),
  ).catch((error: unknown) => {
    throw (error as { code?: string }).code === UNIQUE_VIOLATION ? Refusal.usernameTaken() : error;
  });
  return startSession(await loadUser(pool, created.id), 201);
});

route("POST", "/api/auth/login", async (c) => {
  const input = c.json(asObject);
  const user =
    typeof input.username === "string" ? await one<UserRow>(pool, "SELECT * FROM users WHERE username = $1", [input.username]) : undefined;
  if (!user || typeof input.password !== "string" || !(await passwordMatches(input.password, user.password_hash))) {
    throw Refusal.invalidCredentials();
  }
  return startSession(user, 200);
});

route("POST", "/api/auth/logout", async (c) => {
  await c.user();
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(sessionToken(c.req)!)]);
  return { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } };
});

route("GET", "/api/me", async (c) => reply(200, await playerView(pool, await c.user())));

route("PATCH", "/api/settings", async (c) => {
  const user = await c.user();
  const input = c.json(asObject);
  const errors: Record<string, string> = {};
  const timeZone = "timeZone" in input ? validateZone(input.timeZone) : undefined;
  const dayStartHour = "dayStartHour" in input ? validateDayStartHour(input.dayStartHour) : undefined;
  if ("timeZone" in input && timeZone === undefined) errors.timeZone = Message.timeZone;
  if ("dayStartHour" in input && dayStartHour === undefined) errors.dayStartHour = Message.dayStartHour;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  await mutate(async (db, touch) => {
    await db.query(
      "UPDATE users SET time_zone = COALESCE($2, time_zone), day_start_hour = COALESCE($3, day_start_hour), resting = COALESCE($4, resting) WHERE id = $1",
      [user.id, timeZone ?? null, dayStartHour ?? null, typeof input.resting === "boolean" ? input.resting : null],
    );
    if (timeZone !== undefined || dayStartHour !== undefined) await scheduleClose(db, user.id);
    touch.player(user.id);
  });
  await serialized(() => runDueCloses(new Date(), user.id));
  return reply(200, await playerView(pool, await loadUser(pool, user.id)));
});

route("POST", "/api/notices/:id/ack", async (c) => {
  const user = await c.user();
  await mutate(async (db, touch) => {
    const notice = await one<{ id: string }>(db, "UPDATE notices SET acknowledged = true WHERE id::text = $1 AND user_id = $2 RETURNING id", [c.params.id, user.id]);
    if (!notice) throw Refusal.notFound();
    touch.player(user.id);
  });
  return reply(204);
});
