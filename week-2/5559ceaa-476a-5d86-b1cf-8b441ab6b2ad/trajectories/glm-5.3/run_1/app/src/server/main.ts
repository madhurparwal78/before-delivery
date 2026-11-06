import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "./config.js";
import { applySchema } from "./schema.js";
import { Storage } from "./storage.js";
import { Mailer } from "./mailer.js";
import { ApiError, errorBody } from "./errors.js";
import { Router, JSON_LIMIT, ZIP_LIMIT, type RouteCtx } from "./api/router.js";
import { Services } from "./services.js";
import { ProjectBus } from "./bus.js";
import { currentUser, parseCookies } from "./auth.js";
import { registerAuthRoutes } from "./api/auth_routes.js";
import { registerProjectRoutes } from "./api/project_routes.js";
import { registerSessionRoutes } from "./api/session_routes.js";
import { registerFileRoutes } from "./api/file_routes.js";
import { registerCheckpointRoutes } from "./api/checkpoint_routes.js";
import { registerImportRoutes } from "./api/import_routes.js";
import { registerReviewerRoutes } from "./api/reviewer_routes.js";
import { SeedService } from "./api/seed_service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(__dirname, "..", "client");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 20 });
  await applySchema(pool);
  const storage = new Storage(cfg);
  const mailer = new Mailer(cfg);
  const bus = new ProjectBus();
  const seed = new SeedService();
  const svc = new Services(pool, cfg, storage, mailer, bus, seed);

  const router = new Router();
  router.add("GET", "/api/health", async () => ({ status: 200, body: { status: "ok" } }));
  registerAuthRoutes(router, svc);
  registerProjectRoutes(router, svc);
  registerSessionRoutes(router, svc);
  registerFileRoutes(router, svc);
  registerCheckpointRoutes(router, svc);
  registerImportRoutes(router, svc);
  registerReviewerRoutes(router, svc);

  const server = http.createServer((req, res) => {
    void handle(req, res, router, svc, cfg).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      }
      res.end(JSON.stringify({ error: { code: "internal", message: "Something went wrong." } }));
      console.error("unhandled", err);
    });
  });

  bus.attach(server, svc);
  server.listen(cfg.port, "0.0.0.0", () => {
    console.log(`Relay Bench listening on ${cfg.port}`);
  });

  startSweeps(svc);
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  router: Router,
  svc: Services,
  cfg: { appPublicUrl: string },
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  // Same-origin writes only.
  const origin = req.headers.origin;
  if (origin && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "")) {
    const own = new URL(cfg.appPublicUrl);
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(errorBody(new ApiError("cross_origin", "Cross-origin writes are not allowed."))));
      return;
    }
    if (originUrl.origin !== own.origin) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(errorBody(new ApiError("cross_origin", "Cross-origin writes are not allowed."))));
      return;
    }
  }

  if (pathname.startsWith("/api/")) {
    const raw = await readBody(req);
    if (raw === null) {
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(errorBody(new ApiError("too_large", "The body is over its limit.", { limit_bytes: limitFor(pathname) }))));
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const user = await currentUser(svc.pool, cookies["rb_session"] ?? null);
    let body: unknown = null;
    const isZip = pathname.endsWith("/imports") && (req.method ?? "") === "POST";
    const ctHeader = req.headers["content-type"];
    const ct = ((Array.isArray(ctHeader) ? ctHeader[0] : ctHeader) ?? "").split(";")[0]?.trim() ?? "";
    if (req.method !== "GET" && raw.length > 0) {
      if (!isZip) {
        if (ct !== "application/json") {
          res.writeHead(415, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(errorBody(new ApiError("unsupported_media_type", "Send JSON bodies as application/json."))));
          return;
        }
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          res.writeHead(422, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(errorBody(new ApiError("validation", "Invalid JSON.", { fields: { body: "is not valid JSON" } }))));
          return;
        }
      }
    }
    const match = router.match(req.method ?? "GET", pathname);
    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(errorBody(new ApiError("not_found", "No such endpoint."))));
      return;
    }
    if ("methodMismatch" in match) {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(errorBody(new ApiError("method_not_allowed", "That method is not allowed here."))));
      return;
    }
    const ctx: RouteCtx = {
      pool: svc.pool,
      body,
      raw,
      user,
      req,
      res,
      params: match.params,
      query: url.searchParams,
    };
    try {
      const result = await match.handler(ctx);
      const headers = { ...(result.headers ?? {}) };
      if (result.body !== undefined) {
        headers["Content-Type"] ??= "application/json; charset=utf-8";
      }
      res.writeHead(result.status, headers);
      if (result.body === undefined) {
        res.end();
      } else {
        res.end(JSON.stringify(result.body));
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
        if (e.code === "link_expired" || e.code === "link_revoked" || e.code === "link_not_found" || e.code === "checkpoint_damaged" || e.code === "storage_unavailable") {
          headers["Cache-Control"] = "no-store";
          headers["Referrer-Policy"] = "no-referrer";
          headers["X-Robots-Tag"] = "noindex";
        }
        res.writeHead(e.status, headers);
        res.end(JSON.stringify(errorBody(e)));
      } else {
        throw e;
      }
    }
    return;
  }

  if (pathname.startsWith("/review/")) {
    const headers = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    };
    const file = path.join(CLIENT_DIST, "review.html");
    if (existsSync(file)) {
      res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(file));
    } else {
      res.writeHead(404, headers);
      res.end("Not found");
    }
    return;
  }

  // Static assets and the single-page app shell.
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(CLIENT_DIST, safePath);
  if (safePath !== "/" && existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    if (MIME[ext]) {
      res.writeHead(200, { "Content-Type": MIME[ext] });
      res.end(readFileSync(filePath));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const shell = path.join(CLIENT_DIST, "index.html");
  const lastSegment = pathname.split("/").pop() ?? "";
  const looksLikeFile = lastSegment.includes(".");
  if (!looksLikeFile && existsSync(shell)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(shell));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function limitFor(pathname: string): number {
  return pathname.endsWith("/imports") ? ZIP_LIMIT : JSON_LIMIT;
}

function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let limit = JSON_LIMIT;
    let overflowed = false;
    const url = req.url ?? "";
    if (url.includes("/imports")) limit = ZIP_LIMIT;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        if (!overflowed) {
          overflowed = true;
          resolve(null);
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!overflowed) resolve(Buffer.concat(chunks));
    });
    req.on("error", () => {
      if (!overflowed) resolve(Buffer.concat(chunks));
    });
  });
}

