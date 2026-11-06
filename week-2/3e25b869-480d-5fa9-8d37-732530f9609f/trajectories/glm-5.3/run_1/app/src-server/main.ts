// The Loafline server: static assets, the API dispatcher, health, background work.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "./core/env.js";
import { createPool, applySchema } from "./db/schema.js";
import { KillBillClient } from "./services/killbill.js";
import { Outbox } from "./services/outbox.js";
import { Background } from "./background/background.js";
import { ApiRouter } from "./routes/router.js";
import type { Services } from "./routes/routes.js";

const DIST_DIR = join(fileURLToPath(new URL(import.meta.url)), "..", "..", "dist");

/** Paths that answer with the app; anything else is the 404 page. */
const KNOWN_SCREENS = /^\/($|checkout|checkout\/placed\/[^/]+|subscribe|account|account\/orders\/[^/]+|account\/subscriptions\/[^/]+|contact|studio|studio\/[a-z]+)$/;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".svg": "image/svg+xml"
};

async function main(): Promise<void> {
  const env = readEnv();
  const pool = createPool(env.databaseUrl);
  // Retry the schema until PostgreSQL answers.
  for (;;) {
    try {
      await applySchema(pool);
      break;
    } catch (err) {
      console.error("database not ready:", err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  const kb = new KillBillClient(env);
  const outbox = new Outbox(env, pool);
  const background = new Background(pool, kb, outbox);
  background.start();

  const services: Services = { env, pool, kb, outbox, billingUp: true };
  const router = new ApiRouter(services);
  const refreshBilling = () => {
    services.billingUp = background.billingUp;
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      refreshBilling();
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        const request = new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : (req as unknown as ReadableStream),
          // @ts-expect-error Node 22 accepts duplex for streaming request bodies.
          duplex: "half"
        });
        const result = await router.handle(request, url);
        res.writeHead(result.status, result.headers);
        res.end(result.body ?? undefined);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method not allowed");
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (err) {
      console.error("request failed:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { code: "internal_error", message: "Something went wrong." } }));
      } else {
        res.end();
      }
    }
  });

  server.listen(env.publicPort, "0.0.0.0", () => {
    console.log(`Loafline listening on 0.0.0.0:${env.publicPort}`);
  });
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  if (pathname.includes("..")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  let assetPath = pathname;
  let status = 200;
  const known = KNOWN_SCREENS.test(pathname);
  if (pathname === "/" || known) {
    assetPath = "/index.html";
  } else if (extname(pathname) === "") {
    // Unknown page: the app shows its not-found screen, with a 404 status.
    assetPath = "/index.html";
    status = 404;
  }
  const file = join(DIST_DIR, assetPath);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const content = await readFile(file);
    res.writeHead(status, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=300"
    });
    res.end(content);
  } catch {
    try {
      const html = await readFile(join(DIST_DIR, "index.html"));
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      res.end(html);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }
}

main().catch((err) => {
  console.error("server failed to start:", err);
  process.exit(1);
});
