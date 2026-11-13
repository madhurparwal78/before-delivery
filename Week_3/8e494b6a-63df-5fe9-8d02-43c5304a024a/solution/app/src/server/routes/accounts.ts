// Health, configuration, time, accounts and the signed-in profile.
import { config } from "../config";
import { now } from "../clock";
import { pool, tx, isUniqueViolation } from "../db";
import { errors } from "../errors";
import { clearedCookie, createSession, endSession, hashPassword, readCookie, sessionCookie, verifyPassword, COOKIE_NAME } from "../auth";
import { reply, route, ok } from "../http";
import { signedInUser } from "../access";
import { consume } from "../rate";
import { currentSeq } from "../live";
import { storageAnswers } from "../storage";
import { Check } from "../validate";
import { formatIso } from "../../shared/time";
import { isKnownZone } from "../../shared/zone";

interface Membership {
  slug: string;
  name: string;
  role: string;
}

export async function membershipsOf(userId: number): Promise<Membership[]> {
  const { rows } = await pool.query<Membership>(
    "SELECT s.slug, s.name, m.role FROM members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = $1 ORDER BY s.slug", [userId],
  );
  return rows;
}

/** The space a user is working in, repairing the pointer when it is missing. */
async function currentSpaceOf(userId: number, pointer: number | null): Promise<{ id: number; slug: string; name: string; role: string }> {
  const { rows } = await pool.query<{ id: number; slug: string; name: string; role: string }>(
    `SELECT s.id, s.slug, s.name, m.role FROM members m JOIN spaces s ON s.id = m.space_id
     WHERE m.user_id = $1 ORDER BY (s.id = $2) DESC, s.slug LIMIT 1`,
    [userId, pointer],
  );
  const space = rows[0];
  if (!space) throw errors.notFound();
  if (space.id !== pointer) await pool.query("UPDATE users SET current_space_id = $2 WHERE id = $1", [userId, space.id]);
  return space;
}

async function profile(userId: number, username: string, timeZone: string, pointer: number | null) {
  const space = await currentSpaceOf(userId, pointer);
  return {
    username,
    time_zone: timeZone,
    space: { slug: space.slug, name: space.name, role: space.role },
    spaces: await membershipsOf(userId),
    seq: await currentSeq(space.id),
  };
}

route("GET", "/api/health", "none", async () => {
  let database = true;
  try {
    await pool.query("SELECT 1");
  } catch {
    database = false;
  }
  return ok({ status: database && (await storageAnswers()) ? "ok" : "unavailable" });
});

route("GET", "/api/config", "none", async () => {
  const s = config.settings;
  return ok({
    grading: config.grading,
    settings: {
      page_size: s.pageSize, tail_buffer: s.tailBuffer, query_max_len: s.queryMaxLen, query_max_depth: s.queryMaxDepth,
      upload_max_bytes: s.uploadMaxBytes, sse_heartbeat_ms: s.sseHeartbeatMs,
    },
  });
});

route("GET", "/api/time", "none", async () => ok({ now: formatIso(now()), now_ms: now() }));

const USERNAME = /^[a-z0-9_]{3,24}$/;

route("POST", "/api/signup", "json", async (ctx) => {
  const body = ctx.json();
  const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const { rows: taken } = await pool.query("SELECT 1 FROM users WHERE username = $1 UNION SELECT 1 FROM spaces WHERE slug = $1", [username]);
  if (taken.length > 0) throw errors.nameTaken({ username: "That username is taken." });
  const check = new Check();
  if (!USERNAME.test(username)) check.fail("username", "Use 3 to 24 characters: a-z, 0-9 or _.");
  if (Array.from(password).length < 8) check.fail("password", "Use at least 8 characters.");
  check.done();
  const hash = await hashPassword(password);
  let userId: number;
  try {
    userId = await tx(async (client) => {
      const { rows: space } = await client.query<{ id: number }>("INSERT INTO spaces (slug, name) VALUES ($1, $1) RETURNING id", [username]);
      const { rows: user } = await client.query<{ id: number }>(
        "INSERT INTO users (username, password_hash, current_space_id) VALUES ($1, $2, $3) RETURNING id", [username, hash, (space[0] as { id: number }).id],
      );
      const id = (user[0] as { id: number }).id;
      await client.query("INSERT INTO members (space_id, user_id, role) VALUES ($1, $2, 'admin')", [(space[0] as { id: number }).id, id]);
      return id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw errors.nameTaken({ username: "That username is taken." });
    throw error;
  }
  return reply(201, { username, space: username }, { "set-cookie": sessionCookie(await createSession(userId)) });
});

route("POST", "/api/signin", "json", async (ctx) => {
  const body = ctx.json();
  const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
  consume("login", username);
  const { rows } = await pool.query<{ id: number; password_hash: string; current_space_id: number | null }>(
    "SELECT id, password_hash, current_space_id FROM users WHERE username = $1", [username],
  );
  const user = rows[0];
  const valid = await verifyPassword(typeof body.password === "string" ? body.password : "", user?.password_hash ?? null);
  if (!user || !valid) throw errors.badCredentials();
  const space = await currentSpaceOf(user.id, user.current_space_id);
  return reply(200, { username, space: space.slug }, { "set-cookie": sessionCookie(await createSession(user.id)) });
});

route("POST", "/api/signout", "none", async (ctx) => {
  await endSession(readCookie(ctx.req.headers.cookie, COOKIE_NAME));
  return reply(204, undefined, { "set-cookie": clearedCookie });
});

route("GET", "/api/me", "none", async (ctx) => {
  const user = await signedInUser(ctx);
  return ok(await profile(user.id, user.username, user.timeZone, user.currentSpaceId));
});

route("PATCH", "/api/me", "json", async (ctx) => {
  const user = await signedInUser(ctx);
  const body = ctx.json();
  let pointer = user.currentSpaceId;
  if (body.space !== undefined) {
    const { rows } = await pool.query<{ id: number }>(
      "SELECT s.id FROM spaces s JOIN members m ON m.space_id = s.id WHERE m.user_id = $1 AND s.slug = $2", [user.id, String(body.space)],
    );
    if (!rows[0]) throw errors.notFound();
    pointer = rows[0].id;
  }
  let zone = user.timeZone;
  if (body.time_zone !== undefined) {
    const requested = String(body.time_zone);
    if (!isKnownZone(requested)) throw errors.invalid({ time_zone: `Unknown time zone ${requested}.` });
    zone = new Intl.DateTimeFormat("en", { timeZone: requested }).resolvedOptions().timeZone;
  }
  await pool.query("UPDATE users SET time_zone = $2, current_space_id = $3 WHERE id = $1", [user.id, zone, pointer]);
  return ok(await profile(user.id, user.username, zone, pointer));
});
