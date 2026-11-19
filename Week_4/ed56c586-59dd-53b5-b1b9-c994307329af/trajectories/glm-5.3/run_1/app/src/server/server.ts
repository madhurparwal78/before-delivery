/**
 * The app server. Serves the pages, the built assets, the media route and the
 * API. Same-origin only: no CORS headers, no cookies, no CSP. Source files,
 * maps, dotfiles and package files answer the not-found page.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { EnquiryValues } from "../shared/domain.js";
import {
  BUDGET_LABEL,
  PROJECT_TYPE_LABEL,
  SITE,
  normaliseName,
  validateEnquiry,
} from "../shared/domain.js";
import { decodeMediaKey, isMediaKey } from "../shared/media.js";
import { MediaLibrary } from "./media-library.js";
import { type S3Config } from "./s3.js";
import { sendMail, type SmtpConfig } from "./mail.js";
import { neighbourLinks, renderCaseStudy, renderHome, renderNotFound } from "./pages.js";
import { PROJECTS_BY_SLUG } from "../shared/domain.js";

export type Env = {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_FORCE_PATH_STYLE: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  MAIL_FROM: string;
  GRADING_KEY?: string;
  MEDIA_PROBE_SECONDS?: string;
  MAIL_TIMEOUT_SECONDS?: string;
  APP_PUBLIC_PORT?: string;
};

const BODY_LIMIT = 16384;

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super();
  }
}

const NOT_FOUND_BODY = { error: "not_found", message: "Not found." };
const METHOD_NOT_ALLOWED_BODY = { error: "method_not_allowed", message: "Method not allowed." };

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

function sendJsonError(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  json(res, status, body);
}

type Context = {
  media: MediaLibrary;
  smtp: SmtpConfig;
  mailFrom: string;
  gradingKey: string | null;
  assetsRoot: string;
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new HttpError(413, { error: "too_large", message: "The request body is too large." });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, { error: "bad_request", message: "The request body must be a JSON object." });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, { error: "bad_request", message: "The request body must be a JSON object." });
  }
  return parsed as Record<string, unknown>;
}

function enquiryValues(body: Record<string, unknown>): EnquiryValues {
  const field = (key: string): string => {
    const value = body[key];
    return typeof value === "string" ? value : "";
  };
  return {
    name: field("name"),
    email: field("email"),
    projectType: field("projectType"),
    budget: field("budget"),
    message: field("message"),
  };
}

async function checkMail(context: Context): Promise<boolean> {
  try {
    const net = await import("node:net");
    return await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: context.smtp.host, port: context.smtp.port });
      socket.setTimeout(context.smtp.timeoutSeconds * 1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      const fail = (): void => resolve(false);
      socket.once("error", fail);
      socket.once("timeout", () => {
        socket.destroy();
        fail();
      });
    });
  } catch {
    return false;
  }
}

export function createApp(context: Context): import("node:http").Server {
  const server = createServer((req, res) => {
    void handle(req, res, context).catch((error: unknown) => {
      if (error instanceof HttpError) {
        if (isPageRequest(req)) sendPage(res, 404, renderNotFound());
        else sendJsonError(res, error.status, error.body);
        return;
      }
      if (isPageRequest(req)) sendPage(res, 404, renderNotFound());
      else sendJsonError(res, 500, { error: "server_error", message: "The server could not answer." });
    });
  });
  return server;
}

function isPageRequest(req: IncomingMessage): boolean {
  const url = new URL(req.url ?? "/", "http://local");
  return (
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/media/") &&
    !url.pathname.startsWith("/assets/")
  );
}

async function handle(req: IncomingMessage, res: ServerResponse, context: Context): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const pathname = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/api/health") {
    if (method !== "GET") return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    const reachable = await context.media.isReachable();
    const mail = await checkMail(context);
    json(res, 200, { status: reachable && mail ? "ok" : "unavailable" });
    return;
  }

  if (pathname === "/api/media") {
    if (method !== "GET") return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    const report = await context.media.report();
    json(res, 200, report);
    return;
  }

  if (pathname === "/api/enquiries") {
    if (method !== "POST") return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    const raw = await readBody(req);
    const body = parseJsonBody(raw);
    const values = enquiryValues(body);
    const errors = validateEnquiry(values);
    if (Object.keys(errors).length > 0) {
      return json(res, 422, {
        error: "invalid",
        message: "The enquiry has invalid fields.",
        fields: errors,
      });
    }
    const name = normaliseName(values.name);
    const projectTypeName = PROJECT_TYPE_LABEL.get(values.projectType) ?? values.projectType;
    const budgetLabel = BUDGET_LABEL.get(values.budget) ?? values.budget;
    const subject = `New enquiry: ${projectTypeName} from ${name}`;
    const lines = [
      `Name: ${name}`,
      `Email: ${values.email.trim()}`,
      `Project type: ${projectTypeName}`,
      `Budget: ${budgetLabel}`,
      "",
      values.message.trim(),
    ];
    try {
      await sendMail(context.smtp, {
        from: context.mailFrom,
        replyTo: values.email.trim(),
        to: SITE.email,
        subject,
        body: lines.join("\n"),
      });
    } catch {
      return sendJsonError(res, 503, {
        error: "mail_unavailable",
        message: "The mail server is unavailable.",
      });
    }
    return json(res, 201, { status: "sent" });
  }

  if (pathname === "/api/grading/reset") {
    if (!context.gradingKey) return sendJsonError(res, 404, NOT_FOUND_BODY);
    if (method !== "POST") return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    if (req.headers["x-grading-key"] !== context.gradingKey) {
      return sendJsonError(res, 404, NOT_FOUND_BODY);
    }
    await context.media.reset();
    return json(res, 200, { status: "ok" });
  }

  const gradingMedia = /^\/api\/grading\/media\/(.*)$/.exec(pathname);
  if (gradingMedia) {
    if (!context.gradingKey) return sendJsonError(res, 404, NOT_FOUND_BODY);
    if (method !== "DELETE") return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    if (req.headers["x-grading-key"] !== context.gradingKey) {
      return sendJsonError(res, 404, NOT_FOUND_BODY);
    }
    const key = decodeMediaKey(gradingMedia[1]);
    if (key === null || !isMediaKey(key)) return sendJsonError(res, 404, NOT_FOUND_BODY);
    const removed = await context.media.remove(key);
    if (!removed) return sendJsonError(res, 404, NOT_FOUND_BODY);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname.startsWith("/api/")) {
    return sendJsonError(res, 404, NOT_FOUND_BODY);
  }

  if (pathname.startsWith("/media/")) {
    if (method !== "GET" && method !== "HEAD") {
      return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    }
    const rawKey = pathname.slice("/media/".length);
    const key = decodeMediaKey(rawKey);
    if (key === null || !isMediaKey(key)) return sendJsonError(res, 404, NOT_FOUND_BODY);
    const object = await context.media.get(key);
    if (object === "unavailable") {
      return sendJsonError(res, 503, {
        error: "media_unavailable",
        message: "The media library is unavailable.",
      });
    }
    if (object === "missing") return sendJsonError(res, 404, NOT_FOUND_BODY);
    res.writeHead(200, {
      "content-type": object.contentType,
      "content-length": object.body.length,
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=60",
    });
    res.end(object.body);
    return;
  }

  if (pathname.startsWith("/assets/")) {
    if (method !== "GET" && method !== "HEAD") {
      return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    }
    return serveAsset(res, pathname, context);
  }

  if (pathname === "/") {
    if (method !== "GET" && method !== "HEAD") return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    return sendPage(res, 200, renderHome());
  }

  const caseStudy = /^\/work\/([a-z0-9-]+)$/.exec(pathname);
  if (caseStudy) {
    if (method !== "GET" && method !== "HEAD") return sendJsonError(res, 405, METHOD_NOT_ALLOWED_BODY);
    if (PROJECTS_BY_SLUG.has(caseStudy[1])) {
      const links = neighbourLinks(caseStudy[1], url.searchParams.get("category"));
      const html = renderCaseStudy(caseStudy[1], url.searchParams.get("category"));
      const withNeighbours = html
        .replace(
          /<a class="more-projects-link" data-neighbour="previous" href="#">Previous project<\/a>/,
          links.previous
            ? `<a class="more-projects-link" data-neighbour="previous" href="${escAttr(links.previous.href)}">Previous project: ${escText(links.previous.title)}</a>`
            : `<span class="more-projects-link more-projects-none" data-neighbour="previous"></span>`
        )
        .replace(
          /<a class="more-projects-link" data-neighbour="next" href="#">Next project<\/a>/,
          links.next
            ? `<a class="more-projects-link" data-neighbour="next" href="${escAttr(links.next.href)}">Next project: ${escText(links.next.title)}</a>`
            : `<span class="more-projects-link more-projects-none" data-neighbour="next"></span>`
        );
      return sendPage(res, 200, withNeighbours);
    }
    return sendPage(res, 404, renderNotFound());
  }

  return sendPage(res, 404, renderNotFound());
}

function escText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(value: string): string {
  return escText(value).replace(/"/g, "&quot;");
}

async function serveAsset(res: ServerResponse, pathname: string, context: Context): Promise<void> {
  const relative = pathname.slice("/assets/".length);
  const target = normalize(relative);
  if (
    target.startsWith("..") ||
    target.includes("/../") ||
    target.startsWith(".") ||
    target.includes("/.")
  ) {
    return sendPage(res, 404, renderNotFound());
  }
  const path = join(context.assetsRoot, target);
  if (extname(path) === "" || path.length > 260) return sendPage(res, 404, renderNotFound());
  try {
    const info = await stat(path);
    if (!info.isFile()) return sendPage(res, 404, renderNotFound());
    const body = await readFile(path);
    const type = MIME_TYPES[extname(path)] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "content-length": body.length,
      "cache-control": "public, max-age=3600",
    });
    res.end(body);
    return;
  } catch {
    return sendPage(res, 404, renderNotFound());
  }
}

function sendPage(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
  });
  res.end(html);
}

/** Configures and starts the server from the published environment variables. */
export async function startServer(env: Env, assetsRoot: string): Promise<void> {
  const s3Config: S3Config = {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
  const media = new MediaLibrary(s3Config, Number(env.MEDIA_PROBE_SECONDS ?? 5));
  const smtp: SmtpConfig = {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    timeoutSeconds: Number(env.MAIL_TIMEOUT_SECONDS ?? 10),
  };
  const context: Context = {
    media,
    smtp,
    mailFrom: env.MAIL_FROM,
    gradingKey: env.GRADING_KEY ?? null,
    assetsRoot,
  };
  const port = Number(env.APP_PUBLIC_PORT ?? 4173);
  const server = createApp(context);
  server.listen(port, "0.0.0.0");
  void media.start();
  console.log(`quillfern works listening on ${port}`);
}
