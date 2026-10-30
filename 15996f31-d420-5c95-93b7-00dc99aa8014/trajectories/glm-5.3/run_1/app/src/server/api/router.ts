import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../errors.ts";
import type { AppServices, TypedRequest, Handler } from "../context.ts";
import { attachActor, parseBody } from "../context.ts";
import { signIn, signOut, me } from "./sessions.ts";
import { listGrowers, listRuleSets, listOrchards, createOrchard } from "./orchards.ts";
import { listOrders, getOrder, createOrder, openOrder, cancelOrder, placeOrder, issueInspectionLink, orderReport } from "./orders.ts";
import { commitDrop, listDrops, getDrop, deliverDrop, acceptDrop, disputeDrop, resolveDrop, photoFile } from "./drops.ts";
import { settlementPreview, settleOrder } from "./settlement.ts";
import {
  inspectionSheet, addSample, removeSample, uploadSamplePhoto, inspectionPhoto, signReport,
} from "./inspect.ts";
import { serveFile } from "./files.ts";

/**
 * One error shape and one precedence order. The central handler renders every
 * ApiError; anything unexpected answers as a plain 5xx with the same body.
 */
export function errorHandler(error: unknown, req: TypedRequest, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json(error.body());
    return;
  }
  console.error("unhandled error", error);
  console.error("unhandled error", error);
  res.status(500).json({ error: "internal_error", message: "Something went wrong on our side. Try again in a minute." });
}

/** Same-origin writes: a non-GET whose Origin names another origin answers 403. */
export function sameOriginOnly(req: TypedRequest, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost && host && originHost !== host) {
        next(ApiError.crossOrigin());
        return;
      }
    }
  }
  next();
}

function wrap(handler: Handler) {
  return (req: TypedRequest, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

export function buildApp(services: AppServices): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(sameOriginOnly);
  app.use(attachActor.bind(null, services));
  app.use(parseBody);

  const r = (method: "get" | "post" | "delete", path: string, handler: Handler) => {
    app[method](path, wrap(handler));
  };

  r("get", "/api/health", async (req, res) => {
    if (!services.dbReady) {
      res.status(503).json({ status: "starting" });
      return;
    }
    try {
      await Promise.race([
        services.pool.query("SELECT 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
      ]);
      res.status(200).json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "starting" });
    }
  });

  r("post", "/api/session", (req, res) => signIn(services, req, res));
  r("delete", "/api/session", (req, res) => signOut(services, req, res));
  r("get", "/api/me", (req, res) => me(req, res));
  r("get", "/api/growers", (req, res) => listGrowers(services, req, res));
  r("get", "/api/rule-sets", (req, res) => listRuleSets(services, req, res));
  r("get", "/api/orchards", (req, res) => listOrchards(services, req, res));
  r("post", "/api/orchards", (req, res) => createOrchard(services, req, res));

  r("get", "/api/orders", (req, res) => listOrders(services, req, res));
  r("post", "/api/orders", (req, res) => createOrder(services, req, res));
  r("get", "/api/orders/:id", (req, res) => getOrder(services, req, res));
  r("post", "/api/orders/:id/open", (req, res) => openOrder(services, req, res));
  r("post", "/api/orders/:id/cancel", (req, res) => cancelOrder(services, req, res));
  r("post", "/api/orders/:id/place", (req, res) => placeOrder(services, req, res));
  r("post", "/api/orders/:id/inspection-links", (req, res) => issueInspectionLink(services, req, res));
  r("get", "/api/orders/:id/settlement", (req, res) => settlementPreview(services, req, res));
  r("post", "/api/orders/:id/settle", (req, res) => settleOrder(services, req, res));
  r("get", "/api/orders/:id/report", (req, res) => orderReport(services, req, res));
  r("post", "/api/orders/:id/drops", (req, res) => commitDrop(services, req, res));

  r("get", "/api/drops", (req, res) => listDrops(services, req, res));
  r("get", "/api/drops/:id", (req, res) => getDrop(services, req, res));
  r("post", "/api/drops/:id/deliver", (req, res) => deliverDrop(services, req, res));
  r("post", "/api/drops/:id/accept", (req, res) => acceptDrop(services, req, res));
  r("post", "/api/drops/:id/dispute", (req, res) => disputeDrop(services, req, res));
  r("post", "/api/drops/:id/resolve", (req, res) => resolveDrop(services, req, res));

  r("get", "/api/photos/:id", (req, res) => photoFile(services, req, res));

  r("get", "/api/inspect/:token", (req, res) => inspectionSheet(services, req, res));
  r("post", "/api/inspect/:token/samples", (req, res) => addSample(services, req, res));
  r("delete", "/api/inspect/:token/samples/:sampleId", (req, res) => removeSample(services, req, res));
  r("post", "/api/inspect/:token/samples/:sampleId/photos", (req, res) => uploadSamplePhoto(services, req, res));
  r("get", "/api/inspect/:token/photos/:photoId", (req, res) => inspectionPhoto(services, req, res));
  r("post", "/api/inspect/:token/sign", (req, res) => signReport(services, req, res));

  r("get", "/files/:token", (req, res) => serveFile(services, req, res));

  app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({ error: "not_found", message: "That record isn't available to you." });
  });

  const clientDir = services.clientDir;
  const sendIndex = (res: Response) => {
    readFile(path.join(clientDir, "index.html"), "utf8").then((html) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.status(200).send(html);
    }).catch(() => {
      res.status(500).json({ error: "internal_error", message: "Something went wrong on our side. Try again in a minute." });
    });
  };
  app.get("/", (req: Request, res: Response) => sendIndex(res));
  app.get("/desk", (req: Request, res: Response) => sendIndex(res));
  app.get("/desk/*splat", (req: Request, res: Response) => sendIndex(res));
  app.get("/inspect/*splat", (req: Request, res: Response) => sendIndex(res));

  app.use(express.static(clientDir, { index: false, fallthrough: true }));

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "not_found", message: "That record isn't available to you." });
  });

  app.use(errorHandler);
  return app;
}
