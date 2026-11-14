import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type pg from "pg";
import type { Config } from "./config.js";
import { databaseAnswers } from "./db.js";
import type { EnquiryDesk } from "./enquiries.js";
import { FileStoreUnavailable, type FileStore } from "./fileStore.js";
import { GALLERY_SIZE, GLB_TYPE, mediaKey, sceneKey, SVG_TYPE } from "./files.js";
import { renderPage, renderUnavailablePage } from "./pages.js";
import { industryName, matchProjects, sanitiseGalleryFilter, worldsOf, worldYaw } from "../shared/rules.js";
import { isMissing, parseRoute } from "../shared/routes.js";
import type { Bootstrap, Content, Project } from "../shared/types.js";

const MAX_BODY_BYTES = 16_384;
const READ_METHODS = ["GET", "HEAD"];

export interface App {
  config: Config;
  pool: pg.Pool;
  store: FileStore;
  /** Null until Postgres has answered at start. */
  ready: { content: Content; desk: EnquiryDesk; bootstrap: Bootstrap } | null;
}

interface Request {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  head: boolean;
}

type ErrorCode =
  | "not_found"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "too_large"
  | "invalid_json"
  | "file_unavailable"
  | "rate_limited"
  | "unavailable"
  | "internal_error";

const errorStatus: Record<ErrorCode, number> = {
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  too_large: 413,
  invalid_json: 400,
  file_unavailable: 503,
  rate_limited: 429,
  unavailable: 503,
  internal_error: 500,
};

function sendJson(r: Request, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  r.res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  r.res.end(r.head ? undefined : payload);
}

function sendError(r: Request, code: ErrorCode, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): void {
  sendJson(r, errorStatus[code], { error: code, ...extra }, headers);
}

function sendHtml(r: Request, status: number, html: string): void {
  const payload = Buffer.from(html, "utf8");
  r.res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-cache",
  });
  r.res.end(r.head ? undefined : payload);
}

interface Resolved {
  methods: string[];
  run: () => Promise<void> | void;
}

const assetTypes: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

function listAssets(root: URL): Map<string, URL> {
  const assets = new Map<string, URL>();
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
      else if (Object.keys(assetTypes).some((ext) => entry.name.endsWith(ext))) assets.set(`/assets/${prefix}${entry.name}`, new URL(entry.name, dir));
    }
  };
  walk(root, "");
  return assets;
}

