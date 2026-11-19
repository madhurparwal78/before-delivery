import http from "node:http";
import { userForRequest } from "./accounts.js";
import { initClock } from "./clock.js";
import { config } from "./config.js";
import { applySchema, waitForDatabase } from "./db.js";
import { seedDemoContent } from "./demo.js";
import { notFound } from "./errors.js";
import { dispatch, writeError, writeReply } from "./http.js";
import { startLive } from "./live.js";
import { expireOperations, purgeImages } from "./operations.js";
import { buildRouter } from "./routes.js";
import { serveClient } from "./static.js";
import { checkStorage, watchStorage } from "./storage.js";

const CSP = "img-src 'self' data: blob:; font-src 'self'; media-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const DRAIN_LIMIT = 32 * 1024 * 1024;

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await initClock();
  await checkStorage();
  watchStorage();
  await seedDemoContent().catch((error: unknown) => console.error("demo content not created; the next start tries again", String(error)));
  const router = buildRouter();
  const server = http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", CSP);
    const url = new URL(req.url ?? "/", "http://localhost");
    // A reply sent before the body was read (an early refusal) drains the rest, so the client reads the
    // reply instead of a reset; only a body far past any limit is cut off.
    res.on("finish", () => {
      if (req.complete) return;
      let drained = 0;
      req.on("data", (chunk: Buffer) => {
        drained += chunk.length;
        if (drained > DRAIN_LIMIT) req.destroy();
      });
      req.resume();
    });
    const handle = async (): Promise<void> => {
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) {
        const reply = await dispatch(router, req, url, userForRequest);
        if (reply) writeReply(res, reply);
        else writeError(res, notFound());
        return;
      }
      if (!(await serveClient(req, res, url.pathname))) writeError(res, notFound());
    };
    handle().catch((error: unknown) => writeError(res, error));
  });
  await startLive(server);
  setInterval(() => void expireOperations().catch((error: unknown) => console.error("expiry failed", String(error))), 1000).unref();
  setInterval(() => void purgeImages().catch((error: unknown) => console.error("image sweep failed", String(error))), 5000).unref();
  server.listen(config.port, "0.0.0.0", () => console.log(`mothlight listening on ${config.port}`));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
