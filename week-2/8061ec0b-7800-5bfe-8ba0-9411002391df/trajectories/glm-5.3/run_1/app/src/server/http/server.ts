// The HTTP server: same-origin boundary, body limits, media type checks,
// static serving of built assets only, and the API router.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import busboy from "busboy";
import { ApiError } from "../errors.js";

export interface UploadedFile {
  fieldName: string;
  data: Buffer;
  size: number;
}

export interface MultipartData {
  fields: Record<string, string>;
  files: UploadedFile[];
}

export interface ApiRequest {
  method: string;
  url: URL;
  rawBody: Buffer;
  body: unknown;
  sessionToken: string | null;
  query: URLSearchParams;
  params: Record<string, string>;
  multipart: MultipartData | null;
  headers: Record<string, string | string[] | undefined>;
}

export interface FileResponse {
  data: Buffer;
  contentType: string;
  disposition?: string;
}

export interface JsonResponseBody {
  status: number;
  body: unknown;
  setCookie?: string;
}

export type ApiHandler = (req: ApiRequest) => Promise<ApiError | FileResponse | JsonResponseBody | undefined>;

export interface RouteOptions {
  multipart?: boolean;
  jsonBody?: boolean;
}

const JSON_LIMIT = 100_000;
const MULTIPART_LIMIT = 31_000_000;
export const SESSION_COOKIE = "bellroll_session";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: ApiHandler;
  multipart: boolean;
  jsonBody: boolean;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export class HttpServer {
  private readonly routes: Route[] = [];
  private readonly port: number;
  private readonly distClientDir: string;
  healthReady: () => boolean = () => true;

  constructor(port: number) {
    this.port = port;
    this.distClientDir = path.resolve(__dirname, "../client");
  }

  addRoute(method: string, pathPattern: string, handler: ApiHandler, options: RouteOptions = {}): void {
    const paramNames: string[] = [];
    const source = pathPattern.replace(/\{(\w+)\}/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${source}$`),
      paramNames,
      handler,
      multipart: options.multipart ?? false,
      jsonBody: options.jsonBody ?? true,
    });
  }

  // The app's own origin is judged per request from the Host header; the
  // scheme is not compared and APP_PUBLIC_URL plays no part.
  private static sameOrigin(hostHeader: string | undefined, originHeader: string | undefined): boolean {
    if (!originHeader) return true;
    if (originHeader === "null") return false;
    let origin: URL;
    try {
      origin = new URL(originHeader);
    } catch {
      return false;
    }
    const originHost = origin.hostname.toLowerCase();
    const originPort = origin.port || (origin.protocol === "https:" ? "443" : "80");
    const [host, port] = (hostHeader ?? "").toLowerCase().split(":");
    const hostPort = port || "80";
    return originHost === host && originPort === hostPort;
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        void this.handle(req, res);
      });
      server.listen(this.port, "0.0.0.0", () => resolve());
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/api/health") {
      if (this.healthReady()) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "starting" }));
      }
      return;
    }

    if (!pathname.startsWith("/api/")) {
      if (method === "GET" || method === "HEAD") {
        this.serveStatic(res, pathname);
      } else {
        res.writeHead(405).end();
      }
      return;
    }

    const route = this.matchRoute(method, pathname);
    const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const isMultipartRoute = route?.multipart ?? false;
    const declaredMultipart = contentType === "multipart/form-data";

    // 1. Whole-request boundary rejections only: cross-origin state
    // changes, body limits and media types.
    const isStateChanging = method !== "GET" && method !== "HEAD";
    if (isStateChanging && !HttpServer.sameOrigin(req.headers.host, req.headers.origin)) {
      this.sendError(res, new ApiError(403, "cross_origin", "Cross-origin requests are refused."));
      return;
    }
    if (route !== null && isMultipartRoute && !declaredMultipart) {
      this.sendError(res, new ApiError(415, "unsupported_media_type", "That content type is not accepted."));
      return;
    }
    const limit = isMultipartRoute ? MULTIPART_LIMIT : JSON_LIMIT;
    const raw = await this.readBody(req, limit);
    if (raw === null) {
      this.sendError(res, new ApiError(413, "payload_too_large", "That request body is too large."));
      return;
    }
    if (isStateChanging && route !== null && !isMultipartRoute && contentType !== "" && contentType !== "application/json") {
      this.sendError(res, new ApiError(415, "unsupported_media_type", "That content type is not accepted."));
      return;
    }
    if (route === null) {
      this.sendError(res, new ApiError(404, "not_found", "Not found."));
      return;
    }

    let parsedBody: unknown = null;
    let multipart: MultipartData | null = null;
    if (isMultipartRoute) {
      multipart = await this.parseMultipart(req, raw);
    } else if (raw.length > 0) {
      try {
        parsedBody = JSON.parse(raw.toString("utf-8"));
      } catch {
        this.sendError(res, ApiError.validation({ body: "The request body is not valid JSON." }));
        return;
      }
    }

    const cookies = parseCookies(req.headers.cookie ?? "");
    const match = pathname.match(route.pattern) ?? [];
    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1] ?? "");
    });
    const apiRequest: ApiRequest = {
      method,
      url,
      rawBody: raw,
      body: parsedBody,
      sessionToken: cookies[SESSION_COOKIE] ?? null,
      query: url.searchParams,
      params,
      multipart,
      headers: req.headers,
    };

    const result = await route.handler(apiRequest);
    if (result === undefined) {
      res.writeHead(204).end();
      return;
    }
    if (result instanceof ApiError) {
      this.sendError(res, result);
      return;
    }
    if (isFileResponse(result)) {
      res.writeHead(200, {
        "Content-Type": result.contentType,
        ...(result.disposition ? { "Content-Disposition": result.disposition } : {}),
        "Cache-Control": "no-store",
      });
      res.end(result.data);
      return;
    }
    res.writeHead(result.status, {
      "Content-Type": "application/json; charset=utf-8",
      ...(result.setCookie ? { "Set-Cookie": result.setCookie } : {}),
    });
    res.end(JSON.stringify(result.body));
  }

  private matchRoute(method: string, pathname: string): Route | null {
    for (const route of this.routes) {
      if (route.method === method && route.pattern.test(pathname)) {
        return route;
      }
    }
    return null;
  }

  private readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on("data", (chunk: Buffer) => {
        if (aborted) return;
        size += chunk.length;
        if (size > limit) {
          // Respond 413 and drain the rest of the request.
          aborted = true;
          chunks.length = 0;
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (!aborted) resolve(Buffer.concat(chunks));
      });
      req.on("error", () => {
        if (!aborted) resolve(Buffer.concat(chunks));
      });
    });
  }

  private parseMultipart(req: http.IncomingMessage, raw: Buffer): Promise<MultipartData> {
    return new Promise((resolve, reject) => {
      const parser = busboy({
        headers: req.headers as Record<string, string>,
        limits: { fileSize: MULTIPART_LIMIT + 1, files: 12 },
      });
      const fields: Record<string, string> = {};
      const files: UploadedFile[] = [];
      parser.on("field", (name, value) => {
        fields[name] = value;
      });
      parser.on("file", (name, stream) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          files.push({ fieldName: name, data: Buffer.concat(chunks), size: Buffer.concat(chunks).length });
        });
      });
      parser.on("error", () => reject(new ApiError(413, "payload_too_large", "These photos are too large to send together.")));
      parser.on("close", () => resolve({ fields, files }));
      parser.end(raw);
    });
  }

  private sendError(res: http.ServerResponse, error: ApiError): void {
    if (res.writableEnded) return;
    res.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(error.body()));
  }

  // Only built assets and the index are served. Source, configuration,
  // lockfiles and source maps all answer 404.
  private serveStatic(res: http.ServerResponse, pathname: string): void {
    const relative = pathname.replace(/^\/+/, "");
    const filePath = path.join(this.distClientDir, relative);
    if (relative !== "" && !filePath.startsWith(this.distClientDir + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isFile()) {
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".ttf": "font/ttf",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
        };
        const ext = path.extname(filePath).toLowerCase();
        fs.readFile(filePath, (readErr, data) => {
          if (readErr) {
            res.writeHead(404).end();
            return;
          }
          res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream", "Cache-Control": "no-store" });
          res.end(data);
        });
        return;
      }
      if (path.extname(relative) !== "") {
        res.writeHead(404).end();
        return;
      }
      fs.readFile(path.join(this.distClientDir, "index.html"), (indexErr, data) => {
        if (indexErr) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(data);
      });
    });
  }
}

function isFileResponse(value: unknown): value is FileResponse {
  return typeof value === "object" && value !== null && "data" in value && "contentType" in value;
}
