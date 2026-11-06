// Clapstick server: one API, one error shape, one precedence ladder. The
// desk's writes and reads need its session cookie; the private pages need
// their token; nothing else is published.

import http from "node:http";
import { readConfig } from "./config";
import { Db } from "./db";
import { Store } from "./store";
import { applySchema, seed } from "./schema";
import * as routes from "./routes";
import { HttpError, errorBody, type Request, type Response } from "./http";
import { CLIENT_INDEX } from "./pages";

const config = readConfig();
const db = new Db(config);
const store = new Store(config);

const PORT = config.appPublicPort;
const HOST = "0.0.0.0";

async function main(): Promise<void> {
  try {
    await applySchema(db);
    await seed(config, db, store);
  } catch (e) {
    console.error("schema or seed failed", e);
  }
  const bucket = await store.ensureBucket();
  if (!bucket.ok) {
    console.error("file store not reachable at start; the app still starts");
  }
  const server = http.createServer(async (req, res) => {
    try {
      const response = await handle(req);
      respond(res, response);
    } catch (e) {
      if (e instanceof HttpError) {
        respond(res, {
          status: e.status,
          headers: { "content-type": "application/json; charset=utf-8", ...e.headers },
          body: errorBody(e.code, e.message, e.fields),
        });
        return;
      }
      console.error("internal error", e);
      respond(res, {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: errorBody("internalError", "Something went wrong on this desk.", null),
      });
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`clapstick serving on ${HOST}:${PORT}`);
  });
  // The pending mail is delivered periodically, each message once, this
  // copy's own mail only (its own database).
  setInterval(() => {
    void routes.deliverMail(config, db).catch(() => undefined);
  }, 5000);
  // Timed work the server alone decides: page endings, reminders, render
  // polling, erasure retries.
  setInterval(() => {
    void routes.tick(config, db, store).catch(() => undefined);
  }, 2000);
}

function respond(res: http.ServerResponse, response: Response): void {
  const headers = { ...response.headers };
  const body = response.body;
  const length = body === null ? 0 : typeof body === "string" ? Buffer.byteLength(body) : body.length;
  headers["content-length"] = String(length);
  res.writeHead(response.status, headers);
  if (body === null || typeof body === "string") {
    res.end(body ?? undefined);
  } else {
    res.end(body);
  }
}

async function handle(req: http.IncomingMessage): Promise<Response> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";
  const path = url.pathname;
  const query = url.searchParams;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v.join(",") : String(v);
  }

  // The app is same-origin: the pages, styles, script and fonts are served
  // from here, and no page loads anything from another origin.
  if (!path.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") {
      return CLIENT_INDEX(path);
    }
    return CLIENT_INDEX(path);
  }

  const body = await readBody(req);
  const request: Request = {
    method,
    path,
    query,
    headers,
    body,
    params: {},
    session: null,
    config,
  };
  return await routes.dispatch(request, store, db);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

main().catch((e) => {
  console.error("failed to start", e);
  process.exit(1);
});
