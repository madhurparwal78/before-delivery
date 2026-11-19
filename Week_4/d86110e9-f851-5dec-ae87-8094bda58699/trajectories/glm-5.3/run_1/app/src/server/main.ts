// Server entry: schema, seed data, the HTTP router, the timer/schedule
// loop, and the grading routes.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { CONFIG, STEP_KINDS, TRIGGER_KINDS, KIND_LABELS, GRID_COLS, GRID_ROWS } from "./config.js";
import { db, migrate, getPool } from "./db.js";
import { ApiError, Errors } from "./errors.js";
import { cookies, isSameOrigin, parseJsonBody, requireObject, send } from "./http.js";
import type { Ctx } from "./http.js";
import { sessions, users, workspaces, invites, automations, stepsRepo, edgesRepo, countersRepo, runsRepo, runStepsRepo, tablesRepo, timersRepo, versionsRepo, idemKeys, editHolds } from "./repo.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { newRunId, newToken } from "./ids.js";
import { seed } from "./seed.js";
import * as R from "./routes.js";
import { PORT, fireTimer, startRun, versionContent, draftContent } from "./engine.js";
import { runDueTimers, runDueSchedules } from "./loop.js";
import { pushDrainCount } from "./push.js";

const here = dirname(fileURLToPath(import.meta.url));
const STATIC = join(here, "static");

// ------------------------------------------------------------- route table

type H = (ctx: Ctx) => Promise<void>;
interface Rule { m: string; re: RegExp; keys: string[]; h: H; opts?: { raw?: boolean; noJson?: boolean; publicPath?: boolean } }

function rule(m: string, pattern: string, h: H, opts?: Rule["opts"]): Rule {
  const keys: string[] = [];
  const re = new RegExp("^" + pattern.replace(/\{(\w+)\}/g, (_s, k) => {
    keys.push(k);
    return "([^/]+)";
  }) + "$");
  return { m, re, keys, h, opts };
}

const ROUTES: Rule[] = [
  rule("POST", "/api/auth/sign-up", R.signUp, { publicPath: true }),
  rule("POST", "/api/auth/confirm", R.confirm, { publicPath: true }),
  rule("POST", "/api/auth/sign-in", R.signIn, { publicPath: true }),
  rule("POST", "/api/auth/sign-out", R.signOut, { publicPath: true }),
  rule("GET", "/api/me", R.me),
  rule("GET", "/api/invites/{token}", R.inviteInfo, { publicPath: true }),
  rule("POST", "/api/invites/{token}/accept", R.inviteAccept, { publicPath: true }),
  rule("GET", "/api/workspaces/{ws}", R.wsInfo),
  rule("GET", "/api/workspaces/{ws}/members", R.membersList),
  rule("POST", "/api/workspaces/{ws}/invites", R.inviteCreate),
  rule("GET", "/api/workspaces/{ws}/tables", R.tablesList),
  rule("POST", "/api/workspaces/{ws}/tables", R.tablesCreate),
  rule("GET", "/api/workspaces/{ws}/tables/{tid}", R.tableDetail),
  rule("POST", "/api/workspaces/{ws}/tables/{tid}/rows", R.tableRowAdd),
  rule("GET", "/api/workspaces/{ws}/automations", R.autosList),
  rule("POST", "/api/workspaces/{ws}/automations", R.autosCreate),
  rule("GET", "/api/workspaces/{ws}/automations/{aid}", R.autoDetail),
  rule("POST", "/api/workspaces/{ws}/automations/{aid}/draft/steps", R.stepCreate),
  rule("PUT", "/api/workspaces/{ws}/automations/{aid}/draft/steps/{sid}", R.stepUpdate),
  rule("DELETE", "/api/workspaces/{ws}/automations/{aid}/draft/steps/{sid}", R.stepDelete),
  rule("POST", "/api/workspaces/{ws}/automations/{aid}/draft/edges", R.edgeCreate),
  rule("DELETE", "/api/workspaces/{ws}/automations/{aid}/draft/edges/{eid}", R.edgeDelete),
  rule("POST", "/api/workspaces/{ws}/automations/{aid}/publish", R.publish),
  rule("GET", "/api/workspaces/{ws}/automations/{aid}/versions", R.versionsList),
  rule("GET", "/api/workspaces/{ws}/automations/{aid}/versions/{n}", R.versionDetail),
  rule("POST", "/api/workspaces/{ws}/automations/{aid}/versions/{n}/export", R.exportVersion),
  rule("POST", "/api/workspaces/{ws}/imports", R.importAutomation, { raw: true }),
  rule("POST", "/api/workspaces/{ws}/automations/{aid}/runs", R.runCreate),
  rule("GET", "/api/workspaces/{ws}/runs", R.runsList),
  rule("GET", "/api/workspaces/{ws}/runs/{rid}", R.runDetail),
  rule("POST", "/api/workspaces/{ws}/runs/{rid}/cancel", R.runCancel),
  rule("POST", "/api/workspaces/{ws}/runs/{rid}/replay", R.runReplay),
  rule("GET", "/api/workspaces/{ws}/events", R.eventsStream),
  rule("POST", "/api/forms/{slug}/{path}", R.formSubmit, { publicPath: true }),
  rule("POST", "/hooks/{slug}/{path}", R.hookReceive, { raw: true, publicPath: true }),
  rule("GET", "/api/health", R.health, { publicPath: true }),
  rule("POST", "/api/grading/setup", gradingSetup, { publicPath: true }),
  rule("POST", "/api/grading/workspaces/{id}/clock", gradingClock, { publicPath: true }),
];

