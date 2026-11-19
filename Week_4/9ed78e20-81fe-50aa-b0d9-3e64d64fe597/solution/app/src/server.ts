import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Busboy from "busboy";
import { config } from "./config.js";
import { schema } from "./db.js";
import { seed } from "./seed.js";
import {
  ApiError,
  fail,
  notFound,
  publicNotFound,
  object,
  str,
  forbidden,
} from "./errors.js";
import { requireStaff, signIn, signOut, sessionCookie } from "./auth.js";
import {
  homeData,
  modelsData,
  modelData,
  newsroomData,
  newsData,
  rolesData,
  roleData,
  benefitsData,
  feed,
  sitemap,
  parseAsOf,
  publicContent,
} from "./public.js";
import { searchData } from "./search.js";
import { contentApi, type ApiResult } from "./content.js";
import {
  careersApi,
  submitApplication,
  tracking,
  resendLinks,
  type Multipart,
} from "./careers.js";
import { governanceApi } from "./governance.js";
import { storage, sampleDefinitions, sampleRoute } from "./media.js";
import { startJobs } from "./jobs.js";
import { readiness } from "./probes.js";
import {
  countRequest,
  idempotent,
  fingerprint,
  type Bucket,
} from "./limits.js";
import type { Staff } from "./types.js";
const root = resolve(".");
const consoleRoutes: [RegExp, string[]][] = [
  [/^\/api\/console\/session$/, ["POST", "DELETE"]],
  [/^\/api\/console\/me$/, ["GET"]],
  [/^\/api\/console\/grants$/, ["GET", "POST"]],
  [/^\/api\/console\/grants\/[^/]+\/revoke$/, ["POST"]],
  [/^\/api\/console\/audit$/, ["GET"]],
  [/^\/api\/console\/audit\/verify$/, ["GET"]],
  [/^\/api\/console\/audit\/[^/]+$/, ["PUT", "PATCH", "DELETE"]],
  [/^\/api\/console\/jobs$/, ["GET"]],
  [/^\/api\/console\/jobs\/[^/]+\/retry$/, ["POST"]],
  [/^\/api\/console\/content$/, ["GET", "POST"]],
  [/^\/api\/console\/content\/[^/]+$/, ["GET", "PATCH"]],
  [
    /^\/api\/console\/content\/[^/]+\/(submit|comments|approve|return|schedule|release|withdraw)$/,
    ["POST"],
  ],
  [/^\/api\/console\/content\/[^/]+\/release-record$/, ["GET"]],
  [
    /^\/api\/console\/content\/[^/]+\/release-record\/(signoffs|validate-claims|clear)$/,
    ["POST"],
  ],
  [/^\/api\/console\/benchmark-rows$/, ["GET", "POST"]],
  [/^\/api\/console\/benchmark-rows\/[^/]+$/, ["PATCH", "DELETE"]],
  [/^\/api\/console\/requisitions$/, ["GET", "POST"]],
  [/^\/api\/console\/requisitions\/[^/]+$/, ["GET"]],
  [/^\/api\/console\/requisitions\/[^/]+\/(open|close)$/, ["POST"]],
  [/^\/api\/console\/requisitions\/[^/]+\/applications$/, ["GET"]],
  [/^\/api\/console\/applications\/[^/]+$/, ["GET"]],
  [/^\/api\/console\/applications\/[^/]+\/resume$/, ["GET"]],
  [
    /^\/api\/console\/applications\/[^/]+\/(stage|notes|tracking-link\/reissue)$/,
    ["POST"],
  ],
  [/^\/api\/console\/benefits$/, ["POST"]],
];
function consoleMethod(path: string, method: string): void {
  const route = consoleRoutes.find(([pattern]) => pattern.test(path));
  if (!route) notFound();
  if (!route[1].includes(method))
    fail(405, "method_not_allowed", "This method is not allowed.");
}
const applicationPath = /^\/api\/careers\/roles\/([^/]+)\/applications$/;
const writes = ["POST", "PATCH", "PUT", "DELETE"];
async function bodyBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(req.headers["content-length"] || 0) > limit)
    fail(413, "payload_too_large", "That request is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit)
      fail(413, "payload_too_large", "That request is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
async function parseMultipart(
  req: IncomingMessage,
  buffer: Buffer,
): Promise<Multipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let resume: Buffer | undefined;
    const unreadable = (): void =>
      reject(
        new ApiError(400, "invalid_request", "The form could not be read."),
      );
    try {
      const parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 10 },
      });
      parser.on("field", (key, value) => {
        fields[key] = value;
      });
      parser.on("file", (key, stream) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          if (key === "resume") resume = Buffer.concat(chunks);
        });
      });
      parser.on("error", unreadable);
      parser.on("close", () => resolve({ fields, resume }));
      parser.end(buffer);
    } catch {
      unreadable();
    }
  });
}
function send(res: ServerResponse, result: ApiResult): void {
  res.statusCode = result.status;
  if (result.version !== undefined)
    res.setHeader("ETag", `"${result.version}"`);
  for (const [key, value] of Object.entries(result.headers || {}))
    res.setHeader(key, value);
  if (result.status === 204) {
    res.end();
    return;
  }
  if (Buffer.isBuffer(result.data)) {
    res.end(result.data);
    return;
  }
  if (typeof result.data === "string" && res.hasHeader("Content-Type")) {
    res.end(result.data);
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result.data));
}
const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};
function client(req: IncomingMessage): string {
  const forwarded = header(req, "x-forwarded-for");
  if (config.trustForwardedFor && forwarded)
    return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}
