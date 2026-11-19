import express, { type Request } from "express";
import { loadConfig, type Config } from "./config.js";
import { Database } from "./db.js";
import { ObjectStorage } from "./object-storage.js";
import { loadSession, type AppLocals } from "./auth.js";
import { apiErrorMiddleware, errors } from "./api-errors.js";
import { sessionRouter } from "./routes/session.js";
import { storesRouter, storeActionsRouter } from "./routes/stores.js";
import { holdsRouter, cartRouter, releaseExpiredHolds } from "./routes/cart.js";
import { ordersRouter } from "./routes/orders.js";
import { catalogueRouter, stockRouter, returnsRouter, reviewRouter } from "./routes/backoffice.js";
import { servePages } from "./pages.js";
import { Mailer } from "./mailer.js";

const MAX_BODY_BYTES = 65536;

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const db = new Database(cfg);
  const storage = new ObjectStorage(cfg);
  const mailer = new Mailer(cfg);

  let ready = false;
  void db.applySchemaAndSeed().then(() => {
    ready = true;
  }).catch((err) => {
    console.error("schema failed", err);
    process.exit(1);
  });
  void storage.start();
  void mailer.startOutboxWorker(db);
  startHoldSweep(db, cfg);

  const app = express();
  const locals: AppLocals = { cfg, db, storage };
  app.use((req, res, next) => {
    Object.assign(res.locals, locals);
    next();
  });

  interface AuthedRequest extends Request {
    auth?: import("./auth.js").AuthContext | undefined;
  }

  app.use((req, res, next) => {
    void loadSession(req, db, cfg).then((auth) => {
      (req as AuthedRequest).auth = auth ?? undefined;
      next();
    }).catch((err) => next(err));
  });

  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      const allowed = host ? new URL(origin).host === host : false;
      if (!allowed) {
        next(errors.crossOrigin());
        return;
      }
    }
    const lengthHeader = req.headers["content-length"];
    if (typeof lengthHeader === "string" && Number(lengthHeader) > MAX_BODY_BYTES) {
      (req as Request & { tooLarge?: boolean }).tooLarge = true;
      next(errors.payloadTooLarge());
      return;
    }
    const hasBody = req.headers["transfer-encoding"] !== undefined || (typeof lengthHeader === "string" && Number(lengthHeader) > 0);
    if (req.method === "DELETE") {
      if (hasBody) {
        next(errors.unsupportedMediaType());
        return;
      }
      next();
      return;
    }
    if (hasBody) {
      const contentType = req.headers["content-type"] ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        next(errors.unsupportedMediaType());
        return;
      }
    }
    let received = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        (req as Request & { tooLarge?: boolean }).tooLarge = true;
        if (!res.headersSent) {
          res.status(413).json({ code: "payload_too_large" });
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if ((req as Request & { tooLarge?: boolean }).tooLarge) {
        return;
      }
      if (chunks.length === 0) {
        req.body = {};
      } else {
        try {
          req.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          (req as Request & { badJson?: boolean }).badJson = true;
          req.body = {};
        }
      }
      next();
    });
    req.on("error", () => {
      void 0;
    });
  });

  app.get("/api/health", (_req, res) => {
    if (ready) {
      res.json({ status: "ok" });
    } else {
      res.status(503).json({ status: "starting" });
    }
  });

  app.get("/api/status", (_req, res) => {
    res.json(storage.statusSnapshot());
  });

  app.use("/api", sessionRouter());
  app.use("/api", storesRouter());
  app.use("/api", storeActionsRouter());
  app.use("/api", holdsRouter());
  app.use("/api", cartRouter());
  app.use("/api", ordersRouter());
  app.use("/api", catalogueRouter());
  app.use("/api", stockRouter());
  app.use("/api", returnsRouter());
  app.use("/api", reviewRouter());

  app.use("/api", (req, res) => {
    res.status(404).json({ code: "not_found" });
  });

  app.use("/", servePages(db, cfg));

  app.use(apiErrorMiddleware);

  const server = app.listen(cfg.port, "0.0.0.0", () => {
    console.log(`listening on ${cfg.port}`);
  });
  server.headersTimeout = 65000;
  server.on("error", (err) => {
    console.error("server error", err);
    process.exit(1);
  });
}

function startHoldSweep(db: Database, cfg: Config): void {
  const timer = setInterval(() => {
    void db.withClient(async (client) => {
      await releaseExpiredHolds(client, new Date());
    }).catch((err) => {
      console.error("hold sweep failed", err);
    });
  }, cfg.hold_sweep_seconds * 1000);
  timer.unref();
}

void main();
