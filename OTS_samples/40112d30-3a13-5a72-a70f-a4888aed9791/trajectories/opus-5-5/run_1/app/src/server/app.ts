import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerAuthRoutes, currentUser } from "./auth.js";
import { registerBuilderRoutes } from "./builder.js";
import { one, pool } from "./db.js";
import { ApiError, notFound } from "./errors.js";
import { loadForm, roleOf, UUID_PATTERN } from "./forms.js";
import { registerGradingRoutes } from "./grading.js";
import { Ctx, JSON_LIMIT, json, readBody, Router, send, type Reply } from "./http.js";
import { tokenHash } from "./auth.js";
import { sameOrigin } from "./live.js";
import { smtpUp } from "./mail.js";
import { now } from "./clock.js";
import { registerOwnerRoutes } from "./owner.js";
import { lapsed, registerRespondentRoutes } from "./respond.js";
import { storageUp } from "./storage.js";
import { valkeyUp } from "./valkey.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

const assets = new Map<string, { body: Buffer; type: string }>();
for (const name of readdirSync(publicDir)) {
  const type = CONTENT_TYPES[path.extname(name)];
  if (type) assets.set(`/${name}`, { body: readFileSync(path.join(publicDir, name)), type });
}

const fontPreload = [...assets.keys()]
  .filter((name) => name.endsWith(".woff2") && !name.includes("-ext-"))
  .map((name) => `<link rel="preload" href="${name}" as="font" type="font/woff2" crossorigin>`)
  .join("");

function shell(status: number, reason: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="nf-status" content="${status}">${reason ? `\n<meta name="nf-reason" content="${reason}">` : ""}
<title>Nightform</title>
${fontPreload}
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="announcer" class="visually-hidden" role="status" aria-live="polite"></div>
<div id="alert" class="visually-hidden" role="alert"></div>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}

