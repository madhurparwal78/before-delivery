import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { ApiError, crossOrigin, json, notFound, parseCookies, readBody, sendJson, type Reply, type Request } from "./http";
import { config } from "./config";
import { pool } from "./db";
import { current } from "./services/status";
import { servePage } from "./static";
import * as attachments from "./routes/attachments";
import * as auth from "./routes/auth";
import * as boards from "./routes/boards";
import * as grading from "./routes/grading";
import * as links from "./routes/links";
import * as members from "./routes/members";
import * as posts from "./routes/posts";
import * as reactions from "./routes/reactions";

type Handler = (request: Request) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  multipart: boolean;
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler, multipart = false): void {
  const names: string[] = [];
  const pattern = path.replace(/:(\w+)/g, (_match, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${pattern}$`), names, multipart, handler });
}

async function health(): Promise<Reply> {
  await pool.query("SELECT 1");
  const services = current();
  return json(200, { status: services.storage && services.mail && services.push ? "ok" : "unavailable" });
}

route("GET", "/api/health", health);
route("POST", "/api/grading/fixture", grading.create);

route("POST", "/api/auth/signup", auth.signUp);
route("POST", "/api/auth/verify", auth.verify);
route("POST", "/api/auth/signin", auth.signIn);
route("POST", "/api/auth/signout", auth.signOut);
route("GET", "/api/me", auth.me);

route("GET", "/api/boards", boards.list);
route("POST", "/api/boards", boards.create);
route("GET", "/api/boards/:id", boards.get);
route("PATCH", "/api/boards/:id", boards.update);
route("DELETE", "/api/boards/:id", boards.remove);
route("POST", "/api/boards/:id/rotate-link", boards.rotateLink);
route("POST", "/api/boards/:id/unlock", boards.unlockBoard);
route("GET", "/api/boards/:id/posts", boards.posts);
route("GET", "/api/boards/:id/events", boards.events);
route("GET", "/api/boards/:id/export.csv", boards.exportCsv);

route("GET", "/api/boards/:id/members", members.list);
route("PATCH", "/api/boards/:id/members/:userId", members.changeRole);
route("DELETE", "/api/boards/:id/members/:userId", members.remove);
route("POST", "/api/boards/:id/invites", members.invite);
route("GET", "/api/invites/:token", members.inviteInfo);
route("POST", "/api/invites/:token/accept", members.accept);

route("GET", "/api/links/:token", links.read);
route("POST", "/api/links/:token/unlock", links.unlockLink);
route("GET", "/api/links/:token/events", links.events);
route("POST", "/api/links/:token/join", links.join);

route("POST", "/api/boards/:id/posts", posts.create, true);
route("GET", "/api/posts/:id", posts.get);
route("PATCH", "/api/posts/:id", posts.edit);
route("PATCH", "/api/posts/:id/move", posts.move);
route("DELETE", "/api/posts/:id", posts.remove);
route("POST", "/api/posts/:id/approve", posts.approve);
route("POST", "/api/posts/:id/reject", posts.reject);
route("PUT", "/api/posts/:id/like", reactions.like);
route("DELETE", "/api/posts/:id/like", reactions.unlike);
route("PUT", "/api/posts/:id/vote", reactions.vote);
route("DELETE", "/api/posts/:id/vote", reactions.unvote);
route("GET", "/api/posts/:id/comments", reactions.comments);
route("POST", "/api/posts/:id/comments", reactions.addComment);
route("GET", "/api/attachments/:id", attachments.read);

function send(res: ServerResponse, reply: Reply): void {
  if (reply === null) return;
  if ("raw" in reply) {
    res.writeHead(reply.status, { ...reply.headers, "Content-Length": reply.raw.length });
    res.end(reply.raw);
  } else if (reply.body === undefined) {
    res.writeHead(reply.status);
    res.end();
  } else {
    sendJson(res, reply.status, reply.body);
  }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const matched = routes.find((candidate) => candidate.method === method && candidate.pattern.test(url.pathname));
  if (method !== "GET" && method !== "HEAD" && crossOrigin(req)) throw new ApiError(403, { error: "cross_origin" });
  const limit = matched?.multipart ? config.uploadMaxBytes + config.multipartExtraBytes : config.jsonLimitBytes;
  const body = method === "GET" || method === "HEAD" ? Buffer.alloc(0) : await readBody(req, limit);
  if (body === "too_large") throw new ApiError(413, { error: "body_too_large" });
  if (!matched) throw notFound();
  const params: Record<string, string> = {};
  const values = url.pathname.match(matched.pattern) ?? [];
  matched.names.forEach((name, index) => {
    try {
      params[name] = decodeURIComponent(values[index + 1]);
    } catch {
      throw notFound();
    }
    // Postgres text cannot hold a NUL byte, so such an id names nothing.
    if (params[name].includes("\0")) throw notFound();
  });
  send(res, await matched.handler({ req, res, params, cookies: parseCookies(req.headers.cookie), body }));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url);
    } else {
      await servePage({ req, res, params: {}, cookies: parseCookies(req.headers.cookie), body: Buffer.alloc(0) });
    }
  } catch (error) {
    if (res.headersSent) {
      res.end();
    } else if (error instanceof ApiError) {
      sendJson(res, error.status, error.body);
    } else {
      console.error(error);
      sendJson(res, 500, { error: "internal_error" });
    }
  }
}

export const server = http.createServer((req, res) => void handle(req, res));