function startSweeps(svc: Services): void {
  const instanceId = crypto.randomUUID();
  // Pending checkpoint uploads: retry at least once every 10 seconds.
  setInterval(() => {
    void (async () => {
      const claimed = await svc.pool.query(
        `UPDATE checkpoints SET state = 'pending_upload'
         WHERE id IN (
           SELECT id FROM checkpoints WHERE state = 'pending_upload' FOR UPDATE SKIP LOCKED LIMIT 5
         )
         RETURNING id, project_id`,
      );
      for (const row of claimed.rows) {
        try {
          await svc.checkpoints.uploadCheckpoint(row["id"] as string);
        } catch {
          // retried on the next sweep
        }
      }
    })();
  }, 10_000).unref();
  // Queued emails: retry at least once every 30 seconds, each claimed by one instance.
  setInterval(() => {
    void (async () => {
      const claimed = await svc.pool.query(
        `UPDATE email_queue SET status = 'sending', claimed_by = $1, claimed_at = now(), attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM email_queue WHERE status = 'queued' FOR UPDATE SKIP LOCKED LIMIT 10
         )
         RETURNING id, to_email, subject, body`,
        [instanceId],
      );
      for (const row of claimed.rows) {
        try {
          await svc.mailer.send(row["to_email"] as string, row["subject"] as string, row["body"] as string);
          await svc.pool.query(`UPDATE email_queue SET status = 'sent' WHERE id = $1`, [row["id"]]);
          await svc.pool.query(
            `UPDATE invite_email_status SET status = 'sent', updated_at = now() WHERE email = $1 AND status = 'queued'`,
            [row["to_email"]],
          );
        } catch {
          await svc.pool.query(`UPDATE email_queue SET status = 'queued' WHERE id = $1`, [row["id"]]);
        }
      }
    })();
  }, 30_000).unref();
  // Expired import plans: mark expired and delete the quarantine object.
  setInterval(() => {
    void (async () => {
      await svc.imports.sweepExpired();
    })();
  }, 10_000).unref();
}

main().catch((err) => {
  console.error("boot failed", err);
  process.exit(1);
});