/** Page headers; the socket origin is listed explicitly because older engines do not match `ws:` with 'self'. */
function securityHeaders(host: string | null): Record<string, string> {
  const socket = host && /^[A-Za-z0-9.:[\]-]+$/.test(host) ? ` ws://${host} wss://${host}` : "";
  return {
    "Content-Security-Policy": `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'${socket}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  };
}

type PageStatus = 200 | 404 | "signin" | "LINK_EXPIRED" | "ALREADY_SENT";

/** Decides whether a page route may be opened, so refused pages answer 404 like the API. */
async function pageStatus(ctx: Ctx): Promise<PageStatus> {
  const p = ctx.path.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/signin" || p === "/signup") return 200;
  if (p === "/forms") return (await currentUser(ctx)) ? 200 : "signin";
  let match = /^\/forms\/([^/]+)\/(edit|summary|responses|editions)(?:\/([^/]+))?$/.exec(p);
  if (match) {
    const [, id, section, sub] = match;
    const user = await currentUser(ctx);
    const form = user ? await loadForm(id) : null;
    const role = form && user ? await roleOf(form, user.id) : null;
    if (!form || !role) return 404;
    if (section === "edit") return sub === undefined && !(role === "editor" && form.state === "closed") ? 200 : 404;
    if (section === "summary") return sub === undefined ? 200 : 404;
    if (sub === undefined) return 200;
    if (section === "responses")
      return UUID_PATTERN.test(sub) && (await one("SELECT 1 FROM responses WHERE id = $1 AND form_id = $2 AND status = 'submitted'", [sub, id])) ? 200 : 404;
    return /^\d+$/.test(sub) && (await one("SELECT 1 FROM editions WHERE form_id = $1 AND number = $2", [id, Number(sub)])) ? 200 : 404;
  }
  if ((match = /^\/f\/([^/]+)$/.exec(p)))
    return (await one("SELECT 1 FROM forms WHERE slug = $1 AND live_edition IS NOT NULL", [match[1]])) ? 200 : 404;
  if ((match = /^\/r\/([^/]+)$/.exec(p))) {
    const row = await one<{ status: string; expires_at: Date }>("SELECT status, expires_at FROM responses WHERE resume_token = $1", [match[1]]);
    if (!row) return 404;
    if (row.status === "submitted") return "ALREADY_SENT";
    return row.status === "expired" || lapsed(row) ? "LINK_EXPIRED" : 200;
  }
  if ((match = /^\/invite\/([^/]+)$/.exec(p)))
    return (await one("SELECT 1 FROM invitations WHERE token_hash = $1 AND used_at IS NULL AND expires_at >= $2", [tokenHash(match[1]), now()])) ? 200 : 404;
  return 404;
}

interface ServiceState {
  at: number;
  value: Record<string, "up" | "down">;
}
let services: ServiceState | null = null;

async function checkServices(): Promise<Record<string, "up" | "down">> {
  if (services && Date.now() - services.at < 2000) return services.value;
  const flag = (up: boolean): "up" | "down" => (up ? "up" : "down");
  const [postgres, minio, mailpit] = await Promise.all([
    pool.query("SELECT 1").then(
      () => true,
      () => false,
    ),
    storageUp(),
    smtpUp(),
  ]);
  const value = { postgres: flag(postgres), valkey: flag(valkeyUp()), minio: flag(minio), mailpit: flag(mailpit) };
  services = { at: Date.now(), value };
  return value;
}

export function createApp(ready: Promise<void>): (req: IncomingMessage, res: ServerResponse) => void {
  const router = new Router();
  router.add("GET", "/api/health", async () => json(200, { status: "ok" }));
  router.add("GET", "/api/services", async () => json(200, await checkServices()));
  registerAuthRoutes(router);
  registerBuilderRoutes(router);
  registerRespondentRoutes(router);
  registerOwnerRoutes(router);
  registerGradingRoutes(router);

  const handleApi = async (ctx: Ctx): Promise<Reply> => {
    const match = router.match(ctx.method, ctx.path);
    const reading = ctx.method !== "GET" && ctx.method !== "HEAD";
    if (reading && !match?.route.rawBody) {
      const raw = await readBody(ctx.req, JSON_LIMIT, () => new ApiError("BODY_TOO_LARGE"));
      try {
        ctx.body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        ctx.body = {};
      }
    }
    if (!match) throw notFound();
    if (reading && !sameOrigin(ctx.req)) throw notFound();
    if (ctx.path !== "/api/health") await ready;
    ctx.params = match.params;
    return match.route.handler(ctx);
  };

  return (req, res) => {
    const ctx = new Ctx(req, res);
    const run = async (): Promise<void> => {
      if (ctx.path.startsWith("/api/") || ctx.path === "/api") {
        try {
          send(ctx, await handleApi(ctx));
        } catch (error) {
          if (!req.readableEnded) req.resume();
          if (error instanceof ApiError) send(ctx, json(error.status, error.body()));
          else {
            console.error(error);
            send(ctx, json(500, { error: { code: "SERVER_ERROR", message: "Something went wrong. Try again." } }));
          }
        }
        return;
      }
      const asset = ctx.method === "GET" || ctx.method === "HEAD" ? assets.get(ctx.path) : undefined;
      if (asset) {
        send(ctx, { status: 200, raw: asset.body, headers: { "Content-Type": asset.type, "Cache-Control": "no-cache" } });
        return;
      }
      await ready;
      const status = ctx.method === "GET" || ctx.method === "HEAD" ? await pageStatus(ctx) : 404;
      if (status === "signin") {
        send(ctx, { status: 302, headers: { Location: "/signin" } });
        return;
      }
      const code = typeof status === "number" ? status : 404;
      const reason = typeof status === "number" ? null : status;
      send(ctx, { status: code, raw: shell(code, reason), headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders(ctx.header("host")) } });
    };
    run().catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) send(ctx, { status: 500, raw: "Something went wrong.", headers: { "Content-Type": "text/plain" } });
    });
  };
}
