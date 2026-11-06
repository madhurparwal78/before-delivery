import express from "express";
import type { Request, Response, NextFunction } from "express";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { errors, ApiError } from "./errors.js";
import type { AppRequest } from "./web.js";

// The server serves only the built browser assets, /api and /media. Any /sheet
// address, with any query, serves the browser app. The server never serves
// source files, run.json, package manifests, lockfiles, environment files or
// anything under the app directory by path; those paths answer 404.
const PUBLIC_DIR = join(fileURLToPath(new URL("../../public", import.meta.url)));
const APP_ROUTES = new Set(["/", "/sheet", "/studio", "/shortlist", "/licences", "/usage", "/royalties", "/review-queue", "/all-essays", "/rates", "/statements", "/following"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".json": "application/json; charset=utf-8",
};

const FORBIDDEN = /^\/(src|scripts|node_modules|dist)/i;

export function registerStatic(app: express.Express): void {
  const indexHtml = existsSync(join(PUBLIC_DIR, "index.html"))
    ? readFileSync(join(PUBLIC_DIR, "index.html"), "utf8")
    : "<!doctype html><html><body>Saltprint Desk</body></html>";

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const path = normalize(req.path).replace(/\/+$/, "") || "/";
    if (path.startsWith("/api") || path.startsWith("/media")) {
      next();
      return;
    }
    if (FORBIDDEN.test(path) || path === "/run.json" || path === "/package.json" || path === "/package-lock.json" || extname(path) === ".ts" || extname(path) === ".mjs" || path.endsWith(".env") || path.startsWith("/.env")) {
      res.status(404).json(errors.notFound().body());
      return;
    }
    if (APP_ROUTES.has(path)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(indexHtml);
      return;
    }
    if (path.startsWith("/assets/")) {
      const file = join(PUBLIC_DIR, path);
      if (existsSync(file)) {
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        res.status(200).send(readFileSync(file));
        return;
      }
    }
    res.status(404).json(errors.notFound().body());
  });

  // Final error shape for anything unhandled.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    void req;
    void next;
    if (res.headersSent) return;
    if (err instanceof ApiError) {
      res.status(err.status).json(err.body());
      return;
    }
    const httpErr = err as { status?: number; statusCode?: number; type?: string; code?: string };
    if (httpErr.type === "entity.too.large" || httpErr.statusCode === 413 || httpErr.code === "LIMIT_FILE_SIZE" || httpErr.code === "LIMIT_UNEXPECTED_FILE") {
      res.status(413).json(errors.payloadTooLarge().body());
      return;
    }
    if (httpErr.type === "media.type" || httpErr.type === "charset.unsupported" || httpErr.statusCode === 415 || httpErr.code === "UNSUPPORTED_MEDIA_TYPE") {
      res.status(415).json(errors.unsupportedMediaType().body());
      return;
    }
    if (httpErr.code === "ECONNREFUSED" || httpErr.code === "ETIMEDOUT" || httpErr.code === "ECONNRESET" || httpErr.code === "ENOTFOUND") {
      res.status(503).json(errors.databaseUnavailable().body());
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "internal", message: "Something went wrong on Saltprint Desk." } });
  });
}