export function createHandler(app: App): (req: IncomingMessage, res: ServerResponse) => void {
  const assets = listAssets(new URL("../public/assets/", import.meta.url));

  const jsonArea = (path: string): boolean =>
    path.startsWith("/api/") || path.startsWith("/scenes/") || path.startsWith("/media/");

  const notFound = (r: Request): void => {
    if (jsonArea(r.url.pathname)) return sendError(r, "not_found");
    if (app.ready === null) return sendHtml(r, 503, renderUnavailablePage());
    sendHtml(r, 404, renderPage({ kind: "missing-page" }, r.url.searchParams, app.ready.bootstrap));
  };

  const streamFile = async (r: Request, key: string, type: string): Promise<void> => {
    let object: Response | null;
    try {
      object = await app.store.get(key);
    } catch (error) {
      if (error instanceof FileStoreUnavailable) return sendError(r, "file_unavailable");
      throw error;
    }
    if (object === null || object.body === null) return sendError(r, "not_found");
    const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": "no-cache" };
    const length = object.headers.get("content-length");
    if (length !== null) headers["Content-Length"] = length;
    r.res.writeHead(200, headers);
    if (r.head) {
      await object.body.cancel();
      r.res.end();
      return;
    }
    const stream = Readable.fromWeb(object.body as import("node:stream/web").ReadableStream);
    stream.on("error", () => r.res.destroy());
    stream.pipe(r.res);
  };

  const resolveApi = (r: Request, content: Content, desk: EnquiryDesk): Resolved | null => {
    const path = r.url.pathname;
    const read = (run: () => Promise<void> | void): Resolved => ({ methods: READ_METHODS, run });
    switch (path) {
      case "/api/worlds":
        return read(() => sendJson(r, 200, { items: worldsOf(content).map((w) => worldItem(content, w)) }));
      case "/api/projects":
        return read(() => listProjects(r, content, app.config.workPageSize));
      case "/api/services":
        return read(() => sendJson(r, 200, { items: content.services }));
      case "/api/prices":
        return read(() => sendJson(r, 200, { items: content.prices }));
      case "/api/questions":
        return read(() => sendJson(r, 200, { items: content.questions }));
      case "/api/enquiries":
        return { methods: ["POST"], run: () => postEnquiry(r, desk) };
      case "/api/grading/enquiries":
        if (app.config.gradingKey === null || r.req.headers["x-grading-key"] !== app.config.gradingKey) return null;
        return read(async () =>
          sendJson(r, 200, { enquiries: await desk.listForGrading(r.url.searchParams.get("email") ?? "") }),
        );
    }
    const project = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (project !== null) {
      const index = content.projects.findIndex((p) => p.slug === project[1]);
      if (index === -1) return null;
      return read(() => sendJson(r, 200, projectDetail(content, index)));
    }
    return null;
  };

  const resolve = (r: Request): Resolved | null => {
    const path = r.url.pathname;
    if (path === "/api/health")
      return {
        methods: READ_METHODS,
        run: async () =>
          (await databaseAnswers(app.pool))
            ? sendJson(r, 200, { status: "ok" })
            : sendJson(r, 503, { status: "unavailable" }),
      };
    const asset = assets.get(path);
    if (asset !== undefined)
      return {
        methods: READ_METHODS,
        run: async () => {
          const data = await readFile(asset);
          const type = assetTypes[Object.keys(assetTypes).find((ext) => path.endsWith(ext)) ?? ".js"];
          r.res.writeHead(200, { "Content-Type": type, "Content-Length": String(data.length), "Cache-Control": "no-cache" });
          r.res.end(r.head ? undefined : data);
        },
      };
    if (app.ready === null) return { methods: [r.req.method ?? "GET"], run: () => unavailable(r) };
    const { content, desk, bootstrap } = app.ready;
    if (path.startsWith("/api/")) return resolveApi(r, content, desk);
    const scene = /^\/scenes\/([^/]+)\/world\.glb$/.exec(path);
    if (scene !== null) {
      if (!worldsOf(content).some((w) => w.slug === scene[1])) return null;
      return { methods: READ_METHODS, run: () => streamFile(r, sceneKey(scene[1]), GLB_TYPE) };
    }
    const media = /^\/media\/([^/]+)\/([1-9])\.svg$/.exec(path);
    if (media !== null) {
      const n = Number(media[2]);
      if (n > GALLERY_SIZE || !content.projects.some((p) => p.slug === media[1])) return null;
      return { methods: READ_METHODS, run: () => streamFile(r, mediaKey(media[1], n), SVG_TYPE) };
    }
    if (jsonArea(path)) return null;
    const route = parseRoute(path, content);
    if (route.kind === "missing-page") return null;
    return {
      methods: READ_METHODS,
      run: () => sendHtml(r, isMissing(route) ? 404 : 200, renderPage(route, r.url.searchParams, bootstrap)),
    };
  };

  const unavailable = (r: Request): void => {
    if (jsonArea(r.url.pathname)) return sendError(r, "unavailable");
    sendHtml(r, 503, renderUnavailablePage());
  };

  return (req, res) => {
    const r: Request = { req, res, url: new URL(req.url ?? "/", "http://localhost"), head: req.method === "HEAD" };
    const run = async (): Promise<void> => {
      const resolved = resolve(r);
      if (resolved === null) return notFound(r);
      if (!resolved.methods.includes(req.method ?? "")) {
        return sendError(r, "method_not_allowed", {}, { Allow: resolved.methods.join(", ") });
      }
      await resolved.run();
    };
    run().catch((error: unknown) => {
      console.log(`Request failed: ${req.method} ${r.url.pathname} (${error instanceof Error ? error.name : "unknown error"})`);
      if (res.headersSent) res.destroy();
      else sendError(r, "internal_error");
    });
  };
}

