import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import type { PoolClient } from "pg";
const { Pool } = pg;
import { createHash } from "node:crypto";
import {
  CREW, CYCLES, DEPARTMENTS, idFromNumber,
  isCycleKey, isDepartmentKey,
} from "../domain/model.js";
import type { CycleConfig } from "../domain/cycles.js";
import { currentCycle, dateInZone, calendarDaysBetween } from "../domain/cycles.js";
import { Db } from "./db.js";
import { RuleError, type Outcome } from "./engine.js";
import { applySchema, seedIfEmpty } from "./schema.js";
import { PlotStorage } from "./storage.js";
import { Intake, IntakeRefused } from "./intake.js";
import * as api from "./api.js";
import type { Ctx } from "./api.js";
import { errorBody, readBody, sendError, sendJson, PayloadTooLarge } from "./http.js";
import type { ChangeResult } from "../domain/types.js";

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 10_100_000;
const UPLOAD_LIMIT = 10_000_000;
const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);
const THEATRE = "Kettleyard Playhouse";
const SHOW = "The Lantern Keepers";
const TZ = process.env.THEATRE_TZ ?? "Europe/London";
const DAY_MS = 86_400_000;

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
};

interface SseClient { res: http.ServerResponse }

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new Db(pool);

  // ---- schema, retried until Postgres is ready (DP-52) ----
  let schemaReady = false;
  while (!schemaReady) {
    try { await applySchema(pool); schemaReady = true } catch (e) {
      console.error("waiting for postgres", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // ---- cycles: Rehearsal 1 Monday recorded on first empty start (DP-36) ----
  let firstMonday = process.env.PROMPTSIDE_FIRST_MONDAY;
  if (!firstMonday) {
    const r = await pool.query("select value from meta where key = 'first_monday'");
    if (r.rows.length > 0) firstMonday = r.rows[0].value;
  }
  if (!firstMonday) {
    const today = dateInZone(new Date(), TZ);
    const utcMid = new Date(`${today}T00:00:00Z`);
    const weekday = utcMid.getUTCDay();
    const back = weekday === 0 ? 6 : weekday - 1;
    firstMonday = new Date(utcMid.getTime() - back * DAY_MS).toISOString().slice(0, 10);
    await pool.query("insert into meta (key, value) values ('first_monday', $1) on conflict (key) do nothing", [firstMonday]);
  }
  const shortRaw = process.env.PROMPTSIDE_CYCLE_SECONDS;
  const mode = shortRaw !== undefined && shortRaw !== "" && Number(shortRaw) >= 10 && Number(shortRaw) <= 604800 ? "short" : "calendar";
  const seconds = mode === "short" ? Number(shortRaw) : 0;
  const base = new Date(`${firstMonday}T00:00:00Z`).getTime();
  const spans = CYCLES.map((c, i) => ({
    key: c.key,
    startsAt: new Date(mode === "calendar" ? base + i * 7 * DAY_MS : base + i * seconds * 1000),
    endsAt: i === CYCLES.length - 1 ? null : new Date(mode === "calendar" ? base + (i + 1) * 7 * DAY_MS : base + (i + 1) * seconds * 1000),
  }));
  const cycleConfig: CycleConfig = {
    mode, spans,
    openingNight: process.env.PROMPTSIDE_OPENING_NIGHT ?? new Date(base + 38 * DAY_MS).toISOString().slice(0, 10),
    timeZone: TZ, firstMonday,
  };
  db.spans = spans;
  const refreshCurrentCycle = () => { db.currentCycleKey = currentCycle(new Date(), spans).key };
  refreshCurrentCycle();
  setInterval(refreshCurrentCycle, 1000);

  await seedIfEmpty(pool);

  const intake = new Intake(process.env.POCKETBASE_URL!, process.env.POCKETBASE_ADMIN_EMAIL!, process.env.POCKETBASE_ADMIN_PASSWORD!);
  const storage = new PlotStorage(process.env.S3_ENDPOINT!, process.env.S3_REGION ?? "us-east-1",
    process.env.S3_BUCKET!, process.env.S3_ACCESS_KEY_ID!, process.env.S3_SECRET_ACCESS_KEY!,
    String(process.env.S3_FORCE_PATH_STYLE ?? "true") === "true");
  const ctx: Ctx = { db, intake, storage, cycleConfig };

  // ---- change stream (DP-21) ----
  const sse = new Set<SseClient>();
  let statusJson = JSON.stringify({ intake: "down", plot_storage: "down" });
  function broadcast(kind: string, payload: object): void {
    const data = `event: change\ndata: ${JSON.stringify({ kind, ...(payload as Record<string, unknown>) })}\n\n`;
    for (const c of sse) c.res.write(data);
  }

  type Broadcastable = ChangeResult & { request?: unknown }
  async function runChange(fn: (client: PoolClient) => Promise<Outcome | null>): Promise<{ result: Broadcastable; noop?: boolean } | null> {
    const client = await pool.connect();
    let outcome: Outcome | null = null;
    try {
      outcome = await fn(client);
      if (!outcome) {
        await client.query("rollback");
        return null;
      }
      if (outcome.noop) {
        const snapshot = await db.snapshot();
        const byNumber = await db.tasksJson();
        const tasks = outcome.touched.map((n) => byNumber.get(n)).filter((t) => t !== undefined);
        return {
          result: {
            change: snapshot.seq, undoable: false, tasks,
            cascade: [], reblocked: [], snapshot,
          },
          noop: true,
        };
      }
      const snapshot = await db.snapshot();
      const byNumber = await db.tasksJson();
      const tasks = outcome.touched.map((n) => byNumber.get(n)).filter((t) => t !== undefined);
      return {
        result: {
          change: outcome.change, undoable: outcome.undoable, tasks,
          cascade: outcome.cascade, reblocked: outcome.reblocked, snapshot,
          request: outcome.request as never,
        },
      };
    } catch (e) {
      try { await client.query("rollback") } catch { /* already aborted */ }
      throw e;
    } finally {
      client.release();
    }
  }

  // ---- service health, pull, rollover (DP-01, DP-37, DP-49) ----
  let intakeUp = false, storageUp = false;
  async function refreshStatus(): Promise<void> {
    const next = JSON.stringify({ intake: intakeUp ? "up" : "down", plot_storage: storageUp ? "up" : "down" });
    if (next !== statusJson) {
      statusJson = next;
      for (const c of sse) c.res.write(`event: status\ndata: ${statusJson}\n\n`);
    }
  }
  async function pollServices(): Promise<void> {
    try { intakeUp = await intake.check() } catch { intakeUp = false }
    try { storageUp = await storage.check() } catch { storageUp = false }
    await refreshStatus();
  }
  async function backgroundPull(): Promise<void> {
    if (!intakeUp) return;
    try {
      const r = await runChange((c) => api.pullIntake(ctx, c));
      if (r) broadcast("pull", r.result);
    } catch (e) { console.error("pull failed", e) }
  }
  async function backgroundRollover(): Promise<void> {
    try {
      const r = await runChange((c) => api.rollover(ctx, c));
      if (r) broadcast("rollover", r.result);
    } catch (e) { console.error("rollover failed", e) }
  }
  setInterval(pollServices, 5000);
  setInterval(backgroundPull, 4000);
  setInterval(backgroundRollover, 2000);
  await pollServices();
  await backgroundPull();
  await backgroundRollover();

  const hash = (s: string): string => createHash("sha256").update(s).digest("hex");

  function requireJson(req: http.IncomingMessage): void {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.toLowerCase().includes("application/json")) throw new RuleError("unsupported_media_type", 415, {});
  }

  async function readJsonStr(req: http.IncomingMessage): Promise<string> {
    requireJson(req);
    return (await readBody(req, JSON_LIMIT)).toString("utf8");
  }

  function parseJson(raw: string): any {
    if (raw.trim().length === 0) return {};
    try { return JSON.parse(raw) } catch { throw new RuleError("malformed_json", 400, {}) }
  }

  async function idempotentSend(req: http.IncomingMessage, res: http.ServerResponse, run: () => Promise<{ status: number; body: unknown }>, raw: string, method: string, path: string): Promise<void> {
    const key = req.headers["idempotency-key"] as string | undefined;
    if (key === undefined || key === "") {
      const r = await run();
      return sendJson(res, r.status, r.body);
    }
    if (!/^[\x21-\x7E]{1,100}$/.test(key)) {
      return sendError(res, 422, "validation_failed", "Check the highlighted fields.", {
        fields: { "Idempotency-Key": "Use 1 to 100 visible characters." },
      });
    }
    const rows = await pool.query("select method, path, body_hash, status, body from idempotency where key = $1", [key]);
    const h = hash(raw);
    for (const r of rows.rows) {
      if (r.method === method && r.path === path && r.body_hash === h) {
        res.writeHead(r.status, { "content-type": "application/json; charset=utf-8", "idempotent-replay": "true" });
        return void res.end(r.body);
      }
    }
    if (rows.rows.length > 0) return sendError(res, 409, "idempotency_key_reused", "That key was used for a different request.");
    const r = await run();
    if (r.status < 500) {
      await pool.query(
        "insert into idempotency (key, method, path, body_hash, status, body) values ($1,$2,$3,$4,$5,$6)",
        [key, method, path, h, r.status, JSON.stringify(r.body)]);
    }
    sendJson(res, r.status, r.body);
  }

  async function productionBody(): Promise<any> {
    const today = dateInZone(new Date(), TZ);
    return {
      theatre: THEATRE, show: SHOW, time_zone: TZ, today,
      opening_night: cycleConfig.openingNight,
      days_to_opening: calendarDaysBetween(today, cycleConfig.openingNight),
      current_cycle: currentCycle(new Date(), spans).key,
      departments: DEPARTMENTS, crew: CREW,
    };
  }

  const indexHtml = () => readFileSync("dist/index.html");

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((e) => {
      if (e instanceof PayloadTooLarge) {
        sendError(res, 413, "payload_too_large", "That request is too large.");
        res.on("finish", () => req.destroy());
        return;
      }
      if (e instanceof RuleError) return sendError(res, e.status, e.code, ruleMessage(e.code), e.extra);
      console.error(e);
      sendError(res, 500, "internal_error", "Something went wrong.");
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://promptside.local");
    const path = url.pathname;

    // ---- server boundary (DP-51) ----
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
        return sendError(res, 403, "cross_origin", "Cross-origin writes are refused.");
      }
    }

    if (path === "/api" || path.startsWith("/api/")) {
      if (path !== "/api/health" && !schemaReady) {
        res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
        return void res.end(JSON.stringify({ status: "starting" }));
      }
      return routeApi(req, res, method, path, url);
    }
    if (method !== "GET" && method !== "HEAD") return notFound(res);
    const blocked = /\.(ts|map|env)$/i.test(path) || path === "/run.json" || path === "/package.json" || path === "/package-lock.json" || path === "/npm-shrinkwrap.json" || path.includes("node_modules") || path.startsWith("/src");
    if (blocked) return notFound(res);
    if (path.startsWith("/assets/")) {
      const name = path.slice("/assets/".length);
      if (/\.(ts|map)$/i.test(name)) return notFound(res);
      const file = `dist/assets/${name}`;
      if (!existsSync(file)) return notFound(res);
      res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream", "cache-control": "public, max-age=3600" });
      return void res.end(readFileSync(file));
    }
    if (path === "/") { res.writeHead(302, { location: "/tasks" }); return void res.end() }
    if (path === "/tasks" || path === "/triage" || path === "/requests") return sendIndex(res);
    return notFound(res);
  }

  function sendIndex(res: http.ServerResponse): void {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(indexHtml());
  }

  function notFound(res: http.ServerResponse): void {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(indexHtml());
  }

  async function routeApi(req: http.IncomingMessage, res: http.ServerResponse, method: string, path: string, url: URL): Promise<void> {
    if (method === "GET" && path === "/api/health") {
      if (!schemaReady) {
        res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
        return void res.end(JSON.stringify({ status: "starting" }));
      }
      return sendJson(res, 200, { status: "ok" });
    }
    if (method === "GET" && path === "/api/status") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return void res.end(statusJson);
    }
    if (method === "GET" && path === "/api/production") return sendJson(res, 200, await productionBody());
    if (method === "GET" && path === "/api/snapshot") return sendJson(res, 200, await db.snapshot());
    if (method === "GET" && path === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: status\ndata: ${statusJson}\n\n`);
      const client: SseClient = { res };
      sse.add(client);
      const ping = setInterval(() => res.write(": ping\n\n"), 10_000);
      req.on("close", () => { clearInterval(ping); sse.delete(client) });
      return;
    }
    if (method === "GET" && path === "/api/tasks") {
      const bad: Record<string, string> = {};
      const dept = url.searchParams.get("dept");
      const status = url.searchParams.get("status");
      const blocked = url.searchParams.get("blocked");
      const cycle = url.searchParams.get("cycle");
      const owner = url.searchParams.get("owner");
      const label = url.searchParams.get("label");
      if (dept !== null && !isDepartmentKey(dept)) bad.dept = "That filter value isn't recognised.";
      if (status !== null && !["triage", "backlog", "todo", "in_progress", "done", "cancelled", "duplicate"].includes(status)) bad.status = "That filter value isn't recognised.";
      if (blocked !== null && blocked !== "1") bad.blocked = "That filter value isn't recognised.";
      if (cycle !== null && !isCycleKey(cycle)) bad.cycle = "That filter value isn't recognised.";
      if (owner !== null && owner !== "none" && !CREW.some((c) => c.handle === owner)) bad.owner = "That filter value isn't recognised.";
      if (label !== null && !DEPARTMENTS.some((d) => d.labels.some((l) => l.key === label))) bad.label = "That filter value isn't recognised.";
      if (Object.keys(bad).length > 0) {
        return sendError(res, 422, "validation_failed", "That filter value isn't recognised.", { fields: bad });
      }
      const byNumber = await db.tasksJson();
      let tasks = [...byNumber.values()];
      if (status === null) tasks = tasks.filter((t) => t.status !== "triage" && t.status !== "duplicate");
      else tasks = tasks.filter((t) => t.status === status);
      if (dept !== null) tasks = tasks.filter((t) => t.department === dept);
      if (blocked === "1") tasks = tasks.filter((t) => t.blocked);
      if (cycle !== null) tasks = tasks.filter((t) => t.cycle === cycle);
      if (owner !== null) tasks = tasks.filter((t) => (owner === "none" ? t.owner === null : t.owner === owner));
      if (label !== null) tasks = tasks.filter((t) => t.label === label);
      tasks.sort((a, b) => a.number - b.number);
      return sendJson(res, 200, { tasks, snapshot: await db.snapshot() });
    }
    const mTask = /^\/api\/tasks\/(STG-(\d+))$/.exec(path);
    if (mTask && method === "GET") {
      const t = await db.taskJson(Number(mTask[2]));
      if (!t) return sendError(res, 404, "not_found", "No such task.");
      return sendJson(res, 200, { task: t }, { etag: `"${t.version}"` });
    }
    if (mTask && method === "PATCH") {
      const actor = api.actorFromHeader(req.headers["x-crew-member"] as string | undefined);
      const raw = await readJsonStr(req);
      const body = parseJson(raw);
      const r = await runChange((c) => api.patchTask(ctx, c, actor, Number(mTask[2]), body, req.headers["if-match"] as string | undefined));
      if (!r?.noop) broadcast("edit", r!.result);
      return sendJson(res, 200, r!.result);
    }
    if (path === "/api/tasks" && method === "POST") {
      const actor = api.actorFromHeader(req.headers["x-crew-member"] as string | undefined);
      const raw = await readJsonStr(req);
      const body = parseJson(raw);
      return idempotentSend(req, res, async () => {
        const r = await runChange(async (c) => (await api.createTask(ctx, c, actor, body)).outcome);
        broadcast("create", r!.result);
        return { status: 201, body: r!.result };
      }, raw, "POST", path);
    }
    if (path === "/api/tasks/bulk" && method === "POST") {
      const actor = api.actorFromHeader(req.headers["x-crew-member"] as string | undefined);
      const raw = await readJsonStr(req);
      const body = parseJson(raw);
      return idempotentSend(req, res, async () => {
        const r = await runChange((c) => api.bulkChange(ctx, c, actor, body));
        if (!r?.noop) broadcast("bulk", r!.result);
        return { status: 200, body: r!.result };
      }, raw, "POST", path);
    }
    if (path === "/api/undo" && method === "POST") {
      const actor = api.actorFromHeader(req.headers["x-crew-member"] as string | undefined);
      const raw = await readJsonStr(req);
      parseJson(raw);
      return idempotentSend(req, res, async () => {
        const r = await runChange((c) => api.undoChange(ctx, c, actor));
        broadcast("undo", r!.result);
        return { status: 200, body: r!.result };
      }, raw, "POST", path);
    }
    const mRel = /^\/api\/tasks\/(STG-(\d+))\/relations$/.exec(path);
    if (mRel && method === "POST") {
      const actor = api.actorFromHeader(req.headers["x-crew-member"] as string | undefined);
      const raw = await readJsonStr(req);
      const body = parseJson(raw);
      const r = await runChange((c) => api.addRelation(ctx, c, actor, Number(mRel[2]), body?.blocks));
      broadcast("relation", r!.result);
      return sendJson(res, 201, r!.result);
    }
    const mRelDel = /^\/api\/tasks\/(STG-(\d+))\/relations\/(STG-(\d+))$/.exec(path);
    if (mRelDel && method === "DELETE") {
      const actor = api.actorFromHeader(req.headers["x-crew-member"] as string | undefined);
      const r = await runChange((c) => api.removeRelation(ctx, c, actor, Number(mRelDel[2]), Number(mRelDel[4])));
      broadcast("relation", r!.result);
      return sendJson(res, 200, r!.result);
    }
    const mAct = /^\/api\/tasks\/(STG-(\d+))\/activity$/.exec(path);
    if (mAct && method === "GET") {
      return sendJson(res, 200, { activity: await db.activityFor(Number(mAct[2])) });
    }
    const mAtt = /^\/api\/tasks\/(STG-(\d+))\/attachments$/.exec(path);
    if (mAtt && method === "GET") {
      return sendJson(res, 200, { attachments: await db.attachmentsFor(Number(mAtt[2])) });
    }
    if (mAtt && method === "POST") {
      const actor = api.actorFromHeader(req.headers["x-crew-member"] as string | undefined);
      return await handleUpload(req, res, Number(mAtt[2]), actor);
    }
    const mDl = /^\/api\/attachments\/([0-9a-fA-F-]{36})\/download$/.exec(path);
    if (mDl && method === "GET") {
      const rows = await pool.query("select * from attachments where id = $1", [mDl[1]]);
      if (rows.rows.length === 0) return sendError(res, 404, "not_found", "No such attachment.");
      const a = rows.rows[0];
      if (!storageUp) return sendError(res, 503, "storage_unavailable", "Plot storage is unreachable.");
      const key = PlotStorage.key(idFromNumber(a.task), a.id, a.file_name);
      if (!(await storage.exists(key))) return sendError(res, 503, "storage_unavailable", "Plot storage is unreachable.");
      res.writeHead(302, { location: await storage.signedLink(key) });
      return void res.end();
    }
    const mDec = /^\/api\/triage\/(STG-(\d+))\/decision$/.exec(path);
    if (mDec && method === "POST") {
      const actor = api.actorFromHeader(req.headers["x-crew-member"] as string | undefined);
      const raw = await readJsonStr(req);
      const body = parseJson(raw);
      return idempotentSend(req, res, async () => {
        let request: import("../domain/types.js").RequestJson | undefined;
        const r = await runChange(async (c) => {
          const d = await api.triageDecision(ctx, c, actor, Number(mDec[2]), body);
          request = d.request;
          return d.outcome;
        });
        const body2: Record<string, unknown> = { ...r!.result, request };
        broadcast("decision", body2);
        return { status: 200, body: body2 };
      }, raw, "POST", path);
    }
    if (path === "/api/requests" && method === "GET") {
      if (!intakeUp) return sendError(res, 503, "intake_unavailable", "Request intake is unreachable.");
      try {
        const list = await intake.list();
        return sendJson(res, 200, { requests: list.map(api.requestToJson) });
      } catch { return sendError(res, 503, "intake_unavailable", "Request intake is unreachable.") }
    }
    if (path === "/api/requests" && method === "POST") {
      const raw = await readJsonStr(req);
      const body = parseJson(raw);
      return idempotentSend(req, res, async () => {
        const fields: Record<string, string> = {};
        const t = typeof body.title === "string" ? body.title.trim() : "";
        if (t.length < 1) fields.title = "Say what you need.";
        else if (t.length > 140) fields.title = "Keep it to 140 characters.";
        if (typeof body.requester !== "string" || body.requester.trim().length < 1) fields.requester = "Add your name.";
        if (Object.keys(fields).length > 0) {
          return { status: 422, body: JSON.parse(errorBody("validation_failed", "Check the highlighted fields.", { fields })) };
        }
        if (!intakeUp) return { status: 503, body: JSON.parse(errorBody("intake_unavailable", "Request intake is unreachable.")) };
        try {
          const rec = await intake.create(t, body.requester.trim(), typeof body.details === "string" ? body.details : "", typeof body.department === "string" ? body.department : "");
          return { status: 201, body: { request: api.requestToJson(rec) } };
        } catch (e) {
          if (e instanceof IntakeRefused) return { status: 502, body: JSON.parse(errorBody("intake_rejected", "Request intake refused the request.")) };
          return { status: 503, body: JSON.parse(errorBody("intake_unavailable", "Request intake is unreachable.")) };
        }
      }, raw, "POST", path);
    }
    return sendError(res, 404, "not_found", "Unknown API path.");
  }

  async function handleUpload(req: http.IncomingMessage, res: http.ServerResponse, taskNumber: number, actor: string): Promise<void> {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.toLowerCase().startsWith("multipart/form-data")) throw new RuleError("unsupported_media_type", 415, {});
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > MULTIPART_LIMIT) return sendError(res, 413, "payload_too_large", "That request is too large.");
    const buf = await readBody(req, MULTIPART_LIMIT);
    const parts = parseMultipart(buf, ct);
    const filePart = parts.find((p) => p.name === "file");
    const kindPart = parts.find((p) => p.name === "kind");
    const fields: Record<string, string> = {};
    if (!filePart) fields.file = "Attach a PDF, PNG or JPEG file.";
    const kind = kindPart?.data.toString("utf8");
    if (kind !== "sketch" && kind !== "plot" && kind !== "rendering") fields.kind = "Choose sketch, plot or rendering.";
    if (filePart && filePart.data.length > UPLOAD_LIMIT) return sendError(res, 413, "payload_too_large", "That request is too large.");
    let contentType: string | null = null;
    if (filePart) {
      contentType = sniffType(filePart.data);
      const declaredType = filePart.contentType.split(";")[0]!.trim();
      if (!contentType || (declaredType !== "application/pdf" && declaredType !== "image/png" && declaredType !== "image/jpeg") || declaredType !== contentType) {
        fields.file = "Attach a PDF, PNG or JPEG file.";
      }
    }
    if (Object.keys(fields).length > 0) {
      return sendError(res, 422, "validation_failed", "Check the highlighted fields.", { fields });
    }
    const task = await db.taskJson(taskNumber);
    if (!task) return sendError(res, 404, "not_found", "No such task.");
    if (!storageUp) return sendError(res, 503, "storage_unavailable", "Plot storage is unreachable.");
    const fileName = filePart!.filename ?? "file";
    let attachmentId: string;
    try {
      attachmentId = await storage.store(task.id, fileName, contentType!, filePart!.data);
    } catch {
      storageUp = false;
      await refreshStatus();
      return sendError(res, 503, "storage_unavailable", "Plot storage is unreachable.");
    }
    try {
      await pool.query(
        "insert into attachments (id, task, file_name, kind, size, content_type, created_at) values ($1,$2,$3,$4,$5,$6,now())",
        [attachmentId, taskNumber, fileName, kind, filePart!.data.length, contentType]);
    } catch (e) {
      await storage.remove(PlotStorage.key(task.id, attachmentId, fileName));
      throw e;
    }
    const client = await pool.connect();
    try {
      const { Engine } = await import("./engine.js");
      const engine = new Engine(client, actor);
      await engine.begin();
      await engine.activity(taskNumber, "attached", { attachments: { from: null, to: fileName } }, actor);
      await engine.finish({ kind: "attachment", direct: new Set(), levels: new Map() });
      await engine.commit();
    } finally { client.release() }
    const attachments = await db.attachmentsFor(taskNumber);
    const attachment = attachments.find((a) => a.id === attachmentId)!;
    broadcast("attachment", { attachment });
    return sendJson(res, 201, { attachment });
  }

  function sniffType(data: Buffer): string | null {
    if (data.length >= 4 && data[0] === 0x25 && data[1] === 0x50) return "application/pdf";
    if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
    return null;
  }

  function parseMultipart(buf: Buffer, contentType: string): { name: string; filename?: string; contentType: string; data: Buffer }[] {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    if (!m) return [];
    const boundary = Buffer.from("--" + (m[1] ?? m[2]!).trim());
    const parts: { name: string; filename?: string; contentType: string; data: Buffer }[] = [];
    let idx = buf.indexOf(boundary);
    while (idx !== -1) {
      const next = buf.indexOf(boundary, idx + boundary.length);
      if (next === -1) break;
      let seg = buf.subarray(idx + boundary.length, next);
      if (seg[0] === 0x0d && seg[1] === 0x0a) seg = seg.subarray(2);
      if (seg.length >= 2 && seg[seg.length - 2] === 0x0d && seg[seg.length - 1] === 0x0a) seg = seg.subarray(0, seg.length - 2);
      const headerEnd = seg.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const headerStr = seg.subarray(0, headerEnd).toString("utf8");
        const data = seg.subarray(headerEnd + 4);
        const nameM = /name="([^"]*)"/.exec(headerStr);
        const fileM = /filename="([^"]*)"/.exec(headerStr);
        const ctM = /content-type:\s*([^\r\n]+)/i.exec(headerStr);
        if (nameM) {
          parts.push({ name: nameM[1]!, filename: fileM?.[1], contentType: ctM?.[1] ?? "application/octet-stream", data });
        }
      }
      idx = next;
    }
    return parts;
  }

  function ruleMessage(code: string): string {
    const messages: Record<string, string> = {
      not_found: "Not found.", precondition_required: "If-Match is required.",
      version_conflict: "Someone else changed that task.", illegal_transition: "That status move isn't allowed.",
      blocked_by_open: "Some tasks are still blocked.", open_subtasks: "Some tasks have open sub-tasks.",
      not_editable: "That task can't be edited.", relation_exists: "That link already exists.",
      relation_cycle: "That link would make a loop.", illegal_relation: "That link isn't allowed.",
      blocks_parent: "A parent can't take blockers or sub-tasks.",
      nothing_to_undo: "Nothing to undo.", undo_stale: "A task changed after that edit.",
      already_decided: "That request was already decided.", intake_unavailable: "Request intake is unreachable.",
      intake_rejected: "Request intake refused the decision.", storage_unavailable: "Plot storage is unreachable.",
      validation_failed: "Check the highlighted fields.", malformed_json: "That JSON isn't valid.",
      unsupported_media_type: "That content type isn't supported.", payload_too_large: "That request is too large.",
      idempotency_key_reused: "That key was used for a different request.", cross_origin: "Cross-origin writes are refused.",
    };
    return messages[code] ?? code;
  }

  server.listen(PORT, "0.0.0.0", () => console.log(`promptside on :${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1) });
