import express from "express";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { readConfig } from "./config.js";
import { Database } from "./db.js";
import { SCHEMA_SQL } from "./schema.js";
import { ObjectStore } from "./objectstore.js";
import { KillBillClient } from "./killbill.js";
import { Mailer } from "./mailer.js";
import { ApiError, errorBody, sendError } from "./errors.js";
import { registerPublicRoutes } from "./routes-public.js";
import { registerMemberRoutes } from "./routes-member.js";
import { registerDrawRoutes, refreshVisitPageStates } from "./routes-draws.js";
import { registerResultsRoutes } from "./routes-results.js";
import { registerVisitRoutes } from "./routes-visit.js";
import { registerStaffRoutes } from "./routes-staff.js";
import { seedCore, seedRanges, seedDrawsAndDependent } from "./seed.js";
import { flagResult } from "./domain.js";
import type { AppContext } from "./route-context.js";
import { runErasureSweep, runPendingMembershipSweep } from "./background.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { parseMultipart } from "./multipart.js";
import { KNOWN_API_ROUTES } from "./api-routes.js";

const JSON_BODY_LIMIT = 65_536;
const PREVIEW_BODY_LIMIT = 1_100_000;
const SAVE_BODY_LIMIT = 11_100_000;
const MESSAGE_BODY_LIMIT = 5_100_000;

