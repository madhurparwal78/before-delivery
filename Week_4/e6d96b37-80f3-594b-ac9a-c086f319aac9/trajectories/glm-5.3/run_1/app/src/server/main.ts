import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { migrate, pool } from "./db.js";
import { DEFAULT_NAMESPACE, now as clockNow } from "./clock.js";
import { Storage } from "./storage.js";
import { Register } from "./register.js";
import { Keycloak } from "./keycloak.js";
import { KeycloakAdmin } from "./kcadmin.js";
import { Seeder } from "./seed.js";
import { authRouter } from "./routes_auth.js";
import { specimenRouter } from "./routes_specimens.js";
import { stockRouter } from "./routes_stock.js";
import { exchangeRouter } from "./routes_exchange.js";
import { disputesRouter } from "./routes_disputes.js";
import { auditRouter } from "./routes_audit.js";
import { gradeRouter } from "./routes_grade.js";
import { attachSession } from "./session.js";
import { errorOut, json } from "./routes_util.js";
import { copyFor } from "../shared/feedback.js";

import { errors, namespaceExists } from "./domain.js";
import { eventsAfter, registerStream, dropStream, sseInit, sseComment } from "./hub.js";

import type { FlanEnv } from "../shared/env.js";

const env = loadConfig();
const storage = new Storage(env);
const register = new Register(env);
const kc = new Keycloak(env);
const kcAdmin = new KeycloakAdmin(env, kc);

const app = express();
app.locals.env = env;
app.disable("x-powered-by");
app.use(cookieParser());

const jsonUpload = express.json({ limit: env.FLAN_REQUEST_MAX_BYTES });
const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.FLAN_UPLOAD_MAX_BYTES, files: 4, fields: 20 } });

app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/__grade/")) {
    if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
      const contentType = req.headers["content-type"] ?? "";
      if (contentType.startsWith("multipart/form-data")) {
        // The raw request is larger than the files it carries; enforce the whole-body limit first.
        const contentLength = Number.parseInt(String(req.headers["content-length"] ?? "0"), 10);
        if (Number.isFinite(contentLength) && contentLength > env.FLAN_REQUEST_MAX_BYTES) {
          json(res, 413, { error: "too_large", message: copyFor("F_TOO_LARGE") });
          return;
        }
        multipart.any()(req, res, (err) => {
          if (err) {
            json(res, 413, { error: "too_large", message: copyFor("F_TOO_LARGE") });
            return;
          }
          next();
        });
        return;
      }
      if (contentType.startsWith("application/json") || contentType === "" || req.method === "DELETE") {
        jsonUpload(req, res, (err) => {
          if (err) {
            if (err.type === "entity.too.large") {
              json(res, 413, { error: "too_large", message: copyFor("F_TOO_LARGE") });
              return;
            }
            json(res, 400, { error: "bad_request", message: copyFor("F_BAD_BODY") });
            return;
          }
          next();
        });
        return;
      }
      json(res, 415, { error: "unsupported_media_type", message: copyFor("F_BAD_BODY") });
      return;
    }
  }
  next();
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  json(res, 503, { error: "service_unavailable", message: copyFor("F_SERVICE") });
  void err;
});

app.use(attachSession);

// Health answers whenever the HTTP server runs, whatever the dependencies do.
app.get("/api/health", (_req, res) => {
  json(res, 200, { status: "ok" });
});

app.get("/api/session", (req, res) => {
  const session = req.session;
  if (!session) {
    json(res, 200, { subject: "", username: "", role: "outsider", namespace: "", step_up_fresh: false, step_up_expires_at: null });
    return;
  }
  const fresh = session.step_up_at !== null && Date.now() - session.step_up_at.getTime() <= env.FLAN_STEPUP_TTL_S * 1000;
  const expires = session.step_up_at ? new Date(session.step_up_at.getTime() + env.FLAN_STEPUP_TTL_S * 1000).toISOString() : null;
  json(res, 200, {
    subject: session.subject,
    username: session.username,
    role: session.role,
    namespace: session.namespace,
    step_up_fresh: fresh,
    step_up_expires_at: expires,
  });
});

app.use("/api", specimenRouter(env, storage, register));
app.use("/api", stockRouter(register));
app.use("/api", exchangeRouter(env, storage));
app.use("/api", disputesRouter(env, storage));
app.use("/api", auditRouter(env));

// SSE stream: replays missed events, then streams live.
app.get("/api/desks/:ns/stream", async (req, res) => {
  try {
    const session = req.session;
    if (!session) throw errors.session();
    const ns = req.params.ns;
    if (session.namespace !== ns) throw errors.hidden();
    const afterRaw = req.query.after;
    const lastEventId = req.headers["last-event-id"];
    const after = typeof afterRaw === "string" && afterRaw !== "" ? Number.parseInt(afterRaw, 10) : typeof lastEventId === "string" ? Number.parseInt(lastEventId, 10) : 0;
    sseInit(res);
    const missed = await eventsAfter(ns, Number.isFinite(after) ? after : 0);
    for (const event of missed) {
      res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    const id = registerStream({
      ns,
      role: session.role === "counterpart" ? "counterpart" : "dealer",
      subject: session.subject,
      send: (payload) => res.write(payload),
      close: () => res.end(),
    });
    const heartbeat = setInterval(() => sseComment(res), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      dropStream(id);
    });
  } catch (err) {
    errorOut(res, err);
  }
});

