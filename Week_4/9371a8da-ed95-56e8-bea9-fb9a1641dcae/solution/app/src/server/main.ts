// The HTTP server: the server boundary, the route table with its error precedence, and the built pages.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";
import { readCitations } from "./citations.ts";
import { awaitDatabase, connectWhenReachable } from "./db.ts";
import { createExport, downloadExport } from "./exports.ts";
import { createFile, deleteFile, readFile as readProjectFile, readProject, readRaw, readRevision, renameFile, saveFile } from "./files.ts";
import { createLabel, readHistory, readLabels, restoreLabel } from "./history.ts";
import { ApiError, errorReply, fail, ok, parseCookies, send, type Context, type JsonBody, type Reply } from "./http.ts";
import { startMentionDelivery } from "./mail.ts";
import {
  acceptInvite,
  createInvite,
  issueShareLink,
  readInvite,
  readInvites,
  readMembers,
  readShareLink,
  removeMember,
  revokeInvite,
  revokeShareLink,
  updateMember,
} from "./members.ts";
import { acceptSuggestion, createComment, createSuggestion, createThread, readReview, rejectSuggestion, resolveThread } from "./review.ts";
import { listProjects, newProject, readMe, readTemplates, signIn, signOut, updateMe } from "./session.ts";
import { readShared, readSharedCitations, readSharedFile, readSharedRaw, readSharedReview, sharedProject } from "./share.ts";
import { uploadFile } from "./uploads.ts";
import { unstorable } from "./validate.ts";

type Handler = (ctx: Context) => Promise<Reply>;

interface Route {
  pattern: string[];
  methods: Partial<Record<string, Handler>>;
  share?: boolean;
  upload?: boolean;
  /** Methods whose Request column lists keys: an empty body there is malformed rather than `{}`. */
  fields?: string[];
}

const route = (pattern: string, methods: Route["methods"], options: Omit<Route, "pattern" | "methods"> = {}): Route => ({
  pattern: pattern.split("/").filter(Boolean),
  methods,
  ...options,
});

const health: Handler = async () => ok({ status: "ok" });

const ROUTES: Route[] = [
  route("/api/health", { GET: health }),
  route("/api/session", { POST: signIn, DELETE: signOut }, { fields: ["POST"] }),
  route("/api/me", { GET: readMe, PATCH: updateMe }, { fields: ["PATCH"] }),
  route("/api/templates", { GET: readTemplates }),
  route("/api/projects", { GET: listProjects, POST: newProject }, { fields: ["POST"] }),
  route("/api/projects/:pid", { GET: readProject }),
  route("/api/projects/:pid/files", { POST: createFile }, { fields: ["POST"] }),
  route("/api/projects/:pid/files/:fid", { GET: readProjectFile, PUT: saveFile, PATCH: renameFile, DELETE: deleteFile }, { fields: ["PUT", "PATCH"] }),
  route("/api/projects/:pid/files/:fid/raw", { GET: readRaw }),
  route("/api/projects/:pid/assets", { POST: uploadFile }, { upload: true }),
  route("/api/projects/:pid/revisions/:n", { GET: readRevision }),
  route("/api/projects/:pid/review", { GET: readReview }),
  route("/api/projects/:pid/files/:fid/suggestions", { POST: createSuggestion }, { fields: ["POST"] }),
  route("/api/projects/:pid/suggestions/:sid/accept", { POST: acceptSuggestion }),
  route("/api/projects/:pid/suggestions/:sid/reject", { POST: rejectSuggestion }),
  route("/api/projects/:pid/files/:fid/threads", { POST: createThread }, { fields: ["POST"] }),
  route("/api/projects/:pid/threads/:tid/comments", { POST: createComment }, { fields: ["POST"] }),
  route("/api/projects/:pid/threads/:tid/resolve", { POST: resolveThread }),
  route("/api/projects/:pid/history", { GET: readHistory }),
  route("/api/projects/:pid/labels", { GET: readLabels, POST: createLabel }, { fields: ["POST"] }),
  route("/api/projects/:pid/labels/:lid", {}),
  route("/api/projects/:pid/labels/:lid/restore", { POST: restoreLabel }),
  route("/api/projects/:pid/citations", { GET: readCitations }),
  route("/api/projects/:pid/exports", { POST: createExport }),
  route("/api/projects/:pid/exports/:eid/download", { GET: downloadExport }),
  route("/api/projects/:pid/members", { GET: readMembers }),
  route("/api/projects/:pid/members/:uid", { PATCH: updateMember, DELETE: removeMember }, { fields: ["PATCH"] }),
  route("/api/projects/:pid/invites", { GET: readInvites, POST: createInvite }, { fields: ["POST"] }),
  route("/api/projects/:pid/invites/:iid/revoke", { POST: revokeInvite }),
  route("/api/invites/:token", { GET: readInvite }),
  route("/api/invites/:token/accept", { POST: acceptInvite }, { fields: ["POST"] }),
  route("/api/projects/:pid/share-link", { GET: readShareLink, POST: issueShareLink, DELETE: revokeShareLink }),
  route("/api/share/:token", { GET: readShared }, { share: true }),
  route("/api/share/:token/files/:fid", { GET: readSharedFile }, { share: true }),
  route("/api/share/:token/files/:fid/raw", { GET: readSharedRaw }, { share: true }),
  route("/api/share/:token/review", { GET: readSharedReview }, { share: true }),
  route("/api/share/:token/citations", { GET: readSharedCitations }, { share: true }),
];

