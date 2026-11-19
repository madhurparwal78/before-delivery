// Health, service status, the server clock, sign-in and the people picker (brief: API).
import { randomBytes } from "node:crypto";
import { pool, tx } from "./db.js";
import { config } from "./config.js";
import { companyDate, now, parseInstant, setNow } from "./clock.js";
import {
  bodyObject, directoryUnavailable, forbidden, hashToken, invalid, notFound, publicRoute, route, sendEmpty, sendJson,
  SESSION_COOKIE, Fail,
} from "./http.js";
import { authenticate, DirectoryUnavailable, searchPeople } from "./directory.js";
import { status } from "./services.js";
import { sweep } from "./sweep.js";
import { publish } from "./changes.js";
import type { Clock } from "../shared/api.js";

const COOKIE_MAX_AGE_S = 400 * 86_400;

export const boot = { ready: false };

function clockBody(): Clock {
  const instant = now();
  return { now: instant.toISOString(), today: companyDate(instant), zone: "America/Phoenix" };
}

function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function register(): void {
  publicRoute("GET", "/api/health", async ({ res }) => {
    if (boot.ready) sendJson(res, 200, { status: "ok" });
    else sendJson(res, 503, { status: "starting" });
  });

  publicRoute("GET", "/api/status", async ({ res }) => sendJson(res, 200, { ...status }));

  publicRoute("GET", "/api/clock", async ({ res }) => sendJson(res, 200, clockBody()));

  publicRoute("PUT", "/api/clock", async (ctx) => {
    if (!config.clockControl) throw notFound();
    const instant = parseInstant(bodyObject(ctx).now);
    if (!instant) throw invalid({ now: "Give an ISO 8601 instant with an offset." });
    setNow(instant);
    await sweep();
    sendJson(ctx.res, 200, clockBody());
  });

  publicRoute("POST", "/api/session", async (ctx) => {
    const body = bodyObject(ctx);
    const fields: Record<string, string> = {};
    if (typeof body.email !== "string" || !body.email.trim()) fields.email = "Enter your email.";
    if (typeof body.password !== "string" || !body.password) fields.password = "Enter your password.";
    if (Object.keys(fields).length || typeof body.email !== "string" || typeof body.password !== "string") throw invalid(fields);
    let person;
    try {
      person = await authenticate(body.email.trim(), body.password);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    if (!person) throw new Fail(401, { error: "invalid_credentials" });
    const token = randomBytes(32).toString("base64url");
    await pool.query("INSERT INTO sessions (token_hash, person, created_at) VALUES ($1, $2, $3)", [hashToken(token), JSON.stringify(person), now()]);
    sendJson(ctx.res, 200, { person }, { "set-cookie": sessionCookie(token, COOKIE_MAX_AGE_S) });
  });

  route("GET", "/api/session", async ({ res, session }) => sendJson(res, 200, { person: session.person }));

  route("DELETE", "/api/session", async ({ res, session }) => {
    await tx(async (client) => {
      await client.query("DELETE FROM sessions WHERE token_hash = $1", [session.tokenHash]);
      await publish(client, { kind: "signout", sessionHash: session.tokenHash });
    });
    sendEmpty(res, 204, { "set-cookie": sessionCookie("", 0) });
  });

  route("GET", "/api/people", async ({ res, url, session }) => {
    if (session.person.kind !== "staff") throw forbidden();
    const q = url.searchParams.get("q") ?? "";
    const kind = url.searchParams.get("kind");
    const fields: Record<string, string> = {};
    if (q.length < 1 || q.length > 100) fields.q = "Enter 1 to 100 characters.";
    if (kind !== null && kind !== "staff" && kind !== "partner") fields.kind = "Choose staff or partner.";
    if (Object.keys(fields).length) throw invalid(fields);
    try {
      sendJson(res, 200, { people: await searchPeople(q, kind === "staff" || kind === "partner" ? kind : null) });
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
  });
}
