import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { loadConfig, type Config } from "./config.js";
import { connectWithRetry, type Db } from "./db.js";
import { Storage } from "./storage.js";
import { newId } from "./ids.js";
import { ApiError, errorBody, readSession, requireUser, userProjectRole, projectRoleOr404, requireRole, type Role } from "./auth.js";
import { RateLimiter, createSession, destroySession, hashPassword, parseSessionCookie, passwordValid, sessionUser, usernameValid, verifyPassword, SESSION_COOKIE } from "./accounts.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerWorkbookRoutes } from "./routes/workbooks.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerGradingRoutes } from "./routes/grading.js";
import { seedHomeSample } from "./sample.js";

export interface AppState {
  db: Db;
  storage: Storage;
  config: Config;
  loginLimiter: RateLimiter;
  formulaLimiter: RateLimiter;
  queryLimiter: RateLimiter;
  started: boolean;
  /** Server clock, which grading may set or advance. */
  clockOffset: number;
  clockFixed: number | null;
  events: EventHub;
}

export interface SseClient {
  userId: string;
  send: (event: string, data: string) => void;
}

export class EventHub {
  private clients = new Set<SseClient>();

  add(client: SseClient): void {
    this.clients.add(client);
  }

  remove(client: SseClient): void {
    this.clients.delete(client);
  }

  /** Extract events go only to the owner. */
  emitToUser(userId: string, event: string, data: string): void {
    for (const c of this.clients) {
      if (c.userId === userId) c.send(event, data);
    }
  }

  emitToUsers(userIds: Set<string>, event: string, data: string): void {
    for (const c of this.clients) {
      if (userIds.has(c.userId)) c.send(event, data);
    }
  }
}

declare module "fastify" {
  interface FastifyInstance {
    state: import("./auth.js").AppState;
  }
  interface FastifyRequest {
    appState: import("./auth.js").AppState;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const storage = new Storage(config);

