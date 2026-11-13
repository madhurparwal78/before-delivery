import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { ApiError, notFound, invalidFields } from "./errors.js";
import { readConfig } from "./config.js";
import { getPool, SCHEMA_SQL } from "./db.js";
import { BodyStore, StorageHealth } from "./storage.js";
import { seedIfNeeded } from "./seed.js";
import { cookieOf, memberForSession, parseJsonBody, readBody, requireSession } from "./apiCore.js";
import { verifyPassword } from "./passwords.js";
import { respondError, respondJson } from "./handlersCommon.js";
import * as parts from "./handlers/parts.js";
import * as assemblies from "./handlers/assemblies.js";
import type { Member } from "../shared/types.js";
import { attemptBodyWrite, buildPartBody, shapesOfPart } from "./partSave.js";
import { loadPart } from "./repo.js";
import { sketchEntities } from "./repo.js";

/**
 * The HTTP server: the boundary checks, the routing table and the
 * boot sequence, including the seed and the seed body write.
 */

async function main(): Promise<void> {
  const config = readConfig();
  const pool = getPool({ databaseUrl: config.databaseUrl });
  const store = new BodyStore(config.s3);
  const health = new StorageHealth(store);

  let bootComplete = false;
  const boot = await bootOnce(pool, store, () => bootComplete = true);

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res, { pool, store, health, bootDone: () => bootComplete });
    } catch (err) {
      if (err instanceof ApiError) {
        respondError(res, err);
      } else {
        console.error(err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "internal", message: "Internal error." } }));
        }
      }
    }
  });

  server.listen(config.port, "0.0.0.0");
  void boot;
  console.log(`Kerfline Bench serving on port ${config.port}`);
}

interface Env {
  pool: Pool;
  store: BodyStore;
  health: StorageHealth;
  bootDone: () => boolean;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, env: Env): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/health") {
    if (env.bootDone() && (await schemaReady(env))) {
      respondJson(res, 200, { status: "ok" });
    } else {
      respondJson(res, 503, { status: "starting" });
    }
    return;
  }

  if (pathname.startsWith("/api/")) {
    await api(req, res, pathname, url, env);
    return;
  }
  await statics(req, res, pathname);
}

async function schemaReady(env: Env): Promise<boolean> {
  try {
    const seeded = await env.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM workspace");
    return Number(seeded.rows[0]!.count) > 0;
  } catch {
    return false;
  }
}

async function statics(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") throw notFound();
  if (pathname.includes("..")) throw notFound();
  const distRoot = path.resolve(process.cwd(), "dist/app");
  let candidate = pathname === "/" ? path.join(distRoot, "index.html") : path.join(distRoot, pathname.slice(1));
  if (!candidate.startsWith(distRoot)) throw notFound();
  const forbidden = [".ts", ".map", ".env", "package", "run.json", "vite.config", "node_modules"];
  const base = path.basename(candidate);
  if (forbidden.some((f) => base === f || base.startsWith(f) || candidate.endsWith(f))) throw notFound();
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) candidate = path.join(candidate, "index.html");
    const content = await fs.readFile(candidate);
    res.writeHead(200, { "content-type": contentTypeOf(candidate) });
    res.end(content);
  } catch {
    try {
      const index = await fs.readFile(path.join(distRoot, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(index);
    } catch {
      throw notFound();
    }
  }
}

function contentTypeOf(file: string): string {
  const ext = path.extname(file);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".ico": "image/x-icon"
  };
  return types[ext] ?? "application/octet-stream";
}

