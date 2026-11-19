import express, { type Request, type Response, type NextFunction } from "express";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { prepareDatabase } from "./prepare.js";
import { sessionMiddleware } from "./api/auth.js";
import { registerAuthApi } from "./api/auth.js";
import { registerPublicApi } from "./api/public.js";
import { registerCustomerApi } from "./api/customers.js";
import { registerEnquiryApi } from "./api/enquiries.js";
import { registerTripApi } from "./api/trip.js";
import { registerOperatorApi } from "./api/operators.js";
import { registerBidApi } from "./api/bids.js";
import { registerHireApi } from "./api/hires.js";
import { registerPaymentApi } from "./api/payments.js";
import { registerRunApi } from "./api/runs.js";
import { registerSheetApi } from "./api/sheets.js";
import { registerDocumentApi } from "./api/documents.js";
import { registerAftercareApi } from "./api/aftercare.js";
import { registerPageRoutes } from "./pages.js";
import { startJobs } from "./jobs.js";
import { errors, HttpError } from "./errors.js";
import { readJson, sendError, JSON_LIMIT, requireDepth } from "./http.js";
import { ukDateString, ukFields } from "./uktime.js";
import { isoInstant } from "./domain.js";

export interface Ctx {
  cfg: ReturnType<typeof loadConfig> & { sessionSecret: string };
  db: pg.Pool;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function buildApp(ctx: Ctx): ReturnType<typeof express> {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.set("query parser", "simple");

  // Express 4 does not forward rejected promises, so every async handler is wrapped once here.
  type AnyFn = (...args: unknown[]) => unknown;
  const autoAsync = (register: AnyFn): AnyFn => {
    return (...args: unknown[]) => {
      const handlers = args.slice(1).map((h) =>
        typeof h === "function" && h.constructor?.name === "AsyncFunction"
          ? (req: Request, res: Response, next: NextFunction) => {
              (h as (r: Request, s: Response) => Promise<void>)(req, res).catch(next);
            }
          : h
      );
      register(...args.slice(0, 1), ...handlers);
    };
  };
  const wrapVerb = (verb: "get" | "post" | "put" | "patch" | "delete") => {
    const raw = (app as unknown as Record<string, AnyFn>)[verb].bind(app);
    (app as unknown as Record<string, AnyFn>)[verb] = autoAsync(raw);
  };
  wrapVerb("get");
  wrapVerb("post");
  wrapVerb("put");
  wrapVerb("patch");
  wrapVerb("delete");

  app.use((req: Request, _res, next: NextFunction) => {
    req.ctx = ctx;
    next();
  });

  // Ladder: body size before parsing and before authentication.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const len = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(len) && len > 0) {
      if (type === "application/json" && len > JSON_LIMIT) return sendError(res, errors.tooLarge());
      if (type === "text/csv" && len > 2_000_000) return sendError(res, errors.tooLarge());
      if (type === "multipart/form-data" && len > 5_100_000) return sendError(res, errors.tooLarge());
    }
    if (WRITE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        try {
          const u = new URL(origin);
          const own = new URL(ctx.cfg.appPublicUrl);
          if (u.host !== own.host) return sendError(res, errors.foreignOrigin());
        } catch {
          return sendError(res, errors.foreignOrigin());
        }
      }
    }
    next();
  });

  app.use(sessionMiddleware(ctx));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/public/clock", (_req, res) => {
    const now = new Date();
    const f = ukFields(now);
    res.json({
      date: ukDateString(now),
      time: `${String(f.hh).padStart(2, "0")}:${String(f.mm).padStart(2, "0")}`,
      instant: isoInstant(now),
    });
  });

  registerAuthApi(app, ctx);
  registerPublicApi(app, ctx);
  registerCustomerApi(app, ctx);
  registerEnquiryApi(app, ctx);
  registerTripApi(app, ctx);
  registerOperatorApi(app, ctx);
  registerBidApi(app, ctx);
  registerHireApi(app, ctx);
  registerPaymentApi(app, ctx);
  registerRunApi(app, ctx);
  registerSheetApi(app, ctx);
  registerAftercareApi(app, ctx);
  registerDocumentApi(app, ctx);
  registerPageRoutes(app, ctx);

  app.use("/api", (req: Request, res: Response) => {
    void req;
    sendError(res, errors.unknownRoute());
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      sendError(res, err);
      return;
    }
    // A thrown non-HttpError is a fault on our side; it must still answer the one error shape.
    sendError(res, errors.unknownRoute());
  });

  return app;
}

export async function startServer(): Promise<ReturnType<typeof express>> {
  const cfg = { ...loadConfig(), sessionSecret: process.env.SESSION_SECRET ?? readSessionSecret() };
  const db = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });
  await prepareDatabase(db);
  const ctx: Ctx = { cfg, db };
  const app = buildApp(ctx);
  const server = app.listen(cfg.appPublicPort, "0.0.0.0");
  await new Promise<void>((r) => server.once("listening", r));
  startJobs(ctx);
  console.log(`wayticket serving on ${cfg.appPublicPort}`);
  return app;
}

function readSessionSecret(): string {
  const p = process.env.SESSION_SECRET_FILE ?? "/tmp/wayticket-session-secret";
  try {
    const existing = readFileSync(p, "utf8").trim();
    if (existing) return existing;
  } catch {
    // first boot
  }
  const secret = randomBytes(24).toString("base64url");
  try {
    writeFileSync(p, secret, { mode: 0o600 });
    return secret;
  } catch {
    return secret;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: Ctx;
      deskId?: string;
      authEnded?: boolean;
    }
  }
}

export { readJson, requireDepth };
