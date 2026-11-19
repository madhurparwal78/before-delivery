import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_TYPES } from "../shared/copy.js";
import { isCategory } from "../shared/rules.js";
import type { EnquiryAnswer } from "../shared/types.js";
import { gotenbergAnswers, renderBrief } from "./brief.js";
import { config } from "./config.js";
import { isObject, loadContent, parseContent, replaceContent, restoreStartingContent } from "./content.js";
import { pool } from "./db.js";
import { findByToken, listEnquiries, submitEnquiry } from "./enquiries.js";
import { mailServerAnswers } from "./mail.js";
import { briefUnavailablePage, casePage, homePage, notFoundPage, privacyPage } from "./pages.js";

const BODY_LIMIT = 262_144;
const PUBLIC_ROOT = fileURLToPath(new URL("../../public/", import.meta.url));
const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

const NOT_FOUND = { error: "not_found", message: "Not found." };
const METHOD_NOT_ALLOWED = { error: "method_not_allowed", message: "Method not allowed." };
const TOO_LARGE = { error: "too_large", message: "The request body is too large." };
const BAD_REQUEST = { error: "bad_request", message: "The request body must be JSON." };
const SHAPE = { error: "invalid", message: "The content does not match the published shape." };
const UNAVAILABLE = { error: "unavailable", message: "The enquiry could not be saved." };

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

const INTERNAL = { error: "internal_error", message: "Something went wrong." };

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}

type Body = { tooLarge: true } | { tooLarge: false; raw: string };

function readBody(req: http.IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > BODY_LIMIT ? { tooLarge: true } : { tooLarge: false, raw: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", reject);
  });
}

/** Reads the JSON body, answering 413 or 400 itself; undefined when it did. */
async function readJson(req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown> {
  const body = await readBody(req);
  if (body.tooLarge) return sendJson(res, 413, TOO_LARGE);
  try {
    return JSON.parse(body.raw);
  } catch {
    return sendJson(res, 400, BAD_REQUEST);
  }
}

const withTimeout = <T>(work: Promise<T>, fallback: T, ms: number): Promise<T> =>
  Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

async function health(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const database = withTimeout(pool.query("SELECT 1").then(() => true, () => false), false, 2000);
  const answers = await Promise.all([database, mailServerAnswers(), gotenbergAnswers()]);
  sendJson(res, 200, { status: answers.every(Boolean) ? "ok" : "unavailable" });
}

async function postEnquiry(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJson(req, res);
  if (body === undefined) return;
  const outcome = await submitEnquiry(isObject(body) ? body : {});
  if (outcome.kind === "invalid") return sendJson(res, 422, { error: "invalid", fields: outcome.errors });
  if (outcome.kind === "unavailable") return sendJson(res, 503, UNAVAILABLE);
  const answer: EnquiryAnswer = outcome.answer;
  sendJson(res, outcome.created ? 201 : 200, answer);
}

async function putContent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJson(req, res);
  if (body === undefined) return;
  const content = parseContent(body);
  if (content === null) return sendJson(res, 422, SHAPE);
  sendJson(res, 200, { edition: await replaceContent(content) });
}

async function deleteContent(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  sendJson(res, 200, { edition: await restoreStartingContent() });
}

async function getEnquiries(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  sendJson(res, 200, { enquiries: await listEnquiries() });
}

const API: Record<string, { methods: Record<string, Handler>; grading: boolean }> = {
  "/api/health": { methods: { GET: health }, grading: false },
  "/api/enquiries": { methods: { POST: postEnquiry }, grading: false },
  "/api/grading/content": { methods: { PUT: putContent, DELETE: deleteContent }, grading: true },
  "/api/grading/enquiries": { methods: { GET: getEnquiries }, grading: true },
};

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const route = API[url.pathname];
  if (route === undefined || (route.grading && config.gradingKey === undefined)) return sendJson(res, 404, NOT_FOUND);
  const handler = route.methods[req.method ?? ""];
  if (handler === undefined) return sendJson(res, 405, METHOD_NOT_ALLOWED);
  if (route.grading && req.headers["x-grading-key"] !== config.gradingKey) return sendJson(res, 404, NOT_FOUND);
  await handler(req, res);
}

async function asset(res: http.ServerResponse, pathname: string): Promise<boolean> {
  const file = path.normalize(path.join(PUBLIC_ROOT, pathname.slice("/assets/".length)));
  const type = MIME[path.extname(file)];
  if (!file.startsWith(PUBLIC_ROOT) || type === undefined) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": type, "Content-Length": data.length, "Cache-Control": "no-cache" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function brief(res: http.ServerResponse, token: string): Promise<void> {
  const enquiry = await findByToken(token);
  if (enquiry === undefined) return sendHtml(res, 404, notFoundPage("page"));
  const pdf = await renderBrief(enquiry);
  if (pdf === null) return sendHtml(res, 503, briefUnavailablePage(enquiry.reference));
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${enquiry.reference}-brief.pdf"`,
    "Content-Length": pdf.length,
  });
  res.end(pdf);
}

function decodePathPart(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

async function page(res: http.ServerResponse, url: URL): Promise<void> {
  const { pathname, searchParams } = url;
  if (pathname === "/") {
    const service = searchParams.get("service");
    const category = searchParams.get("category");
    const type = searchParams.get("type");
    return sendHtml(res, 200, homePage(await loadContent(), {
      category: isCategory(category) ? category : null,
      service: isCategory(service) ? service : null,
      type: PROJECT_TYPES.find((item) => item.id === type)?.id ?? null,
    }));
  }
  if (pathname === "/privacy") return sendHtml(res, 200, privacyPage());
  const slug = /^\/work\/([^/]+)$/.exec(pathname)?.[1];
  if (slug !== undefined) {
    const content = await loadContent();
    const project = content.projects.find((item) => item.slug === decodePathPart(slug));
    if (project === undefined) return sendHtml(res, 404, notFoundPage("project"));
    const category = searchParams.get("category");
    return sendHtml(res, 200, casePage(project, content, isCategory(category) ? category : null));
  }
  const token = /^\/briefs\/([0-9a-f]{32})\.pdf$/.exec(pathname)?.[1];
  if (token !== undefined) return brief(res, token);
  sendHtml(res, 404, notFoundPage("page"));
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const run = async (): Promise<void> => {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return api(req, res, url);
      const readable = req.method === "GET" || req.method === "HEAD";
      if (readable && url.pathname.startsWith("/assets/") && (await asset(res, url.pathname))) return;
      if (!readable) return sendHtml(res, 404, notFoundPage("page"));
      return page(res, url);
    };
    run().catch(() => {
      if (res.headersSent) return void res.end();
      if (url.pathname.startsWith("/api/")) return sendJson(res, 500, INTERNAL);
      res.writeHead(500);
      res.end();
    });
    req.resume();
  });
}