async function api(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  url: URL,
  env: Env
): Promise<void> {
  const segments = pathname.slice("/api/".length).split("/").filter(Boolean);
  const method = req.method ?? "GET";

  // Boundary checks run before anything in the precedence order.
  const origin = req.headers.origin;
  if (origin && ["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== (req.headers.host ?? "")) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "cross_origin", message: "Requests from another site are refused." } }));
        return;
      }
    } catch {
      // A malformed Origin header is treated as same-origin.
    }
  }
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    const type = req.headers["content-type"] ?? "";
    const hasBody = req.headers["content-length"] !== undefined || req.headers["transfer-encoding"] !== undefined;
    if (hasBody && !type.includes("application/json")) {
      res.writeHead(415, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "unsupported_media_type", message: "Send JSON with Content-Type application/json." } }));
      return;
    }
  }
  const bodyRead = await readBody(req);
  if ("tooLarge" in bodyRead) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "payload_too_large", message: "Request body is larger than 1,000,000 bytes." } }));
    return;
  }
  if ("badType" in bodyRead) {
    res.writeHead(415, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "unsupported_media_type", message: "Send JSON with Content-Type application/json." } }));
    return;
  }
  const body = parseJsonBody("raw" in bodyRead ? bodyRead.raw : Buffer.alloc(0));
  if (body === null) {
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "invalid", message: "Check the highlighted fields." } }));
    return;
  }

  const member = await memberForSession(env.pool, req);

  // The session endpoints answer before the session is required.
  if (segments[0] === "session" && method === "POST") {
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fields: Record<string, string> = {};
    if (email.trim() === "") fields.email = "Enter your email.";
    if (password === "") fields.password = "Enter your password.";
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    const row = (
      await env.pool.query<{ id: string; password_hash: string; name: string; email: string; role: "founder" | "engineer"; units: "mm" | "in"; precision: number }>(
        "SELECT id, password_hash, name, email, role, units, precision FROM members WHERE lower(email) = lower($1)",
        [email]
      )
    ).rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw new ApiError(401, "bad_credentials", "Email or password is not right.");
    }
    const token = (await import("node:crypto")).randomBytes(24).toString("hex");
    await env.pool.query("INSERT INTO sessions (token, member_id) VALUES ($1, $2)", [token, row.id]);
    res.setHeader("set-cookie", `kerfline_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    respondJson(res, 200, {
      member: { id: row.id, name: row.name, email: row.email, role: row.role, units: row.units, precision: row.precision }
    });
    return;
  }
  if (segments[0] === "session" && method === "DELETE") {
    const current = requireSession(member);
    void current;
    const token = cookieOf(req);
    if (token) await env.pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    res.writeHead(204);
    res.end();
    return;
  }

  // Every other endpoint requires a session.
  const session = requireSession(member);
  const client = await env.pool.connect();
  try {
    if (segments[0] === "me" && method === "GET") {
      respondJson(res, 200, { member: session });
      return;
    }
    if (segments[0] === "me" && method === "PATCH") {
      const fields: Record<string, string> = {};
      const units = body.units;
      const precision = body.precision;
      if (units !== undefined && units !== "mm" && units !== "in") fields.units = "Choose one of the listed options.";
      if (
        precision !== undefined &&
        (typeof precision !== "number" || !Number.isInteger(precision) || precision < 0 || precision > 4)
      ) {
        fields.precision = "Choose one of the listed options.";
      }
      if (Object.keys(fields).length > 0) throw invalidFields(fields);
      const nextUnits = units === undefined ? session.units : (units as "mm" | "in");
      const nextPrecision = precision === undefined ? session.precision : (precision as number);
      await client.query("UPDATE members SET units = $1, precision = $2 WHERE id = $3", [
        nextUnits,
        nextPrecision,
        session.id
      ]);
      respondJson(res, 200, { member: { ...session, units: nextUnits, precision: nextPrecision } });
      return;
    }
    if (segments[0] === "workspace" && method === "GET") {
      const row = (
        await client.query<{ name: string; product_assembly_id: string; product_name: string }>(
          `SELECT w.name, w.product_assembly_id, a.name AS product_name
           FROM workspace w JOIN assemblies a ON a.id = w.product_assembly_id WHERE w.id = 1`
        )
      ).rows[0];
      if (!row) throw notFound();
      const members = await client.query<{ id: string; name: string; role: "founder" | "engineer" }>(
        "SELECT id, name, role FROM members ORDER BY created_at"
      );
      respondJson(res, 200, {
        name: row.name,
        product: { assembly_id: row.product_assembly_id, name: row.product_name },
        members: members.rows
      });
      return;
    }
    if (segments[0] === "materials" && method === "GET") {
      const rows = await client.query<{ id: string; name: string; density_g_cm3: number }>(
        "SELECT id, name, density_g_cm3 FROM materials ORDER BY name"
      );
      respondJson(res, 200, { materials: rows.rows });
      return;
    }
    if (segments[0] === "status" && method === "GET") {
      const storage = (await env.health.reachable()) ? "ok" : "unreachable";
      respondJson(res, 200, { storage });
      return;
    }

    if (segments[0] === "parts") {
      await partsRoutes(client, env, segments, method, body, session, req, res, url);
      return;
    }
    if (segments[0] === "sketches") {
      await sketchRoutes(client, env, segments, method, body, session, req, res, url);
      return;
    }
    if (segments[0] === "assemblies") {
      await assemblyRoutes(client, segments, method, body, session, req, res);
      return;
    }
    if (segments[0] === "purchased") {
      await purchasedRoutes(client, segments, method, body, session, res);
      return;
    }
    throw notFound();
  } finally {
    client.release();
  }
}

type ServerResponse = http.ServerResponse;

async function partsRoutes(
  client: import("pg").PoolClient,
  env: Env,
  segments: string[],
  method: string,
  body: Record<string, unknown>,
  member: Member,
  req: http.IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const [, b, c, d] = segments;
  if (!b && method === "GET") return parts.handleListParts(client, res);
  if (!b && method === "POST") return parts.handleCreatePart(client, body, member, res);
  if (b && !c && method === "GET") return parts.handleGetPart(client, b, res);
  if (b && !c && method === "PATCH") return parts.handlePatchPart(client, b, body, member, env.store, res);
  if (b && c === "save" && method === "POST") return parts.handleSavePart(client, b, member, env.store, res);
  if (b && c === "body" && method === "GET") return parts.handleGetBody(client, b, env.store, res);
  if (b && c === "sketches" && method === "POST") return parts.handleCreateSketch(client, b, body, member, res);
  if (b && c === "features" && !d && method === "POST") {
    return parts.handleCreateFeature(client, b, body, member, req, env.store, res);
  }
  if (b && c === "features" && d && method === "PATCH") {
    return parts.handlePatchFeature(client, b, d, body, member, env.store, res);
  }
  if (b && !c && method === "DELETE") throw notFound();
  void url;
  throw notFound();
}

async function sketchRoutes(
  client: import("pg").PoolClient,
  env: Env,
  segments: string[],
  method: string,
  body: Record<string, unknown>,
  member: Member,
  req: http.IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  void req;
  const [, b, c, d] = segments;
  if (b && !c && method === "GET") return parts.handleGetSketch(client, b, res);
  if (b && c === "entities" && !d && method === "POST") {
    return parts.handlePostEntity(client, b, body, member, env.store, res);
  }
  if (b && c === "entities" && d && method === "DELETE") {
    return parts.handleDeleteEntity(client, b, d, url.searchParams, member, env.store, res);
  }
  if (b && c === "constraints" && !d && method === "POST") {
    return parts.handlePostConstraint(client, b, body, member, env.store, res);
  }
  if (b && c === "constraints" && d && method === "PATCH") {
    return parts.handlePatchConstraint(client, b, d, body, member, env.store, res);
  }
  if (b && c === "constraints" && d && method === "DELETE") {
    return parts.handleDeleteConstraint(client, b, d, url.searchParams, member, env.store, res);
  }
  throw notFound();
}

async function assemblyRoutes(
  client: import("pg").PoolClient,
  segments: string[],
  method: string,
  body: Record<string, unknown>,
  member: Member,
  req: http.IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const [, b, c, d] = segments;
  if (!b && method === "GET") return assemblies.handleListAssemblies(client, res);
  if (!b && method === "POST") return assemblies.handleCreateAssembly(client, body, member, res);
  if (b && !c && method === "GET") return assemblies.handleGetAssembly(client, b, res);
  if (b && c === "instances" && !d && method === "POST") {
    return assemblies.handlePostInstance(client, b, body, member, req, res);
  }
  if (b && c === "instances" && d && method === "PATCH") {
    return assemblies.handlePatchInstance(client, b, d, body, member, res);
  }
  if (b && c === "instances" && d && method === "DELETE") {
    return assemblies.handleDeleteInstance(client, b, d, new URL(req.url ?? "/", "http://x").searchParams, member, res);
  }
  if (b && c === "tree" && method === "GET") return assemblies.handleGetTree(client, b, res);
  if (b && c === "bom" && method === "GET") return assemblies.handleGetBom(client, b, res);
  throw notFound();
}

async function purchasedRoutes(
  client: import("pg").PoolClient,
  segments: string[],
  method: string,
  body: Record<string, unknown>,
  member: Member,
  res: ServerResponse
): Promise<void> {
  const [, b] = segments;
  if (!b && method === "GET") return assemblies.handleListPurchased(client, res);
  if (!b && method === "POST") return assemblies.handleCreatePurchased(client, body, member, res);
  if (b && method === "PATCH") return assemblies.handlePatchPurchased(client, b, body, member, res);
  throw notFound();
}

/** Apply the schema, seed once, and write seeded bodies that were never stored. */
async function bootOnce(pool: Pool, store: BodyStore, markDone: () => void): Promise<void> {
  for (;;) {
    try {
      await pool.query(SCHEMA_SQL);
      break;
    } catch (err) {
      console.error("Waiting for Postgres:", (err as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const seedClient = await pool.connect();
  try {
    await seedClient.query("BEGIN");
    await seedIfNeeded(seedClient);
    await seedClient.query("COMMIT");
  } catch (err) {
    await seedClient.query("ROLLBACK").catch(() => undefined);
    console.error("Seed error:", (err as Error).message);
  } finally {
    seedClient.release();
  }
  await writeSeededBodies(pool, store);
  markDone();
}

async function writeSeededBodies(pool: Pool, store: BodyStore): Promise<void> {
  const client = await pool.connect();
  try {
    const rows = (
      await client.query<{ id: string; material_id: string }>(
        "SELECT id, material_id FROM parts WHERE seeded AND confirmed_build IS NULL"
      )
    ).rows;
    for (const row of rows) {
      const loaded = await loadPart(client, row.id);
      if (!loaded) continue;
      const entitiesBySketch = new Map<string, import("../shared/types.js").SketchEntity[]>();
      for (const s of loaded.sketches) {
        entitiesBySketch.set(s.id, await sketchEntities(client, s.id));
      }
      const shapes = shapesOfPart(loaded.features, loaded.sketches, entitiesBySketch);
      if (shapes.length === 0) continue;
      await client.query("BEGIN");
      try {
        const locked = (
          await client.query<{ confirmed_build: number | null; body_build: number | null }>(
            "SELECT confirmed_build, body_build FROM parts WHERE id = $1 FOR UPDATE",
            [row.id]
          )
        ).rows[0];
        if (!locked || locked.confirmed_build !== null) {
          // Already stored by another process; nothing to write.
          await client.query("COMMIT");
          continue;
        }
        const build = buildPartBody(row.id, shapes, (locked.body_build ?? 0) + 1);
        if (!build.ok) {
          await client.query("COMMIT");
          continue;
        }
        const mass = (loaded.material.density_g_cm3 * build.volume) / 1000;
        await attemptBodyWrite(client, store, row.id, build, mass);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error("Seed body write failed:", (err as Error).message);
      }
    }
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
