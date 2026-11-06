import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "./config.js";

// Static assets: only the built browser bundle and its index page are served.
// Source, configuration and anything outside public/ answer 404 (DP-41).

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export const serveStatic = (pathname: string, res: http.ServerResponse): void => {
  const clean = pathname.replace(/\\/g, "/");
  if (clean.includes("..")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  let candidate = path.resolve(PUBLIC_DIR, `.${clean}`);
  if (clean === "/" || clean === "") candidate = path.join(PUBLIC_DIR, "index.html");
  if (!candidate.startsWith(PUBLIC_DIR)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    // The app has one entry page; any other path renders it.
    const index = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(index)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(fs.readFileSync(index));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const type = TYPES[path.extname(candidate)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(fs.readFileSync(candidate));
};

export const startHttpServer = (handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): void => {
  const server = http.createServer(handler);
  server.listen(config.publicPort, "0.0.0.0");
  console.log(`railside listening on ${config.publicPort}`);
};
