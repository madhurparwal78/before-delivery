import { newId, config } from "../config";
import { now } from "../clock";
import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError } from "../errors";
import { newSessionToken, verifyPassword } from "../auth";
import type { Ctx, Person, Studio } from "../http/context";
import { sendJson, setCookie, clearCookie } from "../http/context";
import { userBody } from "./bodies";
import { publish } from "../events";

const WAIT_MINUTES_MS = 60000;

function tooManyAttempts(lockUntilMs: number): ApiError {
  const wait = Math.max(1, Math.ceil((lockUntilMs - now().getTime()) / WAIT_MINUTES_MS));
  return new ApiError(429, "too_many_attempts", `Too many sign-in attempts. Try again in ${wait} minutes.`);
}

export async function postSession(ctx: Ctx): Promise<void> {
  const studioSlug = typeof ctx.body.studio === "string" ? ctx.body.studio.trim() : "";
  const email = typeof ctx.body.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
  const password = typeof ctx.body.password === "string" ? ctx.body.password : "";

  const outcome = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.signin(studioSlug, email)]);
    const failure = await one<{ failures: number; lock_until: Date | null; last_failure_at: Date | null }>(
      client,
      "SELECT failures, lock_until, last_failure_at FROM signin_failures WHERE studio_slug = $1 AND email = $2",
      [studioSlug, email],
    );
    if (failure && failure.failures >= 5 && failure.lock_until && now() < failure.lock_until) {
      return { kind: "locked" as const, lockUntil: failure.lock_until.getTime() };
    }
    const studioRow = await one<Studio>(client, "SELECT * FROM studios WHERE slug = $1", [studioSlug]);
    let person: (Person & { password_hash: string }) | undefined;
    if (studioRow) {
      person = await one<Person & { password_hash: string }>(client, "SELECT *, password_hash FROM people WHERE studio_id = $1 AND lower(email) = $2", [studioRow.id, email]);
    }
    if (!person || !verifyPassword(password, person.password_hash)) {
      // Count the failure; the fifth failure starts the lock.
      const prev = failure?.failures ?? 0;
      const last = failure?.last_failure_at ? failure.last_failure_at.getTime() : 0;
      const withinWindow = last > 0 && now().getTime() - last < config.signinLockSeconds * 1000;
      const failures = withinWindow ? prev + 1 : 1;
      const lockUntil = failures >= 5 ? new Date(now().getTime() + config.signinLockSeconds * 1000) : null;
      await client.query(
        `INSERT INTO signin_failures (studio_slug, email, failures, lock_until, last_failure_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (studio_slug, email) DO UPDATE SET failures = $3, lock_until = $4, last_failure_at = $5`,
        [studioSlug, email, failures, lockUntil, now()],
      );
      return { kind: "invalid" as const };
    }
    if (!person.active) {
      return { kind: "inactive" as const };
    }
    await client.query("DELETE FROM signin_failures WHERE studio_slug = $1 AND email = $2", [studioSlug, email]);
    const token = newSessionToken();
    await client.query("INSERT INTO sessions (token, person_id, studio_id, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)", [
      token,
      person.id,
      studioRow!.id,
      new Date(now().getTime() + config.sessionTtlSeconds * 1000),
      now(),
    ]);
    return { kind: "ok" as const, person, studio: studioRow!, token };
  });

  if (outcome.kind === "locked") throw tooManyAttempts(outcome.lockUntil);
  if (outcome.kind === "invalid") throw new ApiError(401, "invalid_credentials", "Studio, email or password is wrong.");
  if (outcome.kind === "inactive") throw new ApiError(403, "account_inactive", "This account is not active. Ask the studio owner.");

  setCookie(ctx.res, "kd_session", outcome.token, { secure: (ctx.req.socket as { encrypted?: boolean }).encrypted === true });
  sendJson(ctx.res, 200, userBody(outcome.person, outcome.studio));
}

export async function getMe(ctx: Ctx): Promise<void> {
  const person = ctx.person as Person;
  const studio = ctx.studio as Studio;
  sendJson(ctx.res, 200, {
    user: {
      id: person.id,
      name: person.name,
      handle: person.handle,
      role: person.role,
      studio: { slug: studio.slug, name: studio.name, time_zone: studio.time_zone },
    },
  });
}

export async function deleteSession(ctx: Ctx): Promise<void> {
  const token = ctx.sessionToken;
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    await publish(pool, "session", token, (ctx.studio as Studio).id, { sessionId: token });
  }
  clearCookie(ctx.res, "kd_session");
  ctx.res.writeHead(204, { "Cache-Control": "no-store" });
  ctx.res.end();
}
