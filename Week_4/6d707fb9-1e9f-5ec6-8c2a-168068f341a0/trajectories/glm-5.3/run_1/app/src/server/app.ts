import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { readConfig, type Config, COOKIE_NAME, JSON_LIMIT, EVIDENCE_REQUEST_LIMIT } from "./config/env.js";
import { initDb } from "./db/pool.js";
import { applySchema } from "./db/schema.js";
import { seedIfEmpty } from "./db/seed.js";
import {
  ApiError,
  errMalformedJson,
  errNotFound,
  errSessionEnded,
  errNotSignedIn,
  errTooLarge,
  errUnsupportedMediaType,
} from "./api/errors.js";
import { FileStore } from "./services/filestore.js";
import { Mailer } from "./services/mailer.js";
import { Providers } from "./services/providers.js";
import { instantOf } from "./engine/time.js";

export interface AppState {
  config: Config;
  files: FileStore;
  mailer: Mailer;
  providers: Providers;
}

declare module "fastify" {
  interface FastifyInstance {
    state: AppState;
  }
}

export type SessionRead =
  | { kind: "none" }
  | { kind: "live"; deskId: string; sessionId: string; endsAt: string }
  | { kind: "ended" };

/** Read the session cookie and decide its state. The server alone decides it has ended. */
export async function readSession(req: FastifyRequest): Promise<SessionRead> {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return { kind: "none" };
  const session = await oneSession(raw);
  if (!session) return { kind: "ended" };
  if (session.ends_at <= instantOf(new Date())) return { kind: "ended" };
  return { kind: "live", deskId: session.desk_id, sessionId: session.id, endsAt: session.ends_at };
}

async function oneSession(id: string) {
  const { one } = await import("./db/pool.js");
  return one<{ id: string; desk_id: string; ends_at: string }>(
    `SELECT id, desk_id, ends_at FROM sessions WHERE id = $1`,
    [id],
  );
}

/** Authentication for a signed-in endpoint: session_ended for an ended cookie, else not_signed_in. */
export async function requireDesk(req: FastifyRequest): Promise<{ deskId: string; sessionId: string }> {
  const session = await readSession(req);
  if (session.kind === "live") return { deskId: session.deskId, sessionId: session.sessionId };
  if (session.kind === "ended") throw errSessionEnded();
  throw errNotSignedIn();
}

/** The published session cookie attributes: HttpOnly, SameSite=Lax, browser-session. */
export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.header("Set-Cookie", `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function buildServer(): Promise<FastifyInstance> {
  const config = readConfig();
  initDb(config);
  await applySchema();
  await seedIfEmpty(config);

  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: JSON_LIMIT });
  await app.register(cookie);
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });
  // Multipart for evidence: parse the file parts with the boundary, counting streamed bytes
  // so the size limit is enforced on the file alone.
  app.addContentTypeParser("multipart/form-data", {}, (req, payload, done) => {
    collectMultipart(req, payload as AsyncIterable<Buffer>, done);
  });
  app.decorate("state", {
    config,
    files: new FileStore(config),
    mailer: new Mailer(config),
    providers: new Providers(config),
  } satisfies AppState);

  // Ladder step 2: a body over its published size limit, decided before the body is
  // parsed and before authentication, always answered as JSON, never a dropped connection.
  app.addHook("onRequest", async (req) => {
    const limit = limitForPath(req.url.split("?")[0]);
    if (limit === null) return;
    const lengthHeader = req.headers["content-length"];
    if (lengthHeader === undefined) return;
    const length = Number.parseInt(String(lengthHeader), 10);
    if (Number.isFinite(length) && length > limit) throw errTooLarge();
  });

  // Ladder step 6: content type. JSON endpoints take application/json; the catalogue
  // endpoints take text/csv; an empty body on an action with no fields also passes.
  app.addHook("preValidation", async (req) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/")) return;
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const ct = req.headers["content-type"];
    if (ct === undefined || ct === "") return;
    const base = ct.split(";")[0].trim();
    if (base === "application/json" || base === "text/csv" || base === "text/plain") return;
    // The evidence request's multipart body is judged by content in the route itself.
    if (base === "multipart/form-data" && path.startsWith("/api/a/")) return;
    throw errUnsupportedMediaType();
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      reply.headers(err.headers ?? {});
      return reply.status(err.status).send(err.body());
    }
    const e = err as { statusCode?: number; message?: string; type?: string };
    if (e.statusCode === 400 && typeof e.message === "string" && /JSON/i.test(e.message)) {
      return reply.status(400).send(errMalformedJson().body());
    }
    if (e.type === "entity.too.large" || e.statusCode === 413) {
      return reply.status(413).send(errTooLarge().body());
    }
    if (e.statusCode === 415) {
      return reply.status(415).send(errUnsupportedMediaType().body());
    }
    console.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong." } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send(errNotFound().body()));

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    return payload;
  });

  return app;
}

function limitForPath(path: string): number | null {
  if (path.startsWith("/api/a/")) return EVIDENCE_REQUEST_LIMIT;
  return JSON_LIMIT;
}


const MULTIPART_SKIP = 1024 * 1024 * 20;

function collectMultipart(
  req: FastifyRequest,
  payload: AsyncIterable<Buffer>,
  done: (err: Error | null, result?: unknown) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  void (async () => {
    for await (const chunk of payload) {
      size += chunk.length;
      if (size > MULTIPART_SKIP) {
        done(errTooLarge());
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const ct = String(req.headers["content-type"] ?? "");
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? "";
    if (boundary.length === 0) {
      done(errUnsupportedMediaType());
      return;
    }
    const files: Record<string, { filename?: string; value: Buffer; mimetype?: string }[]> = {};
    const delim = Buffer.from(`--${boundary}`);
    let pos = body.indexOf(delim);
    while (pos !== -1) {
      const next = body.indexOf(delim, pos + delim.length);
      if (next === -1) break;
      const partRaw = body.subarray(pos + delim.length, next);
      const headerEnd = partRaw.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const headerText = partRaw.subarray(0, headerEnd).toString("latin1");
        const value = partRaw.subarray(headerEnd + 4);
        const trimmed = value.subarray(0, value.length - 2);
        const nameMatch = /name="([^"]*)"/i.exec(headerText);
        const fileMatch = /filename="([^"]*)"/i.exec(headerText);
        const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
        const fieldName = nameMatch?.[1] ?? "";
        if (fieldName.length > 0) {
          const list = files[fieldName] ?? [];
          list.push({
            filename: fileMatch?.[1],
            value: Buffer.from(trimmed),
            mimetype: typeMatch?.[1]?.trim(),
          });
          files[fieldName] = list;
        }
      }
      pos = next;
    }
    done(null, files);
  })();
}