app.get("/evidence/:token", async (req, res) => {
  try {
    const session = req.session;
    if (!session) throw errors.session();
    const token = req.params.token;
    const link = await pool.query<{ dispute: string; expires_at: Date; revoked: boolean }>(
      "SELECT dispute, expires_at, revoked FROM evidence_links WHERE token = $1",
      [token],
    );
    const row = link.rows[0];
    if (!row || row.revoked) throw errors.hidden();
    const clock = await clockNow(session.namespace);
    if (row.expires_at.getTime() <= clock.getTime()) throw errors.hidden();
    const dispute = await pool.query<{ specimen: string; offer: string }>(
      "SELECT specimen, offer FROM disputes WHERE ns = $1 AND key = $2",
      [session.namespace, row.dispute],
    );
    if (dispute.rows.length === 0) throw errors.hidden();
    const arrival = await pool.query<{ object_key: string }>(
      "SELECT object_key FROM photos WHERE ns = $1 AND specimen = $2 AND label = 'arrival' ORDER BY id DESC LIMIT 1",
      [session.namespace, dispute.rows[0].specimen],
    );
    if (arrival.rows.length === 0) throw errors.hidden();
    const object = await storage.get(arrival.rows[0].object_key);
    if (!object) throw errors.hidden();
    res.setHeader("Content-Type", object.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(object.bytes));
  } catch (err) {
    errorOut(res, err);
  }
});

app.use("/auth", authRouter(env, kc));
app.use("/__grade", gradeRouter(env, storage, register, kc, kcAdmin));

// Reads that the shell needs under one origin.
app.get("/api/desks/:ns/state", async (req, res) => {
  try {
    const session = req.session;
    if (!session) throw errors.session();
    const ns = req.params.ns;
    if (!(await namespaceExists(ns))) throw errors.hidden();
    if (session.namespace !== ns) throw errors.hidden();
    const { loadState } = await import("./state.js");
    const state = await loadState(env, ns, session.role === "counterpart" ? "counterpart" : "dealer");
    json(res, 200, state);
  } catch (err) {
    errorOut(res, err);
  }
});

app.get("/api/desks/:ns/specimens", async (req, res) => {
  try {
    const session = req.session;
    if (!session) throw errors.session();
    if (session.role !== "dealer") throw errors.hidden();
    const ns = req.params.ns;
    if (session.namespace !== ns) throw errors.hidden();
    const limitRaw = req.query.limit;
    const limit = limitRaw === undefined ? env.FLAN_PAGE_MAX : Number.parseInt(String(limitRaw), 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > env.FLAN_PAGE_MAX) {
      throw errors.invalid({ limit: copyFor("F_PAGE_LIMIT", { max: env.FLAN_PAGE_MAX }) });
    }
    const after = req.query.after === undefined ? 0 : Number.parseInt(String(req.query.after), 10);
    const result = await pool.query(
      "SELECT key, creation_sequence FROM specimens WHERE ns = $1 AND creation_sequence > $2 ORDER BY creation_sequence LIMIT $3",
      [ns, Number.isFinite(after) ? after : 0, limit],
    );
    const keys = result.rows.map((r) => r.key);
    const last = result.rows.length > 0 ? result.rows[result.rows.length - 1].creation_sequence : null;
    const { loadState } = await import("./state.js");
    const state = await loadState(env, ns, "dealer");
    const items = keys.map((k) => (state.specimens[k] ? { ...state.specimens[k], key: k } : null)).filter((x) => x !== null);
    json(res, 200, { items, next: last !== null ? String(last) : null });
  } catch (err) {
    errorOut(res, err);
  }
});

app.get("/api/desks/:ns/audit/cells", async (req, res) => {
  try {
    const session = req.session;
    if (!session) throw errors.session();
    if (session.role !== "dealer") throw errors.hidden();
    const ns = req.params.ns;
    if (session.namespace !== ns) throw errors.hidden();
    const limitRaw = req.query.limit;
    const limit = limitRaw === undefined ? env.FLAN_PAGE_MAX : Number.parseInt(String(limitRaw), 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > env.FLAN_PAGE_MAX) {
      throw errors.invalid({ limit: copyFor("F_PAGE_LIMIT", { max: env.FLAN_PAGE_MAX }) });
    }
    const after = req.query.after === undefined ? "" : String(req.query.after);
    const { TRAY_CELLS } = await import("../shared/util.js");
    const ordered: readonly string[] = TRAY_CELLS;
    const startIndex = after === "" ? 0 : ordered.indexOf(after) + 1;
    const slice = ordered.slice(startIndex, startIndex + limit);
    const cells = await pool.query("SELECT cell, specimen, audit_mark, audit_version FROM tray_cells WHERE ns = $1", [ns]);
    const byCell = new Map(cells.rows.map((r) => [r.cell, r]));
    const items = slice.map((cell) => {
      const row = byCell.get(cell);
      return {
        cell,
        specimen: row?.specimen ?? "",
        audit_mark: (row?.audit_mark as "missing" | null) ?? null,
        audit_version: row?.audit_version ?? 0,
      };
    });
    const nextIndex = startIndex + slice.length;
    json(res, 200, { items, next: nextIndex < ordered.length ? ordered[nextIndex] : null });
  } catch (err) {
    errorOut(res, err);
  }
});