function match(path: string): { route: Route; params: Record<string, string> } | null {
  const segments = path.split("/").filter(Boolean);
  for (const candidate of ROUTES) {
    if (candidate.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const fits = candidate.pattern.every((part, index) => {
      const segment = segments[index] ?? "";
      if (part.startsWith(":")) {
        let value = segment;
        try {
          value = decodeURIComponent(segment);
        } catch {
          value = segment;
        }
        params[part.slice(1)] = unstorable(value) ? "" : value;
        return true;
      }
      return part === segment;
    });
    if (fits) return { route: candidate, params };
  }
  return null;
}

const JSON_CAP = 2_100_000;
const UPLOAD_CAP = 10_100_000;

/** Reads the whole body; anything over the cap answers 413 once the request has arrived. */
function readBody(req: IncomingMessage, cap: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= cap) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > cap ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Server boundary, in order: body size, empty bodies and content type, body parsing, origin. */
async function boundary(req: IncomingMessage, found: Route | undefined): Promise<{ raw: Buffer; body: JsonBody }> {
  const raw = await readBody(req, found?.upload ? UPLOAD_CAP : JSON_CAP);
  if (raw === null) throw fail.tooLarge();
  const type = String(req.headers["content-type"] ?? "").toLowerCase();
  let body: JsonBody = {};
  if (found?.upload) {
    if (raw.length > 0 && !type.startsWith("multipart/form-data")) throw fail.unsupportedMediaType();
  } else if (raw.length === 0) {
    if (found?.fields?.includes(req.method ?? "")) throw fail.malformedJson();
  } else {
    if (!type.startsWith("application/json")) throw fail.unsupportedMediaType();
    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8.decode(raw));
    } catch {
      throw fail.malformedJson();
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw fail.invalid({ body: "Send a JSON object." });
    }
    body = parsed as JsonBody;
  }
  const origin = req.headers.origin;
  if (req.method !== "GET" && req.method !== "HEAD" && origin !== undefined) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.headers.host) throw new ApiError(403, { error: "cross_origin" });
  }
  return { raw, body };
}

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<Reply> {
  const found = match(path);
  if (found?.route.share) res.setHeader("Cache-Control", "no-store");
  const { raw, body } = await boundary(req, found?.route);
  if (!found) throw fail.notFound();
  const handler = found.route.methods[req.method ?? "GET"];
  if (!handler) throw found.route.share ? fail.readOnly() : fail.methodNotAllowed();
  if (handler !== health && !(await awaitDatabase())) throw fail.internal();
  return handler({
    req,
    res,
    method: req.method ?? "GET",
    path,
    params: found.params,
    raw,
    body,
    cookies: parseCookies(req.headers.cookie),
  });
}

const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

const SHELL = Buffer.from(
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Marginalia</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div>' +
    '<script src="/app.js" defer></script></body></html>',
  "utf8",
);
const PAGE_TYPE = "text/html; charset=utf-8";

const PAGES = [/^\/$/, /^\/signin$/, /^\/p\/[^/]+$/, /^\/invite\/[^/]+$/];

async function page(req: IncomingMessage, path: string): Promise<Reply> {
  if (req.method !== "GET" && req.method !== "HEAD") return { status: 405, bytes: Buffer.from("Method not allowed"), contentType: "text/plain" };
  const shared = /^\/s\/([^/]+)$/.exec(path);
  if (shared) {
    const live = (await awaitDatabase()) && (await sharedProject(decodeURIComponent(shared[1] ?? ""))) !== null;
    return { status: live ? 200 : 404, bytes: SHELL, contentType: PAGE_TYPE, headers: { "Cache-Control": "no-store" } };
  }
  if (PAGES.some((pattern) => pattern.test(path))) return { status: 200, bytes: SHELL, contentType: PAGE_TYPE };
  const target = normalize(join(PUBLIC, path));
  const type = TYPES[extname(target)];
  if (type && target.startsWith(`${PUBLIC}/`)) {
    try {
      return { status: 200, bytes: await readFile(target), contentType: type };
    } catch {
      // Not a built asset.
    }
  }
  return { status: 404, bytes: Buffer.from("Not found"), contentType: "text/plain; charset=utf-8" };
}

const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  let reply: Reply;
  try {
    reply = path.startsWith("/api/") ? await api(req, res, path) : await page(req, path);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(`${req.method} ${path}:`, error);
    reply = errorReply(error instanceof ApiError ? error : fail.internal());
  }
  if (!res.headersSent) send(res, reply);
});

server.listen(config.port, "0.0.0.0", () => console.log(`Marginalia listening on 0.0.0.0:${config.port}`));
startMentionDelivery();
void connectWhenReachable();
