import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Config } from "./config";
import { loadCatalog, projectDetail, type Db } from "./db";
import { Enquiries } from "./enquiries";
import { apiError, fieldErrors, methodNotAllowed, unavailable, type ApiReply } from "./errors";
import { FileStoreUnavailable, type FileStore } from "./file-store";
import { listAssets, renderPage, type Asset } from "./pages";
import { BODY_MAX_BYTES } from "../shared/enquiry-rules";
import { pageProjects, parseGalleryQuery, parsePaging, EMPTY_FILTER } from "../shared/gallery";
import { isPublishedPath } from "../shared/routes";
import type { Catalog, Boot } from "../shared/types";

const READ_ONLY = ["GET", "HEAD"];
const MEDIA_COUNT = 4;

type Target =
  | { kind: "api"; path: string; methods: string[] }
  | { kind: "file"; key: string; type: string }
  | { kind: "page" };

export class App {
  private readonly enquiries: Enquiries;
  private readonly assets = listAssets();
  ready = false;

  constructor(private readonly config: Config, private readonly db: Db, private readonly files: FileStore) {
    this.enquiries = new Enquiries(db, config);
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.route(request, response);
    } catch {
      this.sendJson(request, response, unavailable());
    }
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (path === "/api/health") return this.health(request, response);
    if (this.assets.has(path)) {
      if (!READ_ONLY.includes(method)) return this.sendJson(request, response, methodNotAllowed(READ_ONLY));
      return this.sendAsset(request, response, path);
    }
    if (!this.ready) return this.sendJson(request, response, unavailable());
    const catalog = await loadCatalog(this.db);
    const target = this.classify(path, catalog);
    if (!target) return this.notFound(request, response, path, catalog);
    if (target.kind === "api" && path === "/api/grading/enquiries" && !this.hasGradingKey(request)) return this.sendJson(request, response, apiError("not_found"));
    const allowed = target.kind === "api" ? target.methods : READ_ONLY;
    if (!allowed.includes(method)) return this.sendJson(request, response, methodNotAllowed(allowed));
    switch (target.kind) {
      case "api":
        return this.sendJson(request, response, await this.api(request, url, catalog, target.path));
      case "file":
        return this.sendFile(request, response, target.key, target.type);
      case "page":
        return this.sendPage(request, response, path, catalog);
    }
  }

  private classify(path: string, catalog: Catalog): Target | undefined {
    const api: Record<string, string[]> = {
      "/api/worlds": READ_ONLY, "/api/projects": READ_ONLY, "/api/services": READ_ONLY, "/api/prices": READ_ONLY,
      "/api/questions": READ_ONLY, "/api/enquiries": ["POST"], "/api/grading/enquiries": READ_ONLY,
    };
    const methods = api[path];
    if (methods) return { kind: "api", path, methods };
    if (path.startsWith("/api/projects/")) {
      return catalog.projects.some((project) => path === `/api/projects/${project.slug}`) ? { kind: "api", path, methods: READ_ONLY } : undefined;
    }
    const scene = /^\/scenes\/([a-z-]+)\/world\.glb$/.exec(path);
    if (scene && catalog.worlds.some((world) => world.slug === scene[1])) return { kind: "file", key: `scenes/${scene[1]}/world.glb`, type: "model/gltf-binary" };
    const media = /^\/media\/([a-z-]+)\/(\d)\.svg$/.exec(path);
    if (media && catalog.projects.some((project) => project.slug === media[1]) && Number(media[2]) >= 1 && Number(media[2]) <= MEDIA_COUNT) {
      return { kind: "file", key: `media/${media[1]}/${media[2]}.svg`, type: "image/svg+xml" };
    }
    if (isPublishedPath(path, catalog)) return { kind: "page" };
    return undefined;
  }

  private async health(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!READ_ONLY.includes(request.method ?? "GET")) return this.sendJson(request, response, methodNotAllowed(READ_ONLY));
    const answered = await this.db.query("SELECT 1").then(() => true, () => false);
    this.sendJson(request, response, answered ? { status: 200, body: { status: "ok" } } : unavailable());
  }

  private hasGradingKey(request: IncomingMessage): boolean {
    const sent = request.headers["x-grading-key"];
    if (typeof sent !== "string" || this.config.gradingKey === undefined) return false;
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(sent), digest(this.config.gradingKey));
  }

  private async api(request: IncomingMessage, url: URL, catalog: Catalog, path: string): Promise<ApiReply> {
    switch (path) {
      case "/api/worlds":
        return { status: 200, body: { items: catalog.worlds.map(({ slug, name, index, industry_id, industry, services, summary, colours, display_face, yaw }) => ({ slug, name, index, industry_id, industry, services, summary, colours, display_face, yaw })) } };
      case "/api/projects":
        return this.projects(url, catalog);
      case "/api/services":
        return { status: 200, body: { items: catalog.services } };
      case "/api/prices":
        return { status: 200, body: { items: catalog.prices } };
      case "/api/questions":
        return { status: 200, body: { items: catalog.questions } };
      case "/api/enquiries":
        return this.postEnquiry(request, catalog);
      case "/api/grading/enquiries":
        return { status: 200, body: { enquiries: await this.enquiries.stored(url.searchParams.get("email") ?? "") } };
      default: {
        const detail = projectDetail(catalog, path.slice("/api/projects/".length));
        return detail ? { status: 200, body: detail } : apiError("not_found");
      }
    }
  }

  private projects(url: URL, catalog: Catalog): ApiReply {
    const paging = parsePaging(url.searchParams.get("offset"), url.searchParams.get("limit"));
    if ("errors" in paging) return fieldErrors(paging.errors);
    const { filter } = parseGalleryQuery(url.search, catalog.services, catalog.industries);
    const limit = Math.min(paging.limit ?? this.config.workPageSize, this.config.workPageSize);
    return { status: 200, body: pageProjects(catalog.projects, filter, paging.offset, limit) };
  }

  private async postEnquiry(request: IncomingMessage, catalog: Catalog): Promise<ApiReply> {
    const mediaType = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      request.resume();
      return apiError("unsupported_media_type");
    }
    const body = await readBody(request);
    if (body === undefined) return apiError("too_large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      return apiError("invalid_json");
    }
    const fields = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return this.enquiries.submit(fields, catalog);
  }

  private async sendFile(request: IncomingMessage, response: ServerResponse, key: string, type: string): Promise<void> {
    try {
      const file = await this.files.open(key);
      if (!file) return this.sendJson(request, response, apiError("not_found"));
      const headers: Record<string, string | number> = { "Content-Type": type, "Cache-Control": "public, max-age=300" };
      if (file.size !== null) headers["Content-Length"] = file.size;
      response.writeHead(200, headers);
      if (request.method === "HEAD") {
        await file.body.cancel();
        response.end();
        return;
      }
      const stream = Readable.fromWeb(file.body as import("node:stream/web").ReadableStream);
      response.on("close", () => stream.destroy());
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (error instanceof FileStoreUnavailable) return this.sendJson(request, response, apiError("file_unavailable"));
      throw error;
    }
  }

  private sendAsset(request: IncomingMessage, response: ServerResponse, path: string): void {
    const asset = this.assets.get(path) as Asset;
    const body = readFileSync(asset.path);
    response.writeHead(200, { "Content-Type": asset.type, "Content-Length": body.length, "Cache-Control": asset.cache });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  private sendPage(request: IncomingMessage, response: ServerResponse, path: string, catalog: Catalog): void {
    const boot: Boot = {
      catalog,
      firstPage: pageProjects(catalog.projects, EMPTY_FILTER, 0, this.config.workPageSize),
      enquiryLimit: this.config.enquiryLimit,
      enquiryWindowSeconds: this.config.enquiryWindowSeconds,
    };
    const page = renderPage(path, boot);
    const body = Buffer.from(page.html);
    response.writeHead(page.status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  private notFound(request: IncomingMessage, response: ServerResponse, path: string, catalog: Catalog): void {
    const machine = ["/api/", "/scenes/", "/media/"].some((prefix) => path.startsWith(prefix)) || path === "/api";
    if (machine) return this.sendJson(request, response, apiError("not_found"));
    if (!READ_ONLY.includes(request.method ?? "GET")) return this.sendJson(request, response, apiError("not_found"));
    this.sendPage(request, response, path, catalog);
  }

  private sendJson(request: IncomingMessage, response: ServerResponse, reply: ApiReply): void {
    const body = Buffer.from(JSON.stringify(reply.body));
    response.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, ...reply.headers });
    response.end(request.method === "HEAD" ? undefined : body);
  }
}

/** The request body, or undefined when it is larger than the published limit. */
async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= BODY_MAX_BYTES) chunks.push(chunk);
  }
  return size > BODY_MAX_BYTES ? undefined : Buffer.concat(chunks);
}
