import type { Router, Request, Response, NextFunction } from "express";
import type { Services } from "../services.js";
import type { AppConfig } from "../config.js";
import { verifyPassword, newToken } from "../auth.js";
import { errors, ApiError } from "../errors.js";
import { parseStrictBody } from "../validation.js";
import { jsonLimit, handleRouteError } from "../web.js";
import type { AppRequest } from "../web.js";
import type { PersonRow } from "../domain/essays.js";

// Sessions, the server clock, the health check, body limits, same-origin
// enforcement and static serving.
export function registerSessionRoutes(router: Router, services: Services, config: AppConfig): void {
  const { sql, clock } = services;

  // Same origin only: a state-changing request whose Origin header names a
  // different origin answers 403 cross_origin.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      try {
        const originUrl = new URL(origin as string);
        if (host && originUrl.host !== host) {
          res.status(403).json(errors.crossOrigin().body());
          return;
        }
      } catch {
        res.status(403).json(errors.crossOrigin().body());
        return;
      }
    }
    next();
  });

  // JSON bodies up to and including 65,536 bytes are accepted; larger ones
  // answer 413 payload_too_large. Requests and responses are
  // application/json; charset=utf-8.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }
    if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") {
      next();
      return;
    }
    const contentType = req.headers["content-type"] ?? "";
    if (contentType.includes("multipart/form-data")) {
      next();
      return;
    }
    const declaredLength = Number(req.headers["content-length"] ?? "0");
    if (declaredLength > jsonLimit) {
      res.status(413).json(errors.payloadTooLarge().body());
      return;
    }
    if (contentType && !contentType.includes("application/json") && contentType !== "application/json; charset=utf-8") {
      res.status(415).json(errors.unsupportedMediaType().body());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let overLimit = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > jsonLimit) {
        overLimit = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overLimit) {
        res.status(413).json(errors.payloadTooLarge().body());
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        (req as AppRequest).rawBody = {};
        next();
        return;
      }
      try {
        (req as AppRequest).rawBody = JSON.parse(raw);
      } catch {
        (req as AppRequest).rawBody = "parse-error";
      }
      next();
    });
    req.on("error", () => {
      res.status(400).end();
    });
  });

  // Every API response carries the JSON content type.
  router.use("/api", (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.path === "/usage.csv") res.setHeader("Content-Type", "text/csv; charset=utf-8");
    next();
  });

  // Session loading; no valid session means 401 on guarded endpoints.
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api") && !req.path.startsWith("/media")) {
      next();
      return;
    }
    if (req.path === "/api/health" || req.path === "/api/clock" || req.path === "/api/session") {
      next();
      return;
    }
    const token = readSessionCookie(req.headers.cookie ?? "");
    if (!token) {
      next();
      return;
    }
    try {
      const rows = await sql`
        SELECT p.id, p.email, p.name, p.role, p.newsroom_id, p.contributor_handle,
               n.slug AS newsroom_slug, n.name AS newsroom_name, n.home_zone
        FROM sessions s
        JOIN people p ON p.id = s.person_id
        LEFT JOIN newsrooms n ON n.id = p.newsroom_id
        WHERE s.token = ${token}`;
      if (rows.length > 0) {
        (req as AppRequest).person = rows[0] as PersonRow;
      }
    } catch {
      // Database unreachable: guarded endpoints answer 503 downstream.
    }
    next();
  });

  // Sign-in and session.
  router.post("/api/session", async (req: Request, res: Response) => {
    const body = (req as AppRequest).rawBody;
    const parsed = parseStrictBody(body, {
      email: { type: "string", required: true, message: "This field is missing or has the wrong type" },
      password: { type: "string", required: true, message: "This field is missing or has the wrong type" },
    });
    if (parsed.invalid) {
      res.status(422).json(errors.validationFailed(parsed.fields ?? {}).body());
      return;
    }
    const { email, password } = parsed.fields as { email: string; password: string };
    try {
      const rows = await sql`
        SELECT p.id, p.email, p.name, p.role, p.newsroom_id, p.contributor_handle,
               n.slug AS newsroom_slug, n.name AS newsroom_name, n.home_zone, p.password_hash
        FROM people p LEFT JOIN newsrooms n ON n.id = p.newsroom_id
        WHERE p.email = ${email}`;
      const person = rows[0];
      if (!person || !(await verifyPassword(password, person.password_hash))) {
        res.status(401).json(errors.invalidCredentials().body());
        return;
      }
      const token = newToken();
      await sql`INSERT INTO sessions (token, person_id) VALUES (${token}, ${person.id})`;
      res.setHeader("Set-Cookie", `saltprint_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
      res.status(200).json({ user: userBody(person) });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.delete("/api/session", (req: Request, res: Response) => {
    const token = readSessionCookie(req.headers.cookie ?? "");
    if (token) {
      sql`DELETE FROM sessions WHERE token = ${token}`.catch(() => undefined);
    }
    res.setHeader("Set-Cookie", "saltprint_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    res.status(204).end();
  });

  router.get("/api/me", async (req: Request, res: Response) => {
    const person = (req as AppRequest).person;
    if (!person) {
      res.status(401).json(errors.unauthenticated().body());
      return;
    }
    try {
      const rows = await sql`
        SELECT p.id, p.email, p.name, p.role, p.newsroom_id, p.contributor_handle,
               n.slug AS newsroom_slug, n.name AS newsroom_name, n.home_zone
        FROM people p LEFT JOIN newsrooms n ON n.id = p.newsroom_id
        WHERE p.id = ${person.id}`;
      res.status(200).json({ user: userBody(rows[0]) });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  // Server clock. PUT is enabled only when APP_CLOCK_CONTROL is on.
  router.get("/api/clock", (req: Request, res: Response) => {
    void req;
    const nowMs = clock.now();
    res.status(200).json({ now: isoNow(nowMs), now_display: formatDisplay(nowMs), zone: "America/Chicago" });
  });

  router.put("/api/clock", async (req: Request, res: Response) => {
    if (!config.clockControl) {
      res.status(404).json(errors.notFound().body());
      return;
    }
    const body = (req as AppRequest).rawBody;
    const parsed = parseStrictBody(body, {
      now: { type: "string", required: true, message: "This field is missing or has the wrong type" },
    });
    if (parsed.invalid) {
      res.status(422).json(errors.validationFailed(parsed.fields ?? {}).body());
      return;
    }
    const now = (parsed.fields as { now: string }).now;
    const ms = Date.parse(now);
    if (Number.isNaN(ms) || !/Z$/.test(now)) {
      res.status(422).json(errors.validationFailed({ now: "This field is missing or has the wrong type" }).body());
      return;
    }
    try {
      await sql`
        INSERT INTO clock_offsets (id, offset_ms, seeded_at) VALUES (1, ${BigInt(ms - Date.now())}, now())
        ON CONFLICT (id) DO UPDATE SET offset_ms = ${BigInt(ms - Date.now())}`;
      await clock.refresh(sql);
      const nowMs = clock.now();
      res.status(200).json({ now: isoNow(nowMs), now_display: formatDisplay(nowMs), zone: "America/Chicago" });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.get("/api/health", (req: Request, res: Response) => {
    void req;
    res.status(200).json({ status: "ok" });
  });
}

export function readSessionCookie(header: string): string | null {
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === "saltprint_session") {
      return part.slice(eq + 1) || null;
    }
  }
  return null;
}

export function userBody(person: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: Number(person.id),
    name: person.name,
    email: person.email,
    role: person.role,
  };
  body.newsroom = person.newsroom_id
    ? { slug: person.newsroom_slug, name: person.newsroom_name, home_zone: person.home_zone }
    : null;
  body.contributor_handle = person.contributor_handle ?? null;
  return body;
}

function isoNow(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatDisplay(ms: number): string {
  // Co-op time with zone abbreviation.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const abbrev = offset === "GMT-5" ? "CDT" : "CST";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("weekday")} ${Number(get("day"))} ${get("month")} ${get("year")} · ${hour}:${get("minute")} ${abbrev}`;
}