function worldItem(content: Content, world: Project): Record<string, unknown> {
  const index = world.world?.index ?? 0;
  return {
    slug: world.slug,
    name: world.name,
    index,
    industry_id: world.industry_id,
    industry: industryName(content, world.industry_id),
    services: world.services,
    summary: world.world?.summary,
    colours: world.colours,
    display_face: world.display_face,
    yaw: worldYaw(index),
  };
}

function projectItem(content: Content, project: Project): Record<string, unknown> {
  return {
    slug: project.slug,
    name: project.name,
    industry_id: project.industry_id,
    industry: industryName(content, project.industry_id),
    services: project.services,
    world_slug: project.world === null ? null : project.slug,
  };
}

function projectDetail(content: Content, index: number): Record<string, unknown> {
  const project = content.projects[index];
  const count = content.projects.length;
  const previous = content.projects[(index - 1 + count) % count];
  const next = content.projects[(index + 1) % count];
  return {
    ...projectItem(content, project),
    colours: project.colours,
    display_face: project.display_face,
    body_face: project.body_face,
    sections: project.sections,
    gallery: project.captions.map((caption, i) => ({ n: i + 1, caption, src: `/media/${project.slug}/${i + 1}.svg` })),
    deliverables: project.deliverables,
    previous: { slug: previous.slug, name: previous.name },
    next: { slug: next.slug, name: next.name },
  };
}

function wholeNumber(value: string | null, fallback: number, minimum: number): number | null {
  if (value === null) return fallback;
  if (!/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= minimum ? n : null;
}

function listProjects(r: Request, content: Content, pageSize: number): void {
  const params = r.url.searchParams;
  const offset = wholeNumber(params.get("offset"), 0, 0);
  const limit = wholeNumber(params.get("limit"), pageSize, 1);
  const errors: Record<string, string> = {};
  if (offset === null) errors.offset = "Must be a whole number of 0 or more.";
  if (limit === null) errors.limit = "Must be a whole number of 1 or more.";
  if (offset === null || limit === null) return sendJson(r, 422, { errors });
  const filter = sanitiseGalleryFilter(content, (params.get("service") ?? "").split(","), params.get("industry"));
  const matches = matchProjects(content, filter);
  const end = offset + Math.min(limit, pageSize);
  sendJson(r, 200, {
    total: matches.length,
    items: matches.slice(offset, end).map((p) => projectItem(content, p)),
    next_offset: end < matches.length ? end : null,
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer | "too_large"> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > MAX_BODY_BYTES) {
    req.resume();
    return "too_large";
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      return "too_large";
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function postEnquiry(r: Request, desk: EnquiryDesk): Promise<void> {
  const mediaType = (r.req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    r.req.resume();
    return sendError(r, "unsupported_media_type");
  }
  const body = await readBody(r.req);
  if (body === "too_large") return sendError(r, "too_large", {}, { Connection: "close" });
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return sendError(r, "invalid_json");
  }
  const fields = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const outcome = await desk.submit(fields);
  switch (outcome.kind) {
    case "invalid":
      return sendJson(r, 422, { errors: outcome.errors });
    case "rate_limited":
      return sendError(
        r,
        "rate_limited",
        { retry_after_seconds: outcome.retryAfterSeconds },
        { "Retry-After": String(outcome.retryAfterSeconds) },
      );
    case "sent":
      return sendJson(r, 201, { reference: outcome.reference, intake_reference: outcome.intakeReference, status: "sent" });
    case "intake_failed":
      return sendJson(r, 502, { reference: outcome.reference, status: "intake_failed", error: "intake_unavailable" });
  }
}
