import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import { errConflict, errNotFound, errValidation } from "../errors.js";
import { createSession, destroySession, requireUser } from "../session.js";
import { verifyPassword, hashPassword } from "../seed.js";
import { newId } from "../ids.js";
import { setSessionCookie, clearSessionCookie } from "../app.js";
import { timeZoneIsValid } from "../time.js";

const SLUG_RE = /^[a-z][a-z0-9-]{2,30}$/;

export function userObject(row: Record<string, unknown>): Record<string, unknown> {
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      roles: row.is_operator ? ["operator"] : (row.staff_roles as string[]),
      club: row.club_slug
        ? { slug: row.club_slug, name: row.club_name, timeZone: row.club_time_zone }
        : null,
    },
  };
}

export async function findUser(db: Db, email: string): Promise<Record<string, unknown> | null> {
  const rows = await db.query(
    `SELECT u.*, c.slug AS club_slug, c.name AS club_name, c.time_zone AS club_time_zone
     FROM users u LEFT JOIN clubs c ON c.id = u.club_id
     WHERE u.email = $1`,
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

export function registerAuthRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/health", async () => ({ status: "ok" }));

  // Public club name for the join screen heading.
  app.get("/api/clubs/:clubSlug", async (request, reply) => {
    const params = request.params as { clubSlug: string };
    const rows = await db.query(`SELECT slug, name, time_zone FROM clubs WHERE slug = $1`, [params.clubSlug]);
    if (!rows[0]) throw errNotFound("Club not found.");
    reply.send({ club: { slug: rows[0].slug, name: rows[0].name, timeZone: rows[0].time_zone } });
  });

  app.post("/api/session", async (request, reply) => {
    const body = z.object({ email: z.string().min(1), password: z.string().min(1) }).parse(request.body ?? {});
    const row = await findUser(db, body.email);
    if (!row || !verifyPassword(body.password, row.password_hash as string)) {
      reply.status(401).send({ error: "invalid_credentials", message: "Email or password is incorrect." });
      return;
    }
    const token = await createSession(db, row.id as string);
    setSessionCookie(reply, token);
    reply.send(userObject(row));
  });

  app.get("/api/session", async (request, reply) => {
    const user = await requireUser(request);
    const row = await findUser(db, user.email);
    if (!row) throw errNotFound();
    reply.send(userObject(row));
  });

  app.delete("/api/session", async (request, reply) => {
    await requireUser(request);
    const token = request.headers.cookie?.match(/paddock_session=([^;]+)/)?.[1];
    if (token) await destroySession(db, token);
    clearSessionCookie(reply);
    reply.status(204).send();
  });

  app.post("/api/clubs/:clubSlug/signup", async (request, reply) => {
    const params = request.params as { clubSlug: string };
    const schema = z.object({
      name: z.string().trim().min(1).max(80),
      email: z.string().email(),
      password: z.string().min(10),
    });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    const clubRows = await db.query(`SELECT id FROM clubs WHERE slug = $1`, [params.clubSlug]);
    if (!clubRows[0]) throw errNotFound("Club not found.");
    const existing = await findUser(db, parsed.value.email);
    if (existing) throw errConflict("email_taken", "That email already has an account.");
    const id = newId("usr");
    await db.query(
      `INSERT INTO users (id, club_id, name, email, password_hash, is_operator, staff_roles)
       VALUES ($1,$2,$3,$4,$5,false,'{}')`,
      [id, clubRows[0].id, parsed.value.name, parsed.value.email.toLowerCase(), hashPassword(parsed.value.password)],
    );
    const token = await createSession(db, id);
    setSessionCookie(reply, token);
    const row = await findUser(db, parsed.value.email);
    reply.status(201).send(userObject(row as Record<string, unknown>));
  });

  app.post("/api/operator/clubs", async (request, reply) => {
    const user = await requireUser(request);
    if (!user.isOperator) {
      reply.status(403).send({ error: "forbidden", message: "Operators only." });
      return;
    }
    const schema = z.object({
      slug: z.string().regex(SLUG_RE),
      name: z.string().trim().min(1).max(80),
      timeZone: z.string().refine(timeZoneIsValid, { message: "Unknown time zone." }),
      chair: z.object({
        name: z.string().trim().min(1).max(80),
        email: z.string().email(),
        password: z.string().min(10),
      }),
    });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    const slugTaken = await db.query(`SELECT id FROM clubs WHERE slug = $1`, [parsed.value.slug]);
    if (slugTaken[0]) throw errConflict("slug_taken", "That club slug is taken.");
    const existing = await findUser(db, parsed.value.chair.email);
    if (existing) throw errConflict("email_taken", "That email already has an account.");

    const clubId = newId("club");
    const chairId = newId("usr");
    await db.tx(async (client) => {
      await client.query(
        `INSERT INTO clubs (id, slug, name, time_zone) VALUES ($1,$2,$3,$4)`,
        [clubId, parsed.value.slug, parsed.value.name, parsed.value.timeZone],
      );
      await client.query(
        `INSERT INTO users (id, club_id, name, email, password_hash, is_operator, staff_roles)
         VALUES ($1,$2,$3,$4,$5,false,ARRAY['chair'])`,
        [chairId, clubId, parsed.value.chair.name, parsed.value.chair.email.toLowerCase(), hashPassword(parsed.value.chair.password)],
      );
    });
    const club = (await db.query(`SELECT slug, name, time_zone AS "timeZone" FROM clubs WHERE id = $1`, [clubId]))[0];
    const chair = await findUser(db, parsed.value.chair.email);
    reply.status(201).send({
      club,
      chair: userObject(chair as Record<string, unknown>),
    });
  });

  app.get("/api/operator/clubs", async (request, reply) => {
    const user = await requireUser(request);
    if (!user.isOperator) {
      reply.status(403).send({ error: "forbidden", message: "Operators only." });
      return;
    }
    const clubs = await db.query(
      `SELECT c.slug, c.name, c.time_zone AS "timeZone",
              (SELECT count(*)::int FROM events e WHERE e.club_id = c.id) AS "eventCount",
              (SELECT count(*)::int FROM users u WHERE u.club_id = c.id AND u.staff_roles = '{}') AS "driverCount",
              (SELECT count(*)::int FROM events e WHERE e.club_id = c.id AND e.status = 'published') AS "publishedCount",
              (SELECT json_build_object('service', f.service, 'eventId', f.event_id, 'at', to_char(f.at, 'YYYY-MM-DD HH24:MI'))
               FROM delivery_failures f WHERE f.club_id = c.id ORDER BY f.at DESC LIMIT 1) AS "lastDeliveryFailure"
       FROM clubs c ORDER BY c.name`,
    );
    reply.send({ clubs });
  });
}

export function safeParse<T>(schema: z.ZodType<T>, input: unknown): { ok: true; value: T } | { ok: false; fields: Record<string, string> } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "form";
    if (!fields[path]) fields[path] = issue.message;
  }
  return { ok: false, fields };
}
