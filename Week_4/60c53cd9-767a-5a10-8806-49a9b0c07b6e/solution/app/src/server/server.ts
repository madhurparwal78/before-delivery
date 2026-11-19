/** Process entry: wires the services, serves the API, media and the single-page app, and starts the background work. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Accounts } from "./accounts.js";
import { AppClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { ConsoleActions } from "./console.js";
import { Database } from "./db.js";
import { ApiError } from "./errors.js";
import { Holds } from "./holds.js";
import { dispatch, errorResult, send, type Result, type Route } from "./http.js";
import { Indexer } from "./indexer.js";
import { MediaSigner } from "./media.js";
import { SearchClient } from "./meili.js";
import { buildRoutes, type Services } from "./routes.js";
import { ObjectStore } from "./s3.js";
import { Search } from "./search.js";
import { AssetSeeder, seedDatabase } from "./seed.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const listPublic = (directory: string, prefix = ""): Map<string, Buffer> => {
  const files = new Map<string, Buffer>();
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      for (const [path, body] of listPublic(full, `${prefix}${name}/`)) files.set(path, body);
    } else if (name !== "index.html") {
      files.set(`/${prefix}${name}`, readFileSync(full));
    }
  }
  return files;
};

const PAGE_ROUTES = [/^\/$/, /^\/finder$/, /^\/console$/, /^\/holds\/[^/]+$/, /^\/shared\/[^/]+$/];

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const main = async (): Promise<void> => {
  const config = loadConfig();
  const clock = new AppClock(config.clockStart);
  const db = new Database(config.databaseUrl);
  const store = new ObjectStore(config.s3);
  const searchClient = new SearchClient(config.meili);
  const media = new MediaSigner(config, clock);
  const indexer = new Indexer(db, searchClient, clock);
  const accounts = new Accounts(db, clock, config);
  const services: Services = {
    config,
    clock,
    db,
    store,
    media,
    indexer,
    accounts,
    holds: new Holds(db, clock, config, indexer, media),
    search: new Search(db, clock, config, searchClient, indexer, media),
    console: new ConsoleActions(db, clock, indexer, store),
  };
  const routes: Route[] = buildRoutes(services);
  const publicOrigin = new URL(config.publicUrl).origin;
  const assets = listPublic(PUBLIC_DIR);
  const template = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");

  const page = async (path: string): Promise<Result> => {
    let title = "Highwater";
    let headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" };
    let robots = "";
    const shared = /^\/shared\/([^/]+)$/.exec(path);
    if (shared) {
      const found = await services.holds.shared(decodeURIComponent(shared[1] as string));
      title = found ? `Home ${found.unit.code} · Highwater` : "Shared link · Highwater";
      robots = '<meta name="robots" content="noindex">';
      headers = { ...headers, "cache-control": "no-store", "referrer-policy": "no-referrer" };
    }
    const head = `<title>${escapeHtml(title)}</title>${robots}<meta name="sales-office-tz" content="${escapeHtml(config.officeZone)}">`;
    return { status: 200, headers, raw: Buffer.from(template.replace("<!--HW:HEAD-->", head), "utf8") };
  };

  const handle = async (req: IncomingMessage, url: URL): Promise<Result> => {
    const method = req.method ?? "GET";
    for (const route of routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(url.pathname);
      if (match) return dispatch(route, req, url, match.slice(1), accounts, publicOrigin);
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return errorResult(new ApiError("not_found"));
    if (method === "GET" || method === "HEAD") {
      const asset = assets.get(url.pathname);
      if (asset) {
        return {
          status: 200,
          raw: asset,
          headers: { "content-type": TYPES[extname(url.pathname)] ?? "application/octet-stream", "cache-control": "public, max-age=300" },
        };
      }
      if (PAGE_ROUTES.some((pattern) => pattern.test(url.pathname))) return page(url.pathname);
    }
    return { status: 404, raw: Buffer.from("Not found"), headers: { "content-type": "text/plain; charset=utf-8" } };
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.sendDate = false;
    const url = new URL(req.url ?? "/", "http://localhost");
    handle(req, url)
      .then((result) => send(res, clock, result))
      .catch(() => {
        if (!res.headersSent) send(res, clock, errorResult(new ApiError("internal")));
        else res.end();
      });
  });
  server.keepAliveTimeout = 65_000;
  server.listen(config.port, "0.0.0.0");

  const initialise = async (): Promise<void> => {
    for (;;) {
      try {
        try {
          await db.migrate((client) => seedDatabase(client, clock, config));
        } catch (error) {
          if ((error as { code?: string }).code !== "3D000") throw error;
          await db.ensureDatabase();
          await db.migrate((client) => seedDatabase(client, clock, config));
        }
        db.markReady();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    indexer.start();
    new AssetSeeder(db, store, clock).start();
  };
  void initialise();

  const shutdown = (): void => {
    indexer.stop();
    server.close();
    void db.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

void main();
