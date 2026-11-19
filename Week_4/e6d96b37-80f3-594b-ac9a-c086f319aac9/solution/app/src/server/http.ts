// The HTTP pipeline. Transport checks run first, in one place: hidden dealer-only and grading
// routes answer 404 before anything else, then method (405), size (413), content type (415) and
// parsing (400). Every error leaves as the one published error shape.

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACES } from "../shared/drafts.js";
import type { Body, Json, JsonObject } from "./body.js";
import { config, uiLimits } from "./config.js";
import { badRequest, HttpError, methodNotAllowed, notFound, serviceUnavailable, tooLarge, unsupported } from "./errors.js";
import { readSession } from "./sessions.js";

type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Body;
}

export interface Answer {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw bytes (photographs) instead of JSON. */
  bytes?: { data: Buffer; type: string };
}

type Handler = (ctx: Context) => Promise<Answer | "streamed">;

export interface Route {
  pattern: RegExp;
  methods: Partial<Record<Method, { handler: Handler; body: "json" | "multipart" | "none" }>>;
  /** Runs before any transport check: a hidden route answers 404 whatever the method or body. */
  hidden?: (req: IncomingMessage, params: Record<string, string>) => Promise<boolean>;
}

const clientDir = fileURLToPath(new URL("../../client/", import.meta.url));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
};
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
};

let indexHtml: Promise<string> | null = null;

function page(): Promise<string> {
  indexHtml ??= readFile(join(clientDir, "index.html"), "utf8").then((html) =>
    html.replace(
      "<!--flan-config-->",
      `<script id="flan-config" type="application/json">${JSON.stringify(uiLimits()).replace(/</g, "\\u003c")}</script>`,
    ),
  );
  return indexHtml;
}

const PAGE_ROUTES = [
  /^\/$/,
  /^\/help(\/evidence|\/keyboard)?$/,
  /^\/desk\/[a-z0-9-]+$/,
  new RegExp(`^/desk/[a-z0-9-]+/(${Object.values(WORKSPACES).join("|")})$`),
];

export async function sendPage(res: ServerResponse, status = 200): Promise<void> {
  const html = await page();
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": TYPES[".html"]!, "cache-control": "no-store" });
  res.end(html);
}

/** `/` opens the caller's desk on the server, so no page starts loading fonts only to be replaced. */
async function redirectRoot(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = await readSession(req).catch(() => null);
  res.writeHead(302, { ...SECURITY_HEADERS, location: `/desk/${session?.ns ?? "hollowmint"}`, "cache-control": "no-store" });
  res.end();
}

async function serveStatic(path: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (path === "/") {
    await redirectRoot(req, res);
    return true;
  }
  if (PAGE_ROUTES.some((p) => p.test(path))) {
    await sendPage(res);
    return true;
  }
  if (!path.startsWith("/assets/")) return false;
  const file = normalize(join(clientDir, path));
  if (!file.startsWith(clientDir) || path.endsWith(".map")) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function sendError(res: ServerResponse, error: HttpError): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (error.extra.allow) headers.allow = error.extra.allow.join(", ");
  if (error.extra.retryAfter !== undefined) headers["retry-after"] = String(error.extra.retryAfter);
  if (error.status === 413) headers.connection = "close";
  res.writeHead(error.status, headers);
  res.end(JSON.stringify(error.body()));
}

function send(res: ServerResponse, answer: Answer): void {
  const headers = { ...SECURITY_HEADERS, "cache-control": "no-store", ...answer.headers };
  if (answer.bytes) {
    res.writeHead(answer.status, { ...headers, "content-type": answer.bytes.type });
    res.end(answer.bytes.data);
  } else if (answer.body === undefined || answer.body === null) {
    res.writeHead(answer.status, headers);
    res.end();
  } else {
    res.writeHead(answer.status, { ...headers, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(answer.body));
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  const limit = config.limits.FLAN_REQUEST_MAX_BYTES;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(tooLarge());
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => reject(badRequest()));
  });
}

function parseMultipart(raw: Buffer, contentType: string): Body {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) throw badRequest();
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const body: Body = { fields: {}, files: {} };
  let cursor = raw.indexOf(marker);
  if (cursor < 0) throw badRequest();
  for (;;) {
    cursor += marker.length;
    if (raw.subarray(cursor, cursor + 2).toString() === "--") return body;
    if (raw.subarray(cursor, cursor + 2).toString() !== "\r\n") throw badRequest();
    const headerEnd = raw.indexOf("\r\n\r\n", cursor);
    const next = raw.indexOf(marker, headerEnd);
    if (headerEnd < 0 || next < 0) throw badRequest();
    const headers = raw.subarray(cursor + 2, headerEnd).toString("utf8");
    const content = raw.subarray(headerEnd + 4, next - 2);
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    if (name === undefined) throw badRequest();
    if (/filename="/i.test(headers)) body.files[name] = { bytes: Buffer.from(content) };
    else body.fields[name] = content.toString("utf8");
    cursor = next;
  }
}

async function parseBody(req: IncomingMessage, kind: "json" | "multipart" | "none"): Promise<Body> {
  const empty: Body = { fields: {}, files: {} };
  if (kind === "none") {
    req.resume();
    return empty;
  }
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > config.limits.FLAN_REQUEST_MAX_BYTES) throw tooLarge();
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  const wanted = kind === "json" ? "application/json" : "multipart/form-data";
  if (!type.startsWith(wanted)) {
    req.resume();
    throw unsupported();
  }
  const raw = await readBody(req);
  if (kind === "multipart") return parseMultipart(raw, req.headers["content-type"] ?? "");
  let parsed: Json;
  try {
    parsed = JSON.parse(raw.toString("utf8") || "null") as Json;
  } catch {
    throw badRequest();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw badRequest();
  return { fields: parsed as JsonObject, files: {} };
}

export function router(routes: Route[]) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      const route = routes.find((r) => r.pattern.test(url.pathname));
      if (!route) {
        if ((req.method === "GET" || req.method === "HEAD") && (await serveStatic(url.pathname, req, res))) return;
        req.resume();
        throw notFound();
      }
      const params = route.pattern.exec(url.pathname)!.groups ?? {};
      for (const [key, value] of Object.entries(params)) {
        try {
          params[key] = decodeURIComponent(value);
        } catch {
          throw notFound();
        }
      }
      if (route.hidden && (await route.hidden(req, params))) {
        req.resume();
        throw notFound();
      }
      const method = route.methods[req.method as Method];
      if (!method) {
        req.resume();
        throw methodNotAllowed(Object.keys(route.methods));
      }
      const body = await parseBody(req, method.body);
      const answer = await method.handler({ req, res, url, params, body });
      if (answer !== "streamed") send(res, answer);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendError(res, error instanceof HttpError ? error : serviceUnavailable());
    }
  };
}