app.get("/api/desks/:ns/register/:reference", async (req, res) => {
  try {
    const session = req.session;
    if (!session) throw errors.session();
    const ns = req.params.ns;
    if (session.namespace !== ns) throw errors.hidden();
    const reference = req.params.reference;
    const record = await pool.query<{ image_object_key: string | null }>(
      "SELECT image_object_key FROM register_records WHERE ns = $1 AND reference = $2",
      [ns, reference],
    );
    const key = record.rows[0]?.image_object_key;
    if (!key) throw errors.hidden();
    const object = await storage.get(key);
    if (!object) throw errors.hidden();
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(object.bytes));
  } catch (err) {
    errorOut(res, err);
  }
});

app.get("/api/desks/:ns/photos/:photoId", async (req, res) => {
  try {
    const session = req.session;
    if (!session) throw errors.session();
    const ns = req.params.ns;
    if (session.namespace !== ns) throw errors.hidden();
    const photoId = req.params.photoId;
    const photo = await pool.query<{ object_key: string; content_type: string; owner: string; key: string }>(
      "SELECT p.object_key, p.content_type, s.owner, s.key FROM photos p JOIN specimens s ON s.ns = p.ns AND s.key = p.specimen WHERE p.id = $1 AND p.ns = $2",
      [photoId, ns],
    );
    const row = photo.rows[0];
    if (!row) throw errors.hidden();
    const object = await storage.get(row.object_key);
    if (!object) throw errors.hidden();
    res.setHeader("Content-Type", row.content_type);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(object.bytes));
  } catch (err) {
    errorOut(res, err);
  }
});

// Static frontend + pages.
const distDir = join(process.cwd(), "dist");
const indexHtml = existsSync(join(distDir, "index.html")) ? readFileSync(join(distDir, "index.html"), "utf8") : "<!doctype html><title>Flan</title>";

const PAGES = ["/desk/:ns", "/desk/:ns/:workflow", "/help", "/help/evidence", "/help/keyboard", "/"];

app.use(
  express.static(distDir, {
    index: false,
    maxAge: "1h",
    setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
  }),
);

app.get(PAGES, (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(indexHtml);
});

// Method-not-matched known routes answer 405; everything else 404.
app.use((req, res) => {
  res.status(404).json({ error: "not_found", message: copyFor("F_HIDDEN") });
});

async function ensureDefaultNamespace(): Promise<void> {
  await pool.query("INSERT INTO namespaces (namespace) VALUES ($1) ON CONFLICT DO NOTHING", [DEFAULT_NAMESPACE]);
  const existing = await pool.query("SELECT 1 FROM specimens WHERE ns = $1 AND key = 'A'", [DEFAULT_NAMESPACE]);
  if (existing.rowCount === 1) return;
  // The brief's default namespace: the fixture baseline plus one sent offer, offer-1: C for X.
  const seeder = new Seeder(env, storage, register, kc, kcAdmin);
  await seeder.seed(DEFAULT_NAMESPACE, "tray_placement", "base").catch(() => undefined);
  const now = await clockNow(DEFAULT_NAMESPACE);
  await pool.query(
    `INSERT INTO offers (ns, key, version, status, dealer_items, counterpart_items, expires_at)
     VALUES ($1, 'offer-1', 1, 'sent', ARRAY['C']::text[], ARRAY['X']::text[], $2)`,
    [DEFAULT_NAMESPACE, new Date(now.getTime() + env.FLAN_OFFER_WINDOW_S * 1000)],
  );
  await pool.query("UPDATE specimens SET status = 'reserved' WHERE ns = $1 AND key IN ('C','X')", [DEFAULT_NAMESPACE]);
}

async function main(): Promise<void> {
  const port = env.APP_PUBLIC_PORT;
  app.listen(port, "0.0.0.0", () => {
    console.log(`flan listening on ${port}`);
  });

  // Idempotent setup, retried per request when a dependency is unreachable at boot.
  void migrate()
    .then(() => ensureDefaultNamespace())
    .then(async () => {
      const keycloakUp = await kcAdmin.available().catch(() => false);
      if (keycloakUp) {
        await kcAdmin.ensureRealmRoles().catch(() => undefined);
        await kcAdmin.ensureRequiredActions().catch(() => undefined);
        const seeder = new Seeder(env, storage, register, kc, kcAdmin);
        await seeder.provisionDefaultIdentities();
      }
    })
    .catch((err) => {
      console.error("setup deferred:", err instanceof Error ? err.message : err);
    });
}

void main();