  const app = Fastify({
    logger: false,
    bodyLimit: 100 * 1024 * 1024,
  });
  app.addContentTypeParser("text/csv", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  // Health answers 'starting' until PostgreSQL is reachable.
  let dbReady = false;
  let db: Db | null = null;
  const state: AppState = {
    get db(): Db {
      if (!db) throw new ApiError(503, "starting");
      return db;
    },
    storage,
    config,
    loginLimiter: new RateLimiter(config.loginRate),
    formulaLimiter: new RateLimiter(config.formulaRate),
    queryLimiter: new RateLimiter(config.queryRate),
    started: false,
    clockOffset: 0,
    clockFixed: null,
    events: new EventHub(),
  };
  app.decorate("state", state);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { appState: AppState }).appState = state;
  });

  // The server clock: business time comes only from the server.
  const realNow = (): number => Date.now();
  exportServerNow(app);
  function serverNow(): number {
    if (state.clockFixed !== null) return state.clockFixed + state.clockOffset;
    return realNow() + state.clockOffset;
  }

  app.addHook("onRequest", async (req, reply) => {
    (req as unknown as { session?: string }).session = parseSessionCookie(req.headers.cookie);
    if (req.url.startsWith("/api/")) {
      const c = req.headers["content-type"] ?? "";
      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
        if (c.includes("application/json") || c.includes("text/csv") || c === "") {
          // allowed
        } else if (!c.includes("application/json") && !c.includes("text/csv")) {
          return reply.code(415).send(errorBody("unsupported_media_type"));
        }
      }
    }
  });

  // Body size limits by route kind: JSON at 1,000,000 bytes, CSV at
  // LOZ_CSV_MAX_BYTES. Exactly the limit is allowed.
  app.addHook("preParsing", async (req, reply, payload) => {
    const url = req.url.split("?")[0];
    const contentType = req.headers["content-type"] ?? "";
    // The preview route answers its own 413 with the full preview shape.
    const isCsvRoute = url.endsWith("/sources") || (url.includes("/sources/") && url.includes("/tables"));
    const isCsvBody = contentType.includes("text/csv");
    const declared = Number(req.headers["content-length"] ?? "0");
    if (isCsvBody) {
      if (isCsvRoute && declared > config.csvMaxBytes) {
        reply.code(413);
        return reply.send(errorBody("too_large"));
      }
      return payload;
    }
    if (declared > 1000000) {
      reply.code(413);
      return reply.send(errorBody("too_large"));
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      const headers = err.headers ?? {};
      for (const [k, v] of Object.entries(headers)) reply.header(k, v);
      reply.code(err.status).send(errorBody(err.code, err.errors));
      return;
    }
    if ((err as { statusCode?: number }).statusCode === 413) {
      reply.code(413).send(errorBody("too_large"));
      return;
    }
    if ((err as { statusCode?: number }).statusCode === 415) {
      reply.code(415).send(errorBody("unsupported_media_type"));
      return;
    }
    if ((err as { code?: string }).code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      reply.code(415).send(errorBody("unsupported_media_type"));
      return;
    }
    console.error("Internal error on", req.method, req.url, err);
    reply.code(500).send(errorBody("internal_error"));
  });

  // Platform routes
  app.get("/api/health", async (_req, reply) => {
    if (!dbReady) return reply.code(503).send({ status: "starting" });
    const up = await storage.check();
    return reply.send({ status: up ? "ok" : "unavailable" });
  });

  app.get("/api/config", async () => ({
    formula_max_chars: config.formulaMaxChars,
    formula_max_depth: config.formulaMaxDepth,
    mark_max: config.markMax,
    formula_debounce_ms: config.formulaDebounceMs,
    row_max: config.rowMax,
    csv_max_bytes: config.csvMaxBytes,
    sse_heartbeat_ms: config.sseHeartbeatMs,
  }));

  app.get("/api/time", async () => ({ server_now: new Date(serverNow()).toISOString() }));

  // The home page's live sample sheet needs no account.
  app.post("/api/sample/query", async () => {
    const { loadSource } = await import("./sample.js");
    const res = await state.db.query("SELECT id FROM sources WHERE name = 'Fernhollow Tea' AND project_id IS NULL LIMIT 1");
    const sourceId = res.rows[0]?.id;
    if (!sourceId) return { chart: "none", columns: [], rows: [], total: null, reference_lines: [], trend: null, notices: [] };
    const source = await loadSource(state.db, sourceId);
    if (!source) return { chart: "none", columns: [], rows: [], total: null, reference_lines: [], trend: null, notices: [] };
    const { buildView } = await import("./query/view.js");
    const { cellValue } = await import("./query/core.js");
    const fields = source.fields.map((f) => ({
      id: f.id,
      name: f.name,
      table: f.table,
      type: f.type,
      kind: f.kind,
      continuous: f.continuous,
      hidden: f.hidden,
      origin: f.origin,
    }));
    const rows = (source.rows as { values: Record<string, string | null> }[]).map((jr) => {
      const values = new Map<string, import("./formula/evaluator.js").Value>();
      for (const f of fields) values.set(f.name, cellValue(f.type, jr.values[f.name] ?? null));
      return { values };
    });
    const ctx = {
      fields,
      calcs: [],
      parameters: new Map(),
      sets: new Map(),
      rows,
      rightTable: source.relation?.right_table ?? null,
      rightKeyField: source.relation?.right_key ?? null,
    };
    const view = buildView(
      {
        name: "Sample",
        rows: ["Region"],
        columns: [{ field: "Sales", agg: "SUM" }],
        color: null,
        size: null,
        label: [],
        detail: [],
        filters: [{ field: "Region", step: "source", values: ["East", "North", "South", "West"] }],
        chart: "automatic",
        totals: false,
        reference_lines: [],
        trend: false,
        sort: {},
      },
      ctx,
      [],
      { workMax: config.queryWorkMax, markMax: config.markMax },
      Date.now() + config.queryBudgetMs,
    );
    return {
      chart: view.chart,
      columns: [
        ...view.dims.map((d) => ({ name: d.field, role: "dimension" })),
        ...view.measures.map((m) => ({ name: m.caption, role: "measure" })),
      ],
      rows: view.marks.map((m) => [...m.dimValues, ...m.values]),
      total: view.total,
      reference_lines: view.refLines,
      trend: view.trend,
      notices: [],
    };
  });

  // SSE
  app.get("/api/events", async (req, reply) => {
    const user = await requireUser(req);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const client: SseClient = {
      userId: user.id,
      send: (event, data) => {
        try {
          reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
        } catch {
          state.events.remove(client);
        }
      },
    };
    state.events.add(client);
    // On every connection first send clock, extracts and inbox.
    client.send("clock", JSON.stringify({ server_now: new Date(serverNow()).toISOString() }));
    for (const s of await readableSources(state.db, user.id)) {
      client.send("extract", JSON.stringify(await extractPayload(state.db, s.id)));
    }
    const unread = await unreadCount(state.db, user.id);
    client.send("inbox", JSON.stringify({ unread }));
    // A comment line heartbeat every LOZ_SSE_HEARTBEAT_MS.
    const timer = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        clearInterval(timer);
      }
    }, config.sseHeartbeatMs);
    reply.raw.on("close", () => {
      clearInterval(timer);
      state.events.remove(client);
    });
  });

  // Accounts
  app.post("/api/auth/register", async (req, reply) => {
    const body = req.body as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const errors: Record<string, string> = {};
    if (!usernameValid(username)) errors.username = "Username must be 3 to 24 letters, digits or _.";
    if (!passwordValid(password)) errors.password = "Password must be at least 8 characters.";
    if (Object.keys(errors).length > 0) throw new ApiError(422, "invalid_input", errors);
    const exists = await state.db.query("SELECT id FROM users WHERE username = $1", [username]);
    if (exists.rows.length > 0) {
      throw new ApiError(409, "username_taken", { username: "That username is taken." });
    }
    const id = newId();
    await state.db.query("INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)", [id, username, hashPassword(password)]);
    const token = await createSession(state.db, id);
    reply.header("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return reply.code(201).send({ user: { id, username } });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const now = serverNow();
    const body = req.body as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const gate = state.loginLimiter.take(username || "(none)", now);
    if (!gate.allowed) {
      throw new ApiError(429, "rate_limited", undefined, { "Retry-After": String(gate.retryAfter) });
    }
    const res = await state.db.query("SELECT id, username, password_hash FROM users WHERE username = $1", [username]);
    const row = res.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new ApiError(401, "invalid_credentials");
    }
    const token = await createSession(state.db, row.id);
    reply.header("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return reply.send({ user: { id: row.id, username: row.username } });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = readSession(req);
    if (token) await destroySession(state.db, token);
    reply.header("set-cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return reply.code(204).send();
  });

  app.get("/api/me", async (req) => {
    const user = await requireUser(req);
    const projects = await state.db.query(
      "SELECT p.id, p.name, m.role FROM projects p JOIN members m ON m.project_id = p.id WHERE m.user_id = $1 ORDER BY p.name",
      [user.id],
    );
    return { user, projects: projects.rows };
  });

  // Projects
  app.post("/api/projects", async (req, reply) => {
    const user = await requireUser(req);
    const body = req.body as { name?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    if (!name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
    const id = newId();
    await state.db.query("INSERT INTO projects (id, name, explorers_schedule) VALUES ($1, $2, false)", [id, name]);
    await state.db.query("INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, 'creator')", [id, user.id]);
    return reply.code(201).send({ id, name, role: "creator", explorers_schedule: false });
  });

  app.get("/api/projects/:id", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const role = await projectRoleOr404(state.db, user.id, id);
    const proj = await state.db.query("SELECT id, name, explorers_schedule FROM projects WHERE id = $1", [id]);
    const members = await state.db.query(
      "SELECT u.username, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY u.username",
      [id],
    );
    const sources = await state.db.query("SELECT id, name FROM sources WHERE project_id = $1 ORDER BY name", [id]);
    const workbooks = await state.db.query("SELECT id, name, state, certified_by FROM workbooks WHERE project_id = $1 ORDER BY name", [id]);
    return {
      id: proj.rows[0].id,
      name: proj.rows[0].name,
      role,
      explorers_schedule: proj.rows[0].explorers_schedule,
      members: members.rows,
      sources: sources.rows,
      workbooks: role === "viewer" || role === "explorer" ? workbooks.rows.filter((w) => w.state === "published") : workbooks.rows,
    };
  });

  app.patch("/api/projects/:id", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const role = await projectRoleOr404(state.db, user.id, id);
    requireRole(role, "creator");
    const body = req.body as { explorers_schedule?: unknown };
    const val = typeof body.explorers_schedule === "boolean" ? body.explorers_schedule : undefined;
    if (val === undefined) throw new ApiError(422, "invalid_input", { explorers_schedule: "Name is required." });
    await state.db.query("UPDATE projects SET explorers_schedule = $1 WHERE id = $2", [val, id]);
    const proj = await state.db.query("SELECT id, name, explorers_schedule FROM projects WHERE id = $1", [id]);
    return { id, name: proj.rows[0].name, explorers_schedule: proj.rows[0].explorers_schedule };
  });

  app.put("/api/projects/:id/members/:username", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const username = (req.params as { username: string }).username.toLowerCase();
    const role = await projectRoleOr404(state.db, user.id, id);
    requireRole(role, "creator");
    const body = req.body as { role?: unknown };
    const newRole = body.role;
    if (newRole !== "viewer" && newRole !== "explorer" && newRole !== "creator") {
      throw new ApiError(422, "invalid_input", { role: "No such role." });
    }
    const target = await state.db.query("SELECT id FROM users WHERE username = $1", [username]);
    if (target.rows.length === 0) throw new ApiError(422, "invalid_input", { username: "No such user." });
    await state.db.query(
      "INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3",
      [id, target.rows[0].id, newRole],
    );
    return { username, role: newRole };
  });

  app.delete("/api/projects/:id/members/:username", async (req, reply) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const username = (req.params as { username: string }).username.toLowerCase();
    const role = await projectRoleOr404(state.db, user.id, id);
    requireRole(role, "creator");
    const target = await state.db.query("SELECT id FROM users WHERE username = $1", [username]);
    if (target.rows.length === 0) throw new ApiError(422, "invalid_input", { username: "No such user." });
    await state.db.query("DELETE FROM members WHERE project_id = $1 AND user_id = $2", [id, target.rows[0].id]);
    return reply.code(204).send();
  });

  // Inbox
  app.get("/api/inbox", async (req) => {
    const user = await requireUser(req);
    const rows = await state.db.query(
      "SELECT id, text, created_at, read FROM inbox WHERE user_id = $1 ORDER BY created_at DESC, id DESC",
      [user.id],
    );
    const unread = rows.rows.filter((r) => !r.read).length;
    return {
      unread,
      items: rows.rows.map((r) => ({
        id: r.id,
        text: r.text,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        read: r.read,
      })),
    };
  });

  app.post("/api/inbox/read", async (req) => {
    const user = await requireUser(req);
    await state.db.query("UPDATE inbox SET read = true WHERE user_id = $1", [user.id]);
    state.events.emitToUser(user.id, "inbox", JSON.stringify({ unread: 0 }));
    return { unread: 0 };
  });

  // Register the domain route groups.
  registerSourceRoutes(app);
  registerWorkbookRoutes(app);
  registerExportRoutes(app);
  if (config.grading) registerGradingRoutes(app);

  // Static files: the browser bundle, bundled fonts. Never source or maps.
  app.get("/fonts/:name", async (req, reply) => {
    const name = (req.params as { name: string }).name;
    if (!/^[a-z0-9-]+\.(woff2|ttf)$/.test(name)) throw new ApiError(404, "not_found");
    try {
      const data = await import("node:fs/promises").then((fs) => fs.readFile(`dist/public/fonts/${name}`));
      const type = name.endsWith(".woff2") ? "font/woff2" : "font/ttf";
      reply.header("content-type", type);
      return reply.send(data);
    } catch {
      throw new ApiError(404, "not_found");
    }
  });

  const sendStatic = async (reply: FastifyReply, file: string, type: string): Promise<void> => {
    try {
      const data = await import("node:fs/promises").then((fs) => fs.readFile(`dist/public/${file}`));
      reply.header("content-type", type);
      reply.send(data);
    } catch {
      throw new ApiError(404, "not_found");
    }
  };

  app.get("/styles.css", async (_req, reply) => sendStatic(reply, "styles.css", "text/css"));
  app.get("/app.js", async (_req, reply) => sendStatic(reply, "app.js", "text/javascript"));
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send(errorBody("not_found"));
    }
    await sendStatic(reply, "index.html", "text/html");
  });

  const listen = Number(process.env.APP_PUBLIC_PORT ?? config.appPublicPort);
  await app.listen({ port: listen, host: "0.0.0.0" });

  // Boot: retry PostgreSQL every second.
  connectWithRetry(config.databaseUrl, () => {
    app.log.warn("PostgreSQL unreachable; retrying");
  }).then((pool) => {
    db = pool;
    dbReady = true;
    state.started = true;
    (globalThis as { lozAppState?: AppState }).lozAppState = state;
    void storage.ensureBucket();
    void seedHomeSample(pool);
    void import("./scheduler.js").then((m) => m.startScheduler(state));
  });
}

