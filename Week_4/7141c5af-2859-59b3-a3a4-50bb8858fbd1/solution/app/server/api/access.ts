import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { one, query, tx } from "../db/pool.ts";
import { seedDeskStart } from "../db/seed.ts";
import { copy } from "../domain/copy.ts";
import { instant, timeCopy, turinToday } from "../domain/time.ts";
import { ApiError, conflict, invalid } from "../http/errors.ts";
import { empty, json, route } from "../http/router.ts";
import { clearedCookie, sessionCookie, startSession } from "../http/session.ts";
import { entryOfMaterial, syncEntries } from "../providers/meili.ts";
import { bodyOf, checkFields, emailField, requiredText } from "./fields.ts";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const KEY_LENGTH = 32;
const MIN_PASSWORD = 10;
const PASSWORD_LIMIT = 1000;
const LANDING = "/pieces";
const DECOY_HASH = `${"00".repeat(16)}$${"00".repeat(KEY_LENGTH)}`;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}$${(await derive(password, salt, KEY_LENGTH)).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = "", key = ""] = stored.split("$");
  return timingSafeEqual(await derive(password, Buffer.from(salt, "hex"), KEY_LENGTH), Buffer.from(key, "hex"));
}

function newPassword(value: string, field: string): string {
  if ([...value].length < MIN_PASSWORD) throw invalid(field, copy("F-10"));
  return value;
}

/** A return address is honoured only as a same-origin relative path; every other value lands on the Pieces list. */
function landing(returnTo: unknown): string {
  if (typeof returnTo !== "string" || !/^\/(?![/\\])/.test(returnTo) || /[\u0000-\u001f\u007f\\]/.test(returnTo)) return LANDING;
  return new URL(returnTo, "http://desk.invalid").host === "desk.invalid" ? returnTo : LANDING;
}

interface DeskRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
}

async function latestAnswer(deskId: string): Promise<{ id: string; message: string; at: string } | null> {
  const row = await one<{ piece_id: string; answered_at: Date; stamp: string; name: string; title: string }>(
    `SELECT cp.piece_id, cp.answered_at, to_char(cp.answered_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS stamp, c.name, p.title
     FROM client_pages cp JOIN pieces p ON p.id = cp.piece_id JOIN clients c ON c.id = p.client_id
     WHERE p.desk_id = $1 AND cp.answered_at IS NOT NULL AND c.state NOT IN ('erasing', 'erased')
     ORDER BY cp.answered_at DESC LIMIT 1`,
    [deskId],
  );
  if (!row) return null;
  return { id: `${row.piece_id}-${row.stamp}`, message: copy("F-46", { name: row.name, title: row.title, time: timeCopy(row.answered_at) }), at: instant(row.answered_at) };
}

export function register(): void {
  route({ method: "GET", pattern: "/api/health", access: "public", handle: async () => json(200, { status: "ok" }) });

  route({
    method: "POST",
    pattern: "/api/sign-up",
    access: "public",
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const fields = checkFields({
        name: () => requiredText(body, "name", 120),
        email: () => emailField(body),
        password: () => newPassword(requiredText(body, "password", PASSWORD_LIMIT), "password"),
      });
      const deskId = randomUUID();
      const passwordHash = await hashPassword(fields.password);
      const materials = await tx(async (client) => {
        const made = await client.query(
          `INSERT INTO desks (id, name, email, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (lower(email)) DO NOTHING`,
          [deskId, fields.name, fields.email, passwordHash],
        );
        if (made.rowCount === 0) throw conflict("emailTaken", copy("F-109"));
        return seedDeskStart(client, deskId);
      });
      syncEntries(materials.map((material) => entryOfMaterial(deskId, material)));
      const token = await startSession(deskId, config.sessionSeconds);
      return json(201, { session: { deskId, name: fields.name, email: fields.email, landing: LANDING } }, { "Set-Cookie": sessionCookie(token) });
    },
  });

  route({
    method: "POST",
    pattern: "/api/session",
    access: "public",
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const fields = checkFields({ email: () => requiredText(body, "email", 254), password: () => requiredText(body, "password", PASSWORD_LIMIT) });
      const desk = await one<DeskRow>("SELECT * FROM desks WHERE lower(email) = lower($1)", [fields.email.trim()]);
      const matches = await passwordMatches(fields.password, desk?.password_hash ?? DECOY_HASH);
      if (!desk || !matches) throw new ApiError(401, "wrongPair", copy("F-09"));
      const token = await startSession(desk.id, config.sessionSeconds);
      return json(200, { session: { deskId: desk.id, name: desk.name, email: desk.email, landing: landing(body.returnTo) } }, { "Set-Cookie": sessionCookie(token) });
    },
  });

  route({
    method: "GET",
    pattern: "/api/session",
    handle: async (ctx) => {
      const session = ctx.session as NonNullable<typeof ctx.session>;
      return json(200, { session: { deskId: session.deskId, name: session.name, email: session.email, today: turinToday(), latestAnswer: await latestAnswer(session.deskId) } });
    },
  });

  route({
    method: "DELETE",
    pattern: "/api/session",
    handle: async (ctx) => {
      await query("UPDATE sessions SET ended_at = now() WHERE id = $1", [ctx.session?.id]);
      return empty(204, { "Set-Cookie": clearedCookie() });
    },
  });

  route({
    method: "POST",
    pattern: "/api/password",
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const fields = checkFields({
        currentPassword: () => requiredText(body, "currentPassword", PASSWORD_LIMIT),
        newPassword: () => newPassword(requiredText(body, "newPassword", PASSWORD_LIMIT), "newPassword"),
      });
      const desk = await one<DeskRow>("SELECT * FROM desks WHERE id = $1", [ctx.deskId]);
      if (!desk || !(await passwordMatches(fields.currentPassword, desk.password_hash))) throw invalid("currentPassword", copy("F-09"));
      const passwordHash = await hashPassword(fields.newPassword);
      await tx(async (client) => {
        await client.query("UPDATE desks SET password_hash = $2 WHERE id = $1", [ctx.deskId, passwordHash]);
        await client.query("UPDATE sessions SET ended_at = now() WHERE desk_id = $1 AND id <> $2 AND ended_at IS NULL", [ctx.deskId, ctx.session?.id]);
      });
      return empty(204);
    },
  });
}
