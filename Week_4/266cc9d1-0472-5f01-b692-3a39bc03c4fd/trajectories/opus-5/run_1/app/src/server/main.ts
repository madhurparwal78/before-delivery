import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { applySchema } from "./schema.js";
import { applySeed } from "./fixtures/seed.js";
import { startProbes } from "./services/health.js";
import { startOutboxWorker } from "./services/mail.js";
import { errorHandler, notFoundHandler } from "./http.js";
import { sessionRouter } from "./routes/session.js";
import { corridorRouter } from "./routes/corridors.js";
import { setRouter } from "./routes/sets.js";
import { reviewRouter } from "./routes/review.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../web");

/** The only client routes. Anything else is not served. */
const CLIENT_ROUTES = [/^\/$/, /^\/corridors$/, /^\/corridors\/[^/]+$/, /^\/review\/[^/]+$/];

async function main(): Promise<void> {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  app.use("/api", sessionRouter, corridorRouter, setRouter, reviewRouter);
  app.use("/api", notFoundHandler);

  app.use(
    express.static(webRoot, {
      index: false,
      etag: true,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".ktx2")) res.setHeader("Content-Type", "image/ktx2");
      },
    }),
  );

  let indexHtml: string | null = null;
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!CLIENT_ROUTES.some((pattern) => pattern.test(req.path))) return next();
    const send = (html: string): void => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(html);
    };
    if (indexHtml !== null) {
      send(indexHtml);
      return undefined;
    }
    readFile(path.join(webRoot, "index.html"), "utf8")
      .then((html) => {
        indexHtml = html;
        send(html);
      })
      .catch(() => next());
    return undefined;
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = createServer(app);
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Spanwise listening on 0.0.0.0:${config.port}`);
  });

  try {
    await applySchema();
    await applySeed();
  } catch (error) {
    console.error("schema or seed could not be applied", error);
  }
  startProbes();
  startOutboxWorker();
}

void main();