async function main(): Promise<void> {
  const config = readConfig();
  const db = new Database(config.databaseUrl);
  await db.ensureConnected();
  await db.query(SCHEMA_SQL);
  const store = new ObjectStore(config);
  const killbill = new KillBillClient(config);
  const mailer = new Mailer(config);
  const ctx: AppContext = { db, config, store, killbill, mailer };

  const seeds = await seedCore(db);
  await seedRanges(db);
  await seedPlusMemberships(ctx, seeds);
  await seedDrawsAndDependent(db, seeds, async (input) => {
    const flagged = await flagResult(db, input.marker, input.value, input.sex, input.dateOfBirth, input.timeZone, input.collectedAt);
    return {
      flag: flagged?.flag ?? "inRange",
      ageBand: flagged?.ageBand ?? "age18To39",
      low: flagged?.range.low ?? "0",
      high: flagged?.range.high ?? "0",
      optimalLow: flagged?.range.optimalLow ?? "0",
      optimalHigh: flagged?.range.optimalHigh ?? "0",
      effectiveFrom: flagged?.range.effectiveFrom ?? "2020-01-01",
    };
  });

  void store.ensureBucket().catch(() => undefined);
  void killbill.ensureCatalog().catch(() => undefined);

  const app = express();
  app.disable("x-powered-by");
  app.use(cookieParser());

  // 413 from the declared length, before authentication and parsing.
  app.use((req, res, next) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    const limit = bodyLimitFor(req.path);
    if (Number.isFinite(declared) && declared > limit) {
      res.status(413).json(errorBody(new ApiError(413, "too_large", "That request is too large.")));
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    const contentType = req.headers["content-type"] ?? "";
    if (contentType.startsWith("multipart/form-data")) {
      const limit = bodyLimitFor(req.path);
      parseMultipart(req, limit).then(
        () => next(),
        (error: unknown) => {
          if (error instanceof ApiError) {
            sendError(res, error);
            return;
          }
          sendError(res, new ApiError(400, "bad_request", "That request could not be read."));
        }
      );
      return;
    }
    if (contentType.startsWith("application/json")) {
      const limit = bodyLimitFor(req.path);
      const chunks: Buffer[] = [];
      let received = 0;
      let done = false;
      req.on("data", (chunk: Buffer) => {
        if (done) return;
        received += chunk.length;
        if (received > limit) {
          done = true;
          res.status(413).json(errorBody(new ApiError(413, "too_large", "That request is too large.")));
          req.removeAllListeners("data");
          Readable.from([]).resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (done) return;
        const raw = Buffer.concat(chunks);
        (req as Request & { rawBody?: Buffer }).rawBody = raw;
        if (raw.length === 0) {
          req.body = {};
        } else {
          try {
            req.body = JSON.parse(raw.toString("utf8"));
          } catch {
            req.body = undefined;
          }
        }
        // The malformed-JSON rung reads this marker.
        (req as Request & { jsonFailed?: boolean }).jsonFailed = req.body === undefined;
        next();
      });
      req.on("error", () => {
        if (!res.headersSent) {
          sendError(res, new ApiError(400, "bad_request", "That request could not be read."));
        }
      });
      return;
    }
    next();
  });

  // Content type rung: JSON bodies need application/json.
  app.use((req, res, next) => {
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      const contentType = req.headers["content-type"] ?? "";
      const declaredLength = Number(req.headers["content-length"] ?? 0);
      const isMultipart = contentType.startsWith("multipart/form-data");
      const isJson = contentType.startsWith("application/json");
      const hasBody = declaredLength > 0 || (req as Request & { rawBody?: Buffer }).rawBody !== undefined;
      if (hasBody && !isMultipart && !isJson) {
        sendError(res, new ApiError(415, "unsupported_media_type", "Send that request as application/json."));
        return;
      }
    }
    next();
  });

  // Malformed JSON rung.
  app.use((req, res, next) => {
    if ((req as Request & { jsonFailed?: boolean }).jsonFailed) {
      sendError(res, new ApiError(400, "bad_request", "That request could not be read."));
      return;
    }
    next();
  });

  const api = express.Router();
  registerPublicRoutes(api, ctx);
  registerMemberRoutes(api, ctx);
  registerDrawRoutes(api, ctx);
  registerResultsRoutes(api, ctx);
  registerVisitRoutes(api, ctx);
  registerStaffRoutes(api, ctx);

  app.use(api);

  // Wrong method on a known route → 405 with Allow; unknown route → 404.
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }
    const subPath = req.path.slice("/api".length);
    const matchesPath = (entry: { path: string }): boolean => {
      const pattern = new RegExp(
        "^" +
          entry.path
            .replace(/\/$/, "")
            .replace(/:[A-Za-z]+/g, "([^/]+)") +
          "$"
      );
      return pattern.test(subPath);
    };
    const pathEntries = KNOWN_API_ROUTES.filter((entry) => matchesPath(entry));
    if (pathEntries.length > 0) {
      const allowed = [...new Set(pathEntries.flatMap((entry) => entry.methods))];
      if (allowed.includes(req.method)) {
        next();
        return;
      }
      res.setHeader("Allow", allowed.join(", "));
      sendError(res, new ApiError(405, "method_not_allowed", "That request method isn't allowed here."));
      return;
    }
    sendError(res, new ApiError(404, "not_found", "We can't find that page."));
  });

  // Static assets.
  app.get("/assets/:file", (req, res) => {
    const file = req.params["file"] ?? "";
    if (!/^[\w.-]+$/.test(file)) {
      res.status(404).end();
      return;
    }
    const candidates = ["app.js", "app.css"];
    if (!candidates.includes(file)) {
      res.status(404).end();
      return;
    }
    const path = resolve("public", file);
    if (!existsSync(path)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
    res.send(readFileSync(path));
  });

  app.get("/fonts/:file", (req, res) => {
    const file = req.params["file"] ?? "";
    if (!/^[\w.-]+$/.test(file)) {
      res.status(404).end();
      return;
    }
    const path = resolve("public/fonts", file);
    if (!existsSync(path)) {
      res.status(404).end();
      return;
    }
    const type = file.endsWith(".ttf") ? "font/ttf" : file.endsWith(".woff2") ? "font/woff2" : "text/plain; charset=utf-8";
    res.setHeader("Content-Type", type);
    res.send(readFileSync(path));
  });

  // The app shell serves every screen route with 200; unknown paths get 404 with the same shell.
  const shellPaths = new Set([
    "/",
    "/plans",
    "/markers",
    "/join",
    "/signin",
    "/me",
    "/me/membership",
    "/me/draws",
    "/me/results",
    "/me/plan",
    "/me/messages",
    "/me/records",
    "/me/account",
    "/staff/members",
    "/staff/messages",
    "/staff/calendar",
    "/staff/results",
    "/staff/ranges",
    "/staff/receipts",
    "/staff/team",
  ]);
  app.use((req, res) => {
    const isScreen = shellPaths.has(req.path) || /^\/(me\/draws\/[^/]+|receipts\/[^/]+|staff\/members\/[^/]+(|\/(results|plan|blend|messages))|staff\/members\/[^/]+\/plans\/[^/]+|staff\/members\/[^/]+\/blends\/[^/]+|staff\/draws\/[^/]+|visit\/[^/]+)$/.test(req.path);
    res.status(isScreen ? 200 : 404);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(shellHtml());
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendError(res, error);
  });

  const port = config.port;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Ocotillo Member Desk listening on port ${port}`);
  });

  // Background sweeps: visit page ends, erasures, pending memberships, mail.
  setInterval(() => {
    void refreshVisitPageStates(db).catch(() => undefined);
  }, 1_000).unref();
  setInterval(() => {
    void runErasureSweep(ctx).catch(() => undefined);
  }, 1_000).unref();
  setInterval(() => {
    void runPendingMembershipSweep(ctx).catch(() => undefined);
  }, 5_000).unref();
  setInterval(() => {
    void mailer.deliverPending(db).catch(() => undefined);
  }, 2_000).unref();
}

function bodyLimitFor(path: string): number {
  if (path.endsWith("/results-file/preview")) return PREVIEW_BODY_LIMIT;
  if (path.endsWith("/results-file")) return SAVE_BODY_LIMIT;
  if (path.endsWith("/report")) return SAVE_BODY_LIMIT;
  if (path.endsWith("/messages")) return MESSAGE_BODY_LIMIT;
  return JSON_BODY_LIMIT;
}

/**
 * Seeded Plus members: create their Kill Bill account and subscription, retrying
 * every 5 seconds while Kill Bill is unreachable. Memberships stay pending
 * until Kill Bill confirms them, and their first paid invoices are the
 * seeded receipts.
 */
async function seedPlusMemberships(
  ctx: AppContext,
  seeds: { memberIds: Map<string, string> }
): Promise<void> {
  const plusMembers: { name: string; cadence: "sixMonths" | "yearly" }[] = [
    { name: "Elena Marsh", cadence: "sixMonths" },
    { name: "Marcus Bell", cadence: "yearly" },
    { name: "Rosa Delgado", cadence: "sixMonths" },
    { name: "Hana Sato", cadence: "yearly" },
  ];
  const pending: { memberId: string; name: string; email: string; cadence: "sixMonths" | "yearly" }[] = [];
  for (const entry of plusMembers) {
    const memberId = seeds.memberIds.get(entry.name);
    if (!memberId) continue;
    const member = await ctx.db.one<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM members WHERE id = $1`,
      [memberId]
    );
    if (!member) continue;
    const existing = await ctx.db.one<{ state: string }>(
      `SELECT state FROM memberships WHERE member_id = $1`,
      [memberId]
    );
    if (existing && existing.state !== "free") continue;
    pending.push({ memberId, name: member.name, email: member.email, cadence: entry.cadence });
  }
  if (pending.length === 0) return;

  const trySeed = async (): Promise<boolean> => {
    let anyPending = false;
    for (const entry of pending) {
      const existing = await ctx.db.one<{ state: string }>(
        `SELECT state FROM memberships WHERE member_id = $1`,
        [entry.memberId]
      );
      if (existing && existing.state !== "free") continue;
      try {
        const { joinPlus } = await import("./membership-ops.js");
        await joinPlus(ctx, { id: entry.memberId, name: entry.name, email: entry.email }, entry.cadence);
      } catch {
        anyPending = true;
      }
    }
    return anyPending;
  };

  const anyLeft = await trySeed();
  if (anyLeft) {
    const timer = setInterval(() => {
      void trySeed().then((still) => {
        if (!still) clearInterval(timer);
      });
    }, 5_000);
    timer.unref();
  }
}

function shellHtml(): string {
  const indexPath = resolve("public", "index.html");
  if (existsSync(indexPath)) {
    return readFileSync(indexPath, "utf8");
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ocotillo Longevity Club</title></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>`;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
