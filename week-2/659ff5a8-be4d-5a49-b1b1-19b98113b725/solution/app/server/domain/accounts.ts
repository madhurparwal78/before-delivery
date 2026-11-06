import { z } from "zod";
import type { OperatorClub, SessionUser } from "../../shared/api.js";
import { isTimeZone } from "../../shared/time.js";
import { type Auth, CLUB_COLUMNS, hashPassword, sessionUser, verifyPassword } from "../auth.js";
import { one, pool, returning, rows, transaction } from "../db.js";
import { ApiError } from "../errors.js";
import { parse, text } from "../validate.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailField = z.string({ error: "Enter an email address." }).trim().regex(EMAIL, "Enter an email address.");
const passwordField = z
  .string({ error: "Use at least 10 characters." })
  .min(10, "Use at least 10 characters.")
  .max(200, "Use at most 200 characters.");

/** A string at a path of an untrusted body, for conflict checks that come before validation. */
function peek(body: unknown, ...path: string[]): string | null {
  let value: unknown = body;
  for (const key of path) {
    if (typeof value !== "object" || value === null || !(key in value)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" ? value : null;
}

async function emailTaken(email: string | null): Promise<boolean> {
  return email !== null && (await one(pool, "select 1 from users where lower(email) = lower($1)", [email.trim()])) !== null;
}

const loginSchema = z.object({
  email: z.string({ error: "Enter your email." }),
  password: z.string({ error: "Enter your password." }),
});

interface UserRow {
  id: number;
  password_hash: string;
}

export async function signIn(body: unknown): Promise<number> {
  const input = parse(loginSchema, body);
  const user = await one<UserRow>(pool, "select id, password_hash from users where lower(email) = lower($1)", [input.email.trim()]);
  if (!user || !(await verifyPassword(input.password, user.password_hash))) throw new ApiError("invalid_credentials");
  return user.id;
}

export async function signedInUser(userId: number): Promise<SessionUser> {
  const row = await returning<{
    name: string;
    email: string;
    roles: SessionUser["roles"];
    club: Auth["club"];
  }>(
    pool,
    `select u.name, u.email, u.roles, ${CLUB_COLUMNS}
       from users u left join clubs c on c.id = u.club_id where u.id = $1`,
    [userId],
  );
  return sessionUser({ userId, name: row.name, email: row.email, roles: row.roles, club: row.club });
}

const signupSchema = z.object({ name: text("Full name", 80), email: emailField, password: passwordField });

export async function signUp(clubSlug: string, body: unknown): Promise<number> {
  // Postgres text cannot hold a NUL byte; such a slug names no club.
  const club = clubSlug.includes("\0") ? null : await one<{ id: number }>(pool, "select id from clubs where slug = $1", [clubSlug]);
  if (!club) throw new ApiError("not_found");
  if (await emailTaken(peek(body, "email"))) throw new ApiError("email_taken");
  const input = parse(signupSchema, body);
  const user = await returning<{ id: number }>(
    pool,
    "insert into users (club_id, name, email, password_hash) values ($1, $2, $3, $4) returning id",
    [club.id, input.name, input.email, await hashPassword(input.password)],
  );
  return user.id;
}

const onboardSchema = z.object({
  slug: z.string({ error: "Enter a club slug." }).regex(/^[a-z][a-z0-9-]{2,30}$/, "Use 3 to 31 lowercase letters, digits or hyphens, starting with a letter."),
  name: text("Club name", 80),
  timeZone: z.string({ error: "Enter a time zone." }).refine(isTimeZone, "Enter an IANA time zone such as America/Denver."),
  chair: z.object(
    { name: text("Chair name", 80), email: emailField, password: passwordField },
    { error: "Enter the first chair's details." },
  ),
});

export async function onboardClub(body: unknown): Promise<{ club: { slug: string; name: string; timeZone: string }; chairId: number }> {
  const slug = peek(body, "slug");
  if (slug !== null && (await one(pool, "select 1 from clubs where slug = $1", [slug]))) throw new ApiError("slug_taken");
  if (await emailTaken(peek(body, "chair", "email"))) throw new ApiError("email_taken");
  const input = parse(onboardSchema, body);
  const password = await hashPassword(input.chair.password);
  return transaction(async (db) => {
    const club = await returning<{ id: number }>(
      db,
      "insert into clubs (slug, name, time_zone) values ($1, $2, $3) returning id",
      [input.slug, input.name, input.timeZone],
    );
    const chair = await returning<{ id: number }>(
      db,
      "insert into users (club_id, name, email, password_hash, roles) values ($1, $2, $3, $4, '{chair}') returning id",
      [club.id, input.chair.name, input.chair.email, password],
    );
    return { club: { slug: input.slug, name: input.name, timeZone: input.timeZone }, chairId: chair.id };
  });
}

export async function listClubs(): Promise<OperatorClub[]> {
  const found = await rows<{
    slug: string;
    name: string;
    time_zone: string;
    event_count: number;
    driver_count: number;
    published_count: number;
    failure_service: "renderer" | "storage" | "mail" | null;
    failure_event_id: number | null;
    failure_at: Date | null;
  }>(
    pool,
    `select c.slug, c.name, c.time_zone, c.failure_service, c.failure_event_id, c.failure_at,
            (select count(*)::int from events e where e.club_id = c.id) as event_count,
            (select count(*)::int from users u where u.club_id = c.id and not (u.roles && array['chair', 'timing', 'workers'])) as driver_count,
            (select count(*)::int from events e where e.club_id = c.id and e.status = 'published') as published_count
       from clubs c order by c.name`,
  );
  return found.map((c) => ({
    slug: c.slug,
    name: c.name,
    timeZone: c.time_zone,
    eventCount: c.event_count,
    driverCount: c.driver_count,
    publishedCount: c.published_count,
    lastDeliveryFailure:
      c.failure_service !== null && c.failure_at !== null
        ? { service: c.failure_service, eventId: c.failure_event_id, at: c.failure_at.toISOString() }
        : null,
  }));
}
