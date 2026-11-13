import express from "express";
import { readFileSync } from "node:fs";
import { api } from "./api.js";
import { personFromRequest, serverNow } from "./auth.js";
import { migrateAndSeed } from "./migrate.js";
import { retrySeals } from "./archive.js";

const PORT = Number(process.env.APP_PUBLIC_PORT ?? "4173");
const BODY_LIMIT = 1_000_000;

const app = express();

// Server boundary: same-origin rule, request limits, no source files.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && req.method !== "GET" && req.method !== "HEAD") {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== req.headers.host) {
      res.status(403).json({ error: "cross_origin", message: "Requests from other origins are refused." });
      return;
    }
  }
  next();
});

app.use((req, res, next) => {
  const contentType = req.headers["content-type"] ?? "";
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
    if (req.headers["content-length"] && Number(req.headers["content-length"]) > BODY_LIMIT) {
      res.status(413).json({ error: "payload_too_large", message: "That request is too large." });
      return;
    }
    if (contentType !== "" && !contentType.startsWith("application/json")) {
      res.status(415).json({ error: "unsupported_media_type", message: "Send the request as JSON." });
      return;
    }
  }
  next();
});

app.use(express.json({ limit: BODY_LIMIT, type: "application/json" }));

app.use(async (req, res, next) => {
  req.person = (await personFromRequest(req)) ?? undefined;
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", api);

// Static assets: fonts and built scripts only. Source files, manifests and
// credentials are never served.
const FORBIDDEN = new Set(["/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/build.mjs", "/.env"]);
app.use(express.static("public", { index: false }));
app.get("*", (req, res) => {
  if (FORBIDDEN.has(req.path) || req.path.startsWith("/src") || req.path.startsWith("/dist") || req.path.startsWith("/.")) {
    res.status(404).send("We couldn't find that page.");
    return;
  }
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "not_found", message: "We couldn't find that page." });
    return;
  }
  if (req.path.startsWith("/fonts/") || req.path.endsWith(".js") || req.path.endsWith(".css")) {
    res.status(404).send("We couldn't find that page.");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(readHtml());
});

function readHtml(): string {
  return readFileSync("public/index.html", "utf8");
}

async function main(): Promise<void> {
  await migrateAndSeed();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Sixbell Rest Log on 0.0.0.0:${PORT}`);
  });
  // The seal loop retries every awaiting month at least every 10 seconds.
  setInterval(() => {
    void retrySeals().catch(() => undefined);
  }, 10_000);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