// Which rate-limit bucket counts a request, if any.
function bucketFor(path: string, method: string): Bucket | null {
  if (path === "/api/health" || path === "/api/ready") return null;
  if (
    path === "/style.css" ||
    path === "/browser.js" ||
    path.startsWith("/fonts/")
  )
    return null;
  if (
    method === "POST" &&
    (path === "/api/console/session" || path === "/console/sign-in")
  )
    return "signin";
  if (path.startsWith("/api/console/"))
    return writes.includes(method) ? "console" : null;
  if (path.startsWith("/console")) return null;
  if (
    path.startsWith("/api/track/") ||
    path === "/api/careers/tracking-links" ||
    applicationPath.test(path) ||
    (method === "POST" &&
      (path.startsWith("/careers") || path.startsWith("/track/")))
  )
    return "candidate";
  return "public";
}
async function publicApi(
  path: string,
  query: URLSearchParams,
): Promise<unknown> {
  const asOf = (): string | null => parseAsOf(query.get("as_of"));
  const slug = (prefix: string): string =>
    decodeURIComponent(path.slice(prefix.length));
  if (path === "/api/public/home") return homeData();
  if (path === "/api/public/models") return modelsData(asOf());
  if (path.startsWith("/api/public/models/"))
    return modelData(slug("/api/public/models/"), asOf());
  if (path === "/api/public/news") return newsroomData(query);
  if (path.startsWith("/api/public/news/"))
    return newsData(slug("/api/public/news/"), asOf());
  if (path === "/api/public/search") return searchData(query);
  if (path === "/api/public/roles") return rolesData(query);
  if (path.startsWith("/api/public/roles/"))
    return roleData(slug("/api/public/roles/"));
  if (path === "/api/public/benefits") return benefitsData();
  return publicNotFound();
}
async function consoleApi(
  req: IncomingMessage,
  url: URL,
  body: Record<string, unknown>,
  staff: Staff,
): Promise<ApiResult> {
  const path = url.pathname,
    method = req.method || "GET";
  consoleMethod(path, method);
  if (path === "/api/console/me") return { status: 200, data: staff };
  if (path === "/api/console/session") {
    await signOut(req);
    return {
      status: 204,
      data: null,
      headers: { "Set-Cookie": sessionCookie("", 0) },
    };
  }
  if (!staff.roles.length) forbidden();
  const ctx = {
    method,
    path,
    query: url.searchParams,
    body,
    staff,
    version: header(req, "if-match"),
  };
  const result =
    (await contentApi(ctx)) ||
    (await careersApi(ctx)) ||
    (await governanceApi(ctx));
  return result || notFound();
}
async function api(
  req: IncomingMessage,
  url: URL,
  body: Record<string, unknown>,
  multipart: Multipart | undefined,
  staff: Staff | null,
): Promise<ApiResult> {
  const path = url.pathname,
    method = req.method || "GET";
  if (path === "/api/health" && method === "GET")
    return { status: 200, data: { status: "ok" } };
  if (path === "/api/ready" && method === "GET") {
    const ready = await readiness();
    return { status: ready.status, data: ready.body };
  }
  if (path.startsWith("/api/public/") && method === "GET")
    return { status: 200, data: await publicApi(path, url.searchParams) };
  const track = path.match(/^\/api\/track\/([^/]+)(\/withdraw)?$/);
  if (track && method === (track[2] ? "POST" : "GET"))
    return { status: 200, data: await tracking(track[1], !!track[2]) };
  const application = path.match(applicationPath);
  if (application && method === "POST") {
    const slug = decodeURIComponent(application[1]);
    const form = multipart!;
    const resumeDigest = form.resume
      ? createHash("sha256").update(form.resume).digest("hex")
      : null;
    return idempotent(
      `role:${slug}`,
      header(req, "idempotency-key"),
      fingerprint(method, path, { fields: form.fields, resume: resumeDigest }),
      () => submitApplication(slug, form),
    );
  }
  if (path === "/api/careers/tracking-links" && method === "POST")
    return resendLinks(str(body.email));
  if (path === "/api/console/session" && method === "POST") {
    const signed = await signIn(body);
    return {
      status: 200,
      data: { staff: signed.staff },
      headers: { "Set-Cookie": sessionCookie(signed.token, config.sessionTtl) },
    };
  }
  if (path.startsWith("/api/console/")) {
    const signed = staff || (await requireStaff(req));
    if (writes.includes(method) && path !== "/api/console/session")
      return idempotent(
        `staff:${signed.email}`,
        header(req, "idempotency-key"),
        fingerprint(method, path, body),
        () => consoleApi(req, url, body, signed),
      );
    return consoleApi(req, url, body, signed);
  }
  return publicNotFound();
}
async function sample(path: string): Promise<ApiResult> {
  if (!sampleDefinitions.some((s) => s.urls.includes(path))) publicNotFound();
  await publicContent("model", sampleRoute);
  let response: Response;
  try {
    response = await storage("GET", path.replace("/media/", ""));
  } catch {
    fail(503, "storage_unavailable", "Samples are unavailable right now.");
  }
  if (response.status === 404) publicNotFound();
  if (!response.ok)
    fail(503, "storage_unavailable", "Samples are unavailable right now.");
  return {
    status: 200,
    data: Buffer.from(await response.arrayBuffer()),
    headers: {
      "Content-Type":
        response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  };
}
async function asset(path: string): Promise<ApiResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(
      resolve(
        root,
        "public",
        path === "/browser.js" ? "dist/browser.js" : "." + path,
      ),
    );
  } catch {
    publicNotFound();
  }
  return {
    status: 200,
    data: bytes,
    headers: {
      "Content-Type": path.endsWith(".css")
        ? "text/css; charset=utf-8"
        : path.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "font/woff2",
      "Cache-Control": "public, max-age=86400",
    },
  };
}
// Reads the body within its size limit and checks its declared type.
async function readBody(
  req: IncomingMessage,
  path: string,
  isApi: boolean,
): Promise<{ body: Record<string, unknown>; multipart?: Multipart }> {
  const mediaType = (header(req, "content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const multipartPath =
    applicationPath.test(path) || /^\/careers\/[^/]+$/.test(path);
  const bytes = await bodyBytes(
    req,
    mediaType === "multipart/form-data" ? 6000000 : 100000,
  );
  if (multipartPath && (isApi || mediaType === "multipart/form-data")) {
    if (mediaType !== "multipart/form-data")
      fail(
        415,
        "unsupported_media_type",
        "Send this request as a multipart form.",
      );
    return { body: {}, multipart: await parseMultipart(req, bytes) };
  }
  if (!isApi && mediaType === "application/x-www-form-urlencoded")
    return { body: Object.fromEntries(new URLSearchParams(bytes.toString())) };
  if (!bytes.length) return { body: {} };
  if (mediaType !== "application/json")
    fail(415, "unsupported_media_type", "Send this request as JSON.");
  try {
    return { body: object(JSON.parse(bytes.toString())) };
  } catch {
    return fail(400, "invalid_request", "The JSON could not be read.");
  }
}
const neverServed =
  /^\/(?:src|node_modules|\.env|\.git|package|run\.json|assets\.json|tsconfig|THIRD_PARTY|USER_README|dist|public)/i;
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-cache");
  const raw = req.url || "/";
  const method = req.method || "GET";
  let url: URL;
  try {
    url = new URL(raw, `http://${req.headers.host || "localhost"}`);
  } catch {
    send(res, {
      status: 400,
      data: new ApiError(
        400,
        "invalid_request",
        "The request address could not be read.",
      ).toJSON(),
    });
    return;
  }
  const path = url.pathname;
  const isApi = path.startsWith("/api/");
  if (path.startsWith("/track/") || path.startsWith("/api/track/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
  }
  try {
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(raw.split("?")[0]);
    } catch {
      fail(400, "invalid_request", "The request address could not be read.");
    }
    if (
      decodedPath.includes("..") ||
      decodedPath.includes("\0") ||
      neverServed.test(decodedPath)
    )
      path.startsWith("/api/track/")
        ? fail(404, "not_found", "This tracking link is not valid.")
        : publicNotFound();
    // PostgreSQL text cannot hold NUL, so a stray NUL in a search or facet is dropped as input noise.
    for (const [name, value] of [...url.searchParams])
      if (value.includes("\0"))
        url.searchParams.set(name, value.replaceAll("\0", ""));
    let body: Record<string, unknown> = {},
      multipart: Multipart | undefined;
    if (!["GET", "HEAD"].includes(method)) {
      ({ body, multipart } = await readBody(req, path, isApi));
      const origin = header(req, "origin");
      if (
        (path.startsWith("/api/console/") || path.startsWith("/console")) &&
        origin &&
        origin !== url.origin
      )
        fail(403, "cross_origin", "Requests must come from this site.");
    }
    const bucket = bucketFor(path, method);
    let staff: Staff | null = null;
    if (bucket === "console") staff = await requireStaff(req);
    if (bucket)
      for (const [key, value] of Object.entries(
        await countRequest(bucket, staff ? staff.email : client(req)),
      ))
        res.setHeader(key, value);
    if (isApi) {
      send(res, await api(req, url, body, multipart, staff));
      return;
    }
    if (path === "/feed.xml" || path === "/sitemap.xml") {
      send(res, {
        status: 200,
        data: path === "/feed.xml" ? await feed() : await sitemap(),
        headers: {
          "Content-Type":
            path === "/feed.xml"
              ? "application/atom+xml; charset=utf-8"
              : "application/xml; charset=utf-8",
        },
      });
      return;
    }
    if (path.startsWith("/media/samples/")) {
      send(res, await sample(path));
      return;
    }
    if (
      path === "/style.css" ||
      path === "/browser.js" ||
      /^\/fonts\/[a-z0-9-]+\.woff2$/.test(path)
    ) {
      send(res, await asset(path));
      return;
    }
    const { htmlRoute } = await import("./pages.js");
    send(res, await htmlRoute(req, url, body, multipart));
  } catch (error) {
    const e =
      error instanceof ApiError
        ? error
        : new ApiError(
            500,
            "server_error",
            "We could not complete that request.",
          );
    if (!(error instanceof ApiError)) console.error(error);
    for (const [key, value] of Object.entries(e.headers || {}))
      res.setHeader(key, value);
    if (isApi || path.startsWith("/media/") || path.endsWith(".xml"))
      send(res, { status: e.status, data: e.toJSON() });
    else {
      const { errorPage } = await import("./pages.js");
      send(res, await errorPage(path, e));
    }
  }
}
async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await schema();
      await seed();
      return;
    } catch (error) {
      console.error(
        "Database not ready; retrying in 2 seconds",
        error instanceof Error ? error.message : "",
      );
      await new Promise((done) => setTimeout(done, 2000));
    }
  }
}
await prepareDatabase();
const stopJobs = await startJobs();
const server = createServer((req, res) => void handle(req, res));
server.listen(config.port, "0.0.0.0", () =>
  console.log(`Open Record listening on ${config.port}`),
);
process.on("SIGTERM", () => {
  stopJobs();
  server.close(() => process.exit(0));
});
