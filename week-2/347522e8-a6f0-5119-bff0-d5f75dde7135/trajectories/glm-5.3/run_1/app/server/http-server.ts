import * as http from "node:http";
import { ApiError } from "./errors.js";
import { json, matchRoute, pathMatches, type RouteContext } from "./router.js";
import { userForSession } from "./users.js";
import { withTx } from "./db.js";
import { originAllowed, readBody, requestOriginHost, requestProto, sessionCookieOf } from "./http.js";
import { serveStatic, startHttpServer } from "./static.js";


const JSON_LIMIT = 65536;
const MULTIPART_LIMIT = 5100000;
const NEVER_SERVED: { match: (path: string) => boolean }[] = [
  { match: (p) => p === "/package.json" },
  { match: (p) => p === "/package-lock.json" },
  { match: (p) => p === "/run.json" },
  { match: (p) => p === "/tsconfig.json" },
  { match: (p) => p === "/THIRD_PARTY_NOTICES.md" },
  { match: (p) => p.startsWith("/server/") },
  { match: (p) => p.startsWith("/client/") },
  { match: (p) => p.startsWith("/shared/") },
  { match: (p) => p.startsWith("/scripts/") },
  { match: (p) => p.startsWith("/node_modules/") },
  { match: (p) => p.startsWith("/.env") },
  { match: (p) => p.endsWith(".ts") },
  { match: (p) => p.endsWith(".map") },
];

const isSharePath = (path: string): boolean => path === "/api/share" || path.startsWith("/api/share/");

const lowerHeaders = (headers: http.IncomingHttpHeaders): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") result[key.toLowerCase()] = value;
    else if (Array.isArray(value)) result[key.toLowerCase()] = value.join(", ");
  }
  return result;
};

export const handleRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> => {
  try {
    await dispatch(req, res);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const body = err instanceof ApiError ? err.body : { error: "internal" };
    if (!res.headersSent) {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    } else {
      res.end();
    }
  }
};

const dispatch = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
  const headers = lowerHeaders(req.headers);
  const host = requestOriginHost(headers) ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (NEVER_SERVED.some((rule) => rule.match(path))) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (path.startsWith("/api/")) {
    await handleApi(req, res, url, headers, method, host);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  serveStatic(path, res);
};

const handleApi = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  headers: Record<string, string>,
  method: string,
  host: string,
): Promise<void> => {
  const path = url.pathname;
  const contentType = headers["content-type"] ?? "";
  const isMultipart = contentType.startsWith("multipart/form-data");
  const limit = isMultipart ? MULTIPART_LIMIT : JSON_LIMIT;

  let body: Buffer | null = null;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await readBody(req, limit);
    } catch (err) {
      if (err instanceof ApiError) {
        res.writeHead(err.status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(err.body));
        return;
      }
      throw err;
    }
  }

  // Same-origin writes: a state-changing request with a foreign Origin fails.
  if (method !== "GET" && method !== "HEAD" && headers["origin"]) {
    if (!originAllowed(headers["origin"], host, requestProto(headers))) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "cross_origin" }));
      return;
    }
  }

  // Every non-GET on a share path is read-only, whatever the token.
  if (isSharePath(path) && method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "read_only" }));
    return;
  }

  const matched = matchRoute(method, path);
  if (!matched) {
    if (pathMatches(path)) {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (!isMultipart && body !== null && body.length > 0 && !contentType.startsWith("application/json")) {
    res.writeHead(415, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "unsupported_media_type" }));
    return;
  }

  const cookies = sessionCookieOf(headers["cookie"]);
  const token = cookies["rs_session"] ?? null;

  const send = (response: Response): void => {
    const headersOut: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersOut[key] = value;
    });
    if (!res.headersSent) res.writeHead(response.status, headersOut);
    if (response.body) {
      void response.arrayBuffer().then((buffer: ArrayBuffer) => {
        res.end(Buffer.from(buffer));
      });
    } else {
      res.end();
    }
  };

  let response: Response | null = null;
  let txError: unknown = null;
  await withTx(async (tx) => {
    try {
      const user = await userForSession(tx, token);
      const ctx: RouteContext = {
        req: { method, url, headers, body, cookies, remoteAddress: req.socket.remoteAddress ?? "" },
        url,
        user,
        db: tx,
        now: new Date(),
      };
      response = await matched.route.handler(ctx);
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("route error:", err);
      txError = err;
    }
  }).catch((err: unknown) => {
    if (!(err instanceof ApiError)) console.error("tx error:", err);
    txError = err;
  });


  if (txError !== null) {
    throw txError;
  }
  send(response ?? json({ error: "not_found" }, 404));
};

export { startHttpServer };