// ------------------------------------------------------------------ request

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    // grading key guard
    if (path.startsWith("/api/grading/")) {
      const key = req.headers["x-grading-key"];
      if (key !== CONFIG.gradingKey) {
        send(res, 404, { error: "Not found" });
        return;
      }
    }

    if (path.startsWith("/api/") || path.startsWith("/hooks/")) {
      await handleApi(req, res, url, method);
      return;
    }
    await serveStatic(req, res, path, method);
  } catch (e) {
    if (e instanceof ApiError) {
      send(res, e.status, { error: e.message, ...e.extra });
    } else {
      send(res, 500, { error: "Not found" });
    }
  }
});


// Does any live webhook automation answer this hook path?
async function hookPathExists(path: string): Promise<boolean> {
  const m = /^\/hooks\/([^/]+)\/(.+)$/.exec(path);
  if (!m) return false;
  const ws = await workspaces.bySlug(db, decodeURIComponent(m[1]));
  if (!ws) return false;
  const autos = await automations.listForWs(db, ws.id);
  for (const a of autos) {
    if (a.trigger_kind !== "webhook" || a.live_version === null) continue;
    const v = await versionsRepo.get(db, a.id, a.live_version);
    if (v && String(v.content.trigger.fields.path ?? "") === decodeURIComponent(m[2])) return true;
  }
  return false;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<void> {
  const path = url.pathname;
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  const cookie = cookies(req);
  const token = cookie["switchyard_session"] ?? null;
  const userId = token ? await sessions.userIdOf(db, token) : null;

  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (r.m !== method) {
      // a hook path that a live automation answers replies 405 for other
      // methods; an unknown path still falls through to 404 below
      if (path.startsWith("/hooks/") && r.m === "POST" && await hookPathExists(path)) {
        res.setHeader("Allow", "POST");
        send(res, 405, { error: "Method not allowed" });
        return;
      }
      continue;
    }
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

    // cross-origin guard
    if (method !== "GET" && method !== "HEAD" && !r.opts?.publicPath && !isSameOrigin(req)) {
      send(res, 403, { error: "Cross-origin request refused" });
      return;
    }

    // auth
    if (!r.opts?.publicPath && path !== "/api/health" && !userId) {
      send(res, 401, { error: "Sign in required" });
      return;
    }

    let body: unknown = undefined;
    let rawBody: Buffer<ArrayBuffer> = Buffer.alloc(0);
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      rawBody = Buffer.from(await readRaw(req, path.startsWith("/hooks/") ? CONFIG.webhookBodyLimit + 1 : (path.includes("/imports") ? 262145 : 65537)));
      if (!r.opts?.raw && rawBody.length > 0) {
        const ct = (req.headers["content-type"] ?? "").split(";")[0].trim();
        if (ct !== "application/json") {
          send(res, 415, { error: "Content type must be application/json" });
          return;
        }
        try {
          body = parseJsonBody(rawBody);
        } catch (e) {
          if (e instanceof ApiError) { send(res, e.status, { error: e.message }); return; }
          throw e;
        }
      }
    }
    const ctx: Ctx = {
      req, res, method, url, query, params, body, rawBody,
      session: token, userId, db,
    };
    try {
      await r.h(ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        send(res, e.status, { error: e.message, ...e.extra });
      } else {
        console.error("route error", path, e);
        send(res, 500, { error: "Not found" });
      }
    }
    return;
  }
  // unknown API path
  send(res, 404, { error: "Not found" });
}

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > limit) { over = true; return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(over ? Buffer.alloc(limit + 1) : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ------------------------------------------------------------------ static

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<void> {
  if (method !== "GET" && method !== "HEAD") {
    send(res, 404, { error: "Not found" });
    return;
  }
  let file = path;
  if (file.startsWith("/assets/")) {
    const p = join(STATIC, file.slice("/assets/".length));
    if (existsSync(p)) {
      const ext = p.slice(p.lastIndexOf("."));
      res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(readFileSync(p));
      return;
    }
  }
  // app shell for every non-API address
  const shell = shellHtml();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(shell);
}

function shellHtml(): string {
  const p = join(STATIC, "index.html");
  let html = readFileSync(p, "utf8");
  const boot = `window.__SHELL__=${JSON.stringify({
    breakpoint: CONFIG.canvasBreakpointPx,
    timeZone: CONFIG.timeZone,
    publicUrl: CONFIG.publicUrl,
  })};`;
  html = html.replace("__SHELL__", boot).replace("__BOOT__", boot);
  return html;
}

// ----------------------------------------------------------- grading routes

async function gradingSetup(ctx: Ctx): Promise<void> {
  const b = requireObject(ctx.body);
  const out: Record<string, unknown> = { users: {}, workspaces: {} };
  const userByKey = new Map<string, string>();
  const usersArr = Array.isArray(b.users) ? b.users as Record<string, unknown>[] : [];
  for (const u of usersArr) {
    const key = String(u.key ?? "");
    const email = String(u.email ?? "").toLowerCase();
    const name = String(u.name ?? "");
    const password = String(u.password ?? "");
    const existing = await users.byEmail(db, email);
    if (existing) {
      send(ctx.res, 409, { error: "Email already exists" });
      return;
    }
    const created = await users.create(db, email, name, password, true);
    userByKey.set(key, created.id);
    const sess = await sessions.create(db, created.id);
    (out.users as Record<string, unknown>)[key] = { id: created.id, cookie: sess };
  }
  const wsArr = Array.isArray(b.workspaces) ? b.workspaces as Record<string, unknown>[] : [];
  for (const w of wsArr) {
    const key = String(w.key ?? "");
    const name = String(w.name ?? "");
    const id = typeof w.id === "string" && w.id ? w.id : "ws-" + randomBytes(4).toString("hex");
    let slug = String(w.slug ?? "") || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const existing = await db.query("SELECT id FROM workspaces WHERE slug=$1", [slug]);
    if (existing.rows.length > 0 && existing.rows[0].id !== id) slug = slug + "-" + randomBytes(2).toString("hex");
    await db.query(
      `INSERT INTO workspaces (id,name,slug,clock_offset_seconds) VALUES ($1,$2,$3,0)
       ON CONFLICT (id) DO UPDATE SET name=$2, slug=$3`,
      [id, name, slug]
    );
    const wsOut: Record<string, unknown> = { id, slug, tables: {}, automations: {} };
    // clock first
    const clock = w.clock as Record<string, unknown> | undefined;
    if (clock && typeof clock.set === "string") {
      const target = new Date(clock.set).getTime();
      const offset = Math.round((target - Date.now()) / 1000);
      await db.query("UPDATE workspaces SET clock_offset_seconds=$1 WHERE id=$2", [offset, id]);
    }
    // members
    const memArr = Array.isArray(w.members) ? w.members as Record<string, unknown>[] : [];
    for (const mem of memArr) {
      const uid = userByKey.get(String(mem.user ?? ""));
      if (!uid) continue;
      await db.query(
        "INSERT INTO members (user_id,workspace_id,role,joined_at) VALUES ($1,$2,$3,now()) ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=$3",
        [uid, id, String(mem.role ?? "editor")]
      );
    }
    // tables
    const tblArr = Array.isArray(w.tables) ? w.tables as Record<string, unknown>[] : [];
    for (const t of tblArr) {
      const tKey = String(t.key ?? "");
      const tid = typeof t.id === "string" && t.id ? t.id : "tb-" + randomBytes(4).toString("hex");
      const cols = (t.columns ?? []) as { name: string; type: string }[];
      await db.query(
        `INSERT INTO tables_ (id,workspace_id,name,columns,seq) VALUES ($1,$2,$3,$4::jsonb,(SELECT COALESCE(MAX(seq),0)+1 FROM tables_ WHERE workspace_id=$2))
         ON CONFLICT (id) DO UPDATE SET name=$3, columns=$4::jsonb`,
        [tid, id, String(t.name ?? ""), JSON.stringify(cols)]
      );
      await db.query("DELETE FROM table_rows WHERE table_id=$1", [tid]);
      const rows = Array.isArray(t.rows) ? t.rows as Record<string, unknown>[] : [];
      let seq = 1;
      for (const row of rows) {
        const rid = "r" + seq;
        await db.query("INSERT INTO table_rows (table_id,row_id,seq,values) VALUES ($1,$2,$3,$4::jsonb)", [tid, rid, seq, JSON.stringify(row)]);
        seq++;
      }
      (wsOut.tables as Record<string, unknown>)[tKey] = { id: tid };
    }
    // automations
    const auArr = Array.isArray(w.automations) ? w.automations as Record<string, unknown>[] : [];
    for (const au of auArr) {
      const aKey = String(au.key ?? "");
      const aid = typeof au.id === "string" && au.id ? au.id : "au-" + randomBytes(4).toString("hex");
      const name = String(au.name ?? "");
      const versions = Array.isArray(au.versions) ? au.versions as Record<string, unknown>[] : [];
      const draft = au.draft as Record<string, unknown> | undefined;
      if (versions.length === 0 && !draft) {
        send(ctx.res, 422, { error: "At least one version or draft is required" });
        return;
      }
      const first = (versions[0] ?? draft!) as Record<string, unknown>;
      const trig0 = first.trigger as Record<string, unknown>;
      const kind0 = String(trig0.kind ?? "");
      await db.query(
        `INSERT INTO automations (id,workspace_id,name,trigger_kind,live_version,draft_revision) VALUES ($1,$2,$3,$4,NULL,1)
         ON CONFLICT (id) DO UPDATE SET name=$3, trigger_kind=$4, live_version=NULL, draft_revision=1`,
        [aid, id, name, kind0]
      );
      const aOut: Record<string, unknown> = { id: aid, versions: [], runs: {} };
      // publish each version through the normal checks
      for (let vi = 0; vi < versions.length; vi++) {
        const ve = versions[vi] as Record<string, unknown>;
        const content = await contentFromGrading(ve);
        const verr = validateForPublish(content);
        if (verr) {
          send(ctx.res, 422, { error: verr.error, step_id: verr.step_id });
          return;
        }
        const version = vi + 1;
        const now = new Date(Date.now() + 0);
        await versionsRepo.put(db, aid, version, 1 + vi, now, content);
        await db.query("UPDATE automations SET live_version=$1 WHERE id=$2", [version, aid]);
        (aOut.versions as number[]).push(version);
        // schedule anchoring: the first firing is after the publish moment,
        // which is the workspace clock (the grading clock was applied first)
        if (content.trigger.kind === "schedule") {
          const spec = parseSchedule(String(content.trigger.fields.schedule ?? ""));
          if (spec) {
            const offR = await db.query("SELECT clock_offset_seconds AS o FROM workspaces WHERE id=$1", [id]);
            const anchorMs = Date.now() + Number(offR.rows[0].o) * 1000;
            const next = nextAfter(spec, anchorMs);
            await db.query("UPDATE automations SET next_fire_at=$1 WHERE id=$2", [new Date(next), aid]);
          }
        }
      }
      // draft defaults to last version content
      const draftContentSrc = draft ?? versions[versions.length - 1];
      const dContent = await contentFromGrading(draftContentSrc as Record<string, unknown>);
      await db.query("DELETE FROM steps WHERE automation_id=$1 AND version=0", [aid]);
      await db.query("DELETE FROM edges WHERE automation_id=$1 AND version=0", [aid]);
      await writeContentToDraft(aid, dContent);
      // runs
      const runsArr = Array.isArray(au.runs) ? au.runs as Record<string, unknown>[] : [];
      for (const rspec of runsArr) {
        const rKey = String(rspec.key ?? "");
        const version = Number(rspec.version ?? 1);
        const input = (rspec.input ?? {}) as Record<string, unknown>;
        const recorded = rspec.recorded as Record<string, unknown> | undefined;
        if (recorded) {
          const rid = await insertRecordedRun(id, aid, version, input, recorded);
          (aOut.runs as Record<string, string>)[rKey] = rid;
        } else {
          const run = await startRun({ wsId: id, aid, version, test: false, triggerOutput: input });
          (aOut.runs as Record<string, string>)[rKey] = run.id;
        }
      }
      (wsOut.automations as Record<string, unknown>)[aKey] = aOut;
    }
    (out.workspaces as Record<string, unknown>)[key] = wsOut;
  }
  send(ctx.res, 200, out);
}

async function writeContentToDraft(aid: string, content: import("./graph.js").AutomationContent): Promise<void> {
  await stepsRepo.insert(db, aid, null, { ...content.trigger, seq: 1 } as never, content.trigger.sample);
  let seq = 2;
  for (const s of content.steps) {
    await stepsRepo.insert(db, aid, null, { ...s, seq } as never);
    seq++;
  }
  let ei = 1;
  for (const e of content.edges) {
    await edgesRepo.insert(db, aid, null, { ...e, id: "e" + ei++ });
  }
}

async function contentFromGrading(ve: Record<string, unknown>): Promise<import("./graph.js").AutomationContent> {
  const trig = ve.trigger as Record<string, unknown>;
  const steps = (ve.steps ?? []) as Record<string, unknown>[];
  const edges = (ve.edges ?? []) as Record<string, unknown>[];
  const kind = String(trig.kind ?? "");
  return {
    trigger: {
      id: "trigger", kind, name: String(trig.name ?? "") || (KIND_LABELS[kind] ?? kind),
      col: Number(trig.col ?? 1), row: Number(trig.row ?? 2),
      fields: (trig.fields ?? {}) as Record<string, unknown>,
      sample: (trig.sample ?? {}) as Record<string, unknown>,
    },
    steps: steps.map((s) => ({
      id: String(s.id ?? ""), kind: String(s.kind ?? ""), name: String(s.name ?? ""),
      col: Number(s.col ?? 1), row: Number(s.row ?? 2), fields: (s.fields ?? {}) as Record<string, unknown>,
    })),
    edges: edges.map((e, i) => ({
      id: "e" + (i + 1), from: String(e.from ?? ""), port: String(e.port ?? "out"),
      to: String(e.to ?? ""), order: Number(e.order ?? i + 1),
    })),
  };
}

import { validateForPublish } from "./validate.js";
import { parseSchedule, nextAfter } from "./schedule.js";

async function insertRecordedRun(wsId: string, aid: string, version: number, input: Record<string, unknown>, recorded: Record<string, unknown>): Promise<string> {
  const content = await versionContent(db, aid, version);
  const number = await runsRepo.nextNumber(db, aid);
  const rid = newRunId();
  const status = String(recorded.status ?? "failed");
  const failedStep = typeof recorded.failed_step === "string" ? recorded.failed_step : null;
  const now = new Date();
  await db.query(
    `INSERT INTO runs (id,workspace_id,automation_id,number,status,test,version,replay_of,owner_port,started_at,finished_at,trigger_output,message)
     VALUES ($1,$2,$3,$4,$5,false,$6,NULL,$7,$8,$8,$9::jsonb,$10)`,
    [rid, wsId, aid, number, status, version, PORT, now, JSON.stringify(input), null]
  );
  const recSteps = (recorded.steps ?? {}) as Record<string, Record<string, unknown>>;
  const order = executionOrder(content);
  let ord = 0;
  for (const id of order) {
    const node = id === "trigger" ? content.trigger : content.steps.find((s) => s.id === id)!;
    let sstatus = "skipped";
    let output: unknown = null;
    let reused = false;
    let attempts = 0;
    const rec = recSteps[id];
    if (id === "trigger") {
      sstatus = "succeeded";
      output = input;
      attempts = 1;
    } else if (rec) {
      sstatus = String(rec.status ?? "succeeded");
      output = rec.output ?? {};
      reused = false;
      attempts = 1;
    }
    await db.query(
      `INSERT INTO run_steps (run_id,step_id,kind,name,col,row,status,reused,input,output,log,attempts,started_at,finished_at,ord)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'[]'::jsonb,$11,$12,$12,$13)`,
      [rid, id, node.kind, node.name, node.col, node.row, sstatus, reused,
       JSON.stringify(id === "trigger" ? {} : node.fields),
       JSON.stringify(output), attempts, now, ord]
    );
    ord++;
  }
  // run message as for a real failure
  if (status === "failed" && failedStep) {
    const node = content.steps.find((s) => s.id === failedStep);
    const rec = recSteps[failedStep];
    const total = CONFIG.retryCount + 1;
    const message = `Step ${failedStep} failed after ${total} attempts: ${String(rec?.message ?? "Step failed")}`;
    await db.query("UPDATE runs SET message=$1 WHERE id=$2", [message, rid]);
    void node;
  }
  return rid;
}

import { executionOrder } from "./graph.js";

async function gradingClock(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.id;
  const ws = await workspaces.byId(db, wsId);
  if (!ws) throw Errors.notFound();
  const b = requireObject(ctx.body);
  const hasAdv = b.advance_seconds !== undefined;
  const hasSet = b.set !== undefined;
  if (hasAdv === hasSet) throw Errors.clockBody();
  const curOffset = Number((await db.query("SELECT clock_offset_seconds AS o FROM workspaces WHERE id=$1", [wsId])).rows[0].o);
  let newOffset = curOffset;
  if (hasAdv) {
    const n = b.advance_seconds;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw Errors.clockBody();
    newOffset = curOffset + n;
  } else {
    const t = new Date(String(b.set));
    if (Number.isNaN(t.getTime())) throw Errors.clockBody();
    newOffset = Math.round((t.getTime() - Date.now()) / 1000);
  }
  if (hasSet && newOffset < curOffset) {
    // setting earlier fires nothing
    await db.query("UPDATE workspaces SET clock_offset_seconds=$1 WHERE id=$2", [newOffset, wsId]);
    const now = new Date(Date.now() + newOffset * 1000);
    send(ctx.res, 200, { now: now.toISOString(), offset_seconds: newOffset });
    return;
  }
  await db.query("UPDATE workspaces SET clock_offset_seconds=$1 WHERE id=$2", [newOffset, wsId]);
  await (await import("./clock.js")).invalidateWs(wsId);
  // Fire every due timer owned by this instance, in time order, until none
  // is left (a resumed run can schedule the next retry timer immediately).
  for (let i = 0; i < 200; i++) {
    await runDueTimers(newOffset);
    const remaining = await db.query(
      "SELECT COUNT(*) AS c FROM timers WHERE fired=false AND owner_port=$1 AND due_at<=$2",
      [PORT, new Date(Date.now() + newOffset * 1000)]
    );
    if (Number(remaining.rows[0].c) === 0) break;
  }
  await runDueSchedules(newOffset);
  const now = new Date(Date.now() + newOffset * 1000);
  send(ctx.res, 200, { now: now.toISOString(), offset_seconds: newOffset });
}

// ------------------------------------------------------------- timers loop

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await runDueTimers(null);
    await runDueSchedules(null);
  } catch {
    // keep serving
  } finally {
    ticking = false;
  }
}

setInterval(() => { void tick(); }, CONFIG.scheduleTickSeconds * 1000);

// ------------------------------------------------------------------- start

async function boot(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      await migrate(db);
      break;
    } catch (e) {
      if (Date.now() > deadline) {
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await seed(db);
  server.listen(CONFIG.port, "0.0.0.0", () => {
    process.stdout.write(`listening on ${CONFIG.port}\n`);
  });
}

void boot();
