import http from "node:http";
import { config } from "./config";
import { ApiError, fail, send, type Reply } from "./http";
import { listenForChanges } from "./live";
import { prepareDatabase } from "./schema";
import { dispatch, publicOrigin } from "./routes";
import { serveStatic } from "./static";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

let prepared = false;
const preparing = (async (): Promise<void> => {
  while (!prepared) {
    try {
      await prepareDatabase();
      prepared = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
})();

/** A state-changing request from another origin is not found. */
function foreignOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (SAFE_METHODS.has(req.method ?? "GET") || !origin) return false;
  const own = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`]);
  if (config.publicUrl) own.add(new URL(config.publicUrl).origin);
  return !own.has(origin);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://app");
  const api = url.pathname.startsWith("/api/");
  let reply: Reply;
  try {
    if (/%00|\u0000/i.test(req.url ?? "")) throw fail.notFound();
    if (!api) {
      if (req.method !== "GET" && req.method !== "HEAD") throw fail.notFound();
      return await serveStatic(res, url.pathname);
    }
    if (foreignOrigin(req)) throw fail.notFound();
    if (url.pathname !== "/api/health") await preparing;
    reply = await dispatch(req, res, url.pathname, url.searchParams, publicOrigin(req));
  } catch (failure) {
    if (failure instanceof ApiError) reply = { status: failure.status, json: failure.body };
    else {
      console.error(failure);
      reply = { status: 500, json: { error: "Something went wrong." } };
    }
  }
  send(res, reply);
}

const server = http.createServer((req, res) => void handle(req, res));
process.on("unhandledRejection", (failure) => console.error(failure));
server.keepAliveTimeout = 65_000;
server.listen(config.port, "0.0.0.0", () => {
  void preparing.then(listenForChanges);
});
