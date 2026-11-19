import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig, type AppConfig } from "../shared/config.js";
import { Database } from "./db.js";
import { MailService, StorageService } from "./services.js";
import { RenderStore } from "./renders.js";
import { parseCookies, SESSION_COOKIE, userFromSession } from "./auth.js";
import type { UserRow } from "./domain.js";
import { send404 } from "./http.js";
import { handleApi } from "./api.js";
import { serveStatic, servePage, servePreview, serveShelfFile } from "./serve.js";
import { handleEvents } from "./events.js";
import { seedAppData } from "./seed.js";

export interface App {
  config: AppConfig;
  db: Database;
  storage: StorageService;
  mail: MailService;
  renders: RenderStore;
  events: import("./events.js").EventBus;
  shelfBytes: Map<string, number>;
  shelfSha256: Map<string, string>;
  retryingSnapshots: Array<{ penId: string; number: number; files: { html: string; css: string; js: string }; libraries: string[] }>;
}

async function main(): Promise<void> {
  const server = createServer((req, res) => void handleRequest(req, res));
  const config = loadConfig(server);
  const { EventBus } = await import("./events.js");
  const { shelfMeta } = await import("./seed.js");
  const meta = shelfMeta();
  const app: App = {
    config,
    db: new Database(config.databaseUrl),
    storage: new StorageService(config.s3),
    mail: new MailService(config.smtp),
    renders: new RenderStore(),
    events: new EventBus(),
    shelfBytes: new Map([...meta.entries()].map(([id, m]) => [id, m.bytes])),
    shelfSha256: new Map([...meta.entries()].map(([id, m]) => [id, m.sha256])),
    retryingSnapshots: [],
  };
  (server as unknown as { app: App }).app = app;

  // Everything below is best-effort: the app must start and serve while any
  // dependency is down, and recover on its own when it returns.
  const start = async () => {
    try {
      await app.db.migrate();
      await seedAppData(app);
    } catch {
      // retried on the next tick
    }
  };
  void start();
  setInterval(() => void start(), 20000).unref?.();
  void app.storage.ping().catch(() => {});
  setInterval(() => void app.storage.ping().catch(() => {}), 10000).unref?.();

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`ashlar serving on 0.0.0.0:${config.port}`);
  });
}

interface AppServer {
  app?: App;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = ((req.socket as unknown as { server?: AppServer }).server)?.app;
  if (!app) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("starting");
    return;
  }
  const config = app.config;
  try {
    const url = new URL(req.url ?? "/", config.publicUrl);
    // Session resolution happens for every request that needs it; pages get it lazily.
    if (url.pathname === "/api/events") {
      const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      let user: UserRow | null = null;
      try {
        user = await userFromSession(app.db, cookie);
      } catch {
        user = null;
      }
      await handleEvents(app, req, res, url, user);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(app, req, res, url);
      return;
    }
    if (url.pathname.startsWith("/preview/")) {
      servePreview(app, req, res, url);
      return;
    }
    if (url.pathname.startsWith("/shelf/")) {
      await serveShelfFile(app, req, res, url);
      return;
    }
    // Non-API write endpoints (none exist; page routes are GET only in practice).
    await serveStaticOrPage(app, req, res, url);
  } catch {
    if (!res.headersSent) {
      send404(res);
    } else {
      res.end();
    }
  }
}

async function serveStaticOrPage(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const embed = url.pathname.startsWith("/embed/");
  const frameHeaders: Record<string, string> = embed
    ? {}
    : { "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" };
  if (await serveStatic(app, res, url, frameHeaders)) return;
  await servePage(app, req, res, url, frameHeaders);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