function exportServerNow(_app: FastifyInstance): void {
  // serverNow is defined in main's closure; this hook exists for type clarity.
}

declare module "fastify" {
  interface FastifyInstance {
    serverNow: () => number;
  }
}

async function readableSources(db: Db, userId: string): Promise<{ id: string }[]> {
  const res = await db.query(
    `SELECT DISTINCT s.id FROM sources s
     JOIN projects p ON p.id = s.project_id
     JOIN members m ON m.project_id = p.id
     WHERE m.user_id = $1`,
    [userId],
  );
  return res.rows;
}

export async function extractPayload(db: Db, sourceId: string): Promise<Record<string, unknown>> {
  const res = await db.query("SELECT * FROM extracts WHERE source_id = $1", [sourceId]);
  const row = res.rows[0];
  if (!row) return { source: sourceId, state: "live", stale: false, last_success_at: null, last_failure_at: null, next_run_at: null, rows: 0 };
  return {
    source: sourceId,
    state: row.state,
    stale: row.stale,
    last_success_at: row.last_success_at instanceof Date ? row.last_success_at.toISOString() : row.last_success_at,
    last_failure_at: row.last_failure_at instanceof Date ? row.last_failure_at.toISOString() : row.last_failure_at,
    next_run_at: row.next_run_at instanceof Date ? row.next_run_at.toISOString() : row.next_run_at,
    rows: row.rows_count,
  };
}

async function unreadCount(db: Db, userId: string): Promise<number> {
  const res = await db.query("SELECT COUNT(*)::int AS n FROM inbox WHERE user_id = $1 AND read = false", [userId]);
  return res.rows[0]?.n ?? 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
