import express, { type Request, type Response, type NextFunction } from "express";
import { Pool } from "pg";
import { jsonBody, originGuard, Handled } from "./http.js";
import { ApiError, errors, sendError } from "./errors.js";
import type { Config } from "./config.js";
import { Idempotency } from "./idempotency.js";
import { Valkey } from "./valkey.js";
import { KillBill } from "./killbill.js";
import { Mailer } from "./mailer.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerHostRoutes } from "./routes/host.js";
import { registerEventRoutes } from "./routes/events.js";

export interface AppCtx {
  pool: Pool;
  valkey: Valkey;
  killbill: KillBill;
  idem: Idempotency;
  cfg: Config;
  mailer: Mailer;
}

export function createApp(ctx: AppCtx): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(originGuard);
  app.use(jsonBody);

  registerPublicRoutes(app, ctx);
  registerActionRoutes(app, ctx);
  registerHostRoutes(app, ctx);
  registerEventRoutes(app, ctx);

  app.use("/api", (_req, res) => {
    sendError(res, errors.notFound());
  });

  const handler = (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) { next(err); return; }
    if (err instanceof Handled) { sendError(res, err.error); return; }
    if (err instanceof ApiError) { sendError(res, err); return; }
    if (err instanceof Error && err.message === "valkey_unavailable") {
      sendError(res, errors.holdsPaused());
      return;
    }
    if (err instanceof Error && err.message === "killbill_error") {
      sendError(res, errors.depositsPaused());
      return;
    }
    if (err instanceof Error && err.message === "idempotency_conflict") {
      sendError(res, errors.idempotencyConflict());
      return;
    }
    console.error("unhandled", err);
    sendError(res, new ApiError(500, "internal_error", "Something went wrong."));
  };
  app.use(handler);

  return app;
}
