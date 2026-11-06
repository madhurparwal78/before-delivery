import http from "node:http";
import pg from "pg";
import { Db } from "./db.js";
import { loadConfig } from "./config.js";
import { seedIfEmpty } from "./seed.js";
import { PostcardStore } from "./store.js";
import { PostOffice } from "./mail.js";
import { handleApi, tick, type ServerDeps } from "./routes.js";
import { serveClient, postcardPage, returnedToSenderPage } from "./pages.js";
import { sendHtml, sendJson, sendBytes } from "./http-util.js";
import { Errors } from "./errors.js";
import { postcardByShareToken } from "./api.js";

// Boot: read the environment, keep retrying Postgres, start serving once the schema
// and seed are in place, and let MinIO and Mailpit be reached afresh on every request.

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = new pg.Pool({
    connectionString: cfg.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
  });
  const db = new Db(pool);
  const store = new PostcardStore(cfg);
  const postOffice = new PostOffice(cfg);

  let dbReady = false;
  const deps: ServerDeps = {
    db,
    cfg,
    store,
    postOffice,
    dbReady: () => dbReady,
  };

  const boot = async (): Promise<void> => {
    await db.migrate();
    await db.tx((tx) => seedIfEmpty(tx, cfg));
    dbReady = true;
  };
  boot().catch(() => {
    const retry = setInterval(() => {
      boot().then(() => {
        clearInterval(retry);
        console.log("database connected");
      }).catch(() => {
        // keep retrying every 2 seconds until Postgres is reachable
      });
    }, 2000);
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (await handleApi(deps, req, res, url)) return;
      if (await servePostcard(deps, req, res, url)) return;
      if (await serveClient(req, res, url)) return;
      sendJson(res, 404, Errors.notFound().body());
    } catch {
      if (!res.headersSent) sendJson(res, 500, Errors.internal().body());
      else res.end();
    }
  });

  setInterval(() => {
    tick(deps).catch(() => {
      // the next tick retries
    });
  }, 500);

  const port = cfg.publicPort;
  server.listen(port, "0.0.0.0", () => {
    console.log(`parcel moon listening on 0.0.0.0:${port}`);
  });
}

/** The public postcard page and its image. Any other method on /p/... answers 405. */
async function servePostcard(deps: ServerDeps, req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith("/p/")) return false;
  const rest = url.pathname.slice(3);
  const m = /^([^/]+)(?:\/image\.png)?$/.exec(rest);
  const imageReq = rest.endsWith("/image.png");

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, Errors.methodNotAllowed().body());
    return true;
  }
  if (!m) {
    sendHtml(res, 404, returnedToSenderPage());
    return true;
  }
  const shareToken = decodeURIComponent(m[1]);

  if (!deps.dbReady()) {
    sendHtml(res, 404, returnedToSenderPage());
    return true;
  }
  const postcard = await deps.db.tx(async (tx) => postcardByShareToken(tx, shareToken));
  if (!postcard) {
    if (imageReq) sendJson(res, 404, Errors.notFound().body());
    else sendHtml(res, 404, returnedToSenderPage());
    return true;
  }

  if (imageReq) {
    const bytes = await deps.store.get(postcard.postcard_id);
    if (!bytes) {
      sendJson(res, 503, JSON.stringify({ error: { code: "darkroom_closed", message: "The darkroom is closed." } }));
      return true;
    }
    sendBytes(res, 200, bytes, "image/png", {
      "Content-Disposition": 'inline; filename="postcard.png"',
      "Cache-Control": "no-store",
    });
    return true;
  }

  // The caption carries the live display name, read at view time.
  const { rows } = await deps.db.query<{ display_name: string }>(
    `SELECT display_name FROM postcards p JOIN couriers c ON c.id = p.courier_id WHERE p.share_token=$1`,
    [shareToken],
  );
  sendHtml(res, 200, postcardPage(rows[0].display_name, shareToken));
  return true;
}

main();
