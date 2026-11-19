// Versions (brief: Versions): the server's own timer cuts an automatic version VERSION_INTERVAL_MS
// after the first uncovered operation; Save version and restore cut versions too. Due times live in
// Postgres, so the timer survives a restart, and every instance claims due rows atomically.
import type pg from "pg";
import { copy } from "../shared/copy";
import { ApiError, requireFields } from "../shared/errors";
import { canEdit, isOwner } from "../shared/rules";
import { LIMITS } from "../shared/text";
import type { DiagramDocument, VersionView } from "../shared/types";
import { diagramAccess, requireRole } from "./access";
import { requireUser } from "./auth";
import { one, pool, transaction, type Queryable } from "./db";
import { json, objectBody, route } from "./http";
import { newId } from "./ids";
import { broadcast } from "./live";
import { runOperation } from "./operations";

const CHANNEL = "linewell_versions";
const SWEEP_MS = 250;

interface VersionRow {
  id: string;
  number: number;
  name: string | null;
  author_id: string;
  author_name: string;
  created_at: Date;
  seq: number;
}

const SELECT = "SELECT v.id, v.number, v.name, v.author_id, u.name AS author_name, v.created_at, v.seq FROM versions v JOIN users u ON u.id = v.author_id";

function view(row: VersionRow): VersionView {
  return {
    id: row.id, number: row.number, name: row.name, displayName: copy.versionDisplay(row.number, row.name),
    author: { id: row.author_id, name: row.author_name }, createdAt: row.created_at.toISOString(), seq: row.seq,
  };
}

/** Cuts a version of the current document; it covers every operation so far, so the timer resets. */
async function cutVersion(db: Queryable, diagramId: string, authorId: string, name: string | null): Promise<VersionView> {
  const { rows } = await db.query<{ doc: DiagramDocument; seq: number; number: number }>(
    `UPDATE diagrams SET next_version = next_version + 1, version_due_at = NULL, version_due_author = NULL
      WHERE id = $1 RETURNING doc, seq, next_version - 1 AS number`, [diagramId]);
  const row = one(rows);
  const id = newId("v_");
  await db.query("INSERT INTO versions (id, diagram_id, number, name, author_id, seq, doc) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, diagramId, row.number, name, authorId, row.seq, JSON.stringify({ ...row.doc, seq: row.seq })]);
  await db.query("SELECT pg_notify($1, $2)", [CHANNEL, diagramId]);
  const created = await db.query<VersionRow>(`${SELECT} WHERE v.id = $1`, [id]);
  return view(one(created.rows));
}

async function sweep(): Promise<void> {
  await transaction(async (db) => {
    const { rows } = await db.query<{ id: string; version_due_author: string }>(
      "SELECT id, version_due_author FROM diagrams WHERE version_due_at <= now() FOR UPDATE SKIP LOCKED LIMIT 20");
    for (const row of rows) await cutVersion(db, row.id, row.version_due_author, null);
  });
}

/** Listens for versions cut by any instance; reconnects when the connection drops. */
function listen(): void {
  pool.connect().then(async (listener: pg.PoolClient) => {
    listener.on("error", () => {
      listener.release(true);
      setTimeout(listen, 1000);
    });
    listener.on("notification", (message) => {
      if (message.payload) broadcast(message.payload, { type: "versions" });
    });
    await listener.query(`LISTEN ${CHANNEL}`);
  }).catch(() => setTimeout(listen, 1000));
}

/** Starts the timer sweep and the cross-instance version notifications. */
export function startVersionTimer(): void {
  listen();
  const tick = () => {
    sweep().catch(() => undefined).finally(() => setTimeout(tick, SWEEP_MS).unref());
  };
  tick();
}

async function versionOf(diagramId: string, versionId: string): Promise<{ version: VersionView; document: DiagramDocument }> {
  const { rows } = await pool.query<VersionRow & { doc: DiagramDocument }>(`${SELECT.replace("v.seq FROM", "v.seq, v.doc FROM")} WHERE v.id = $1 AND v.diagram_id = $2`, [versionId, diagramId]);
  const row = rows[0];
  if (!row) throw new ApiError("not_found");
  return { version: view(row), document: row.doc };
}

/** The not-found rule for a workspace address's `version`. */
export async function versionBelongs(diagramId: string, versionId: string): Promise<boolean> {
  const { rowCount } = await pool.query("SELECT 1 FROM versions WHERE id = $1 AND diagram_id = $2", [versionId, diagramId]);
  return !!rowCount;
}

route("GET", "/api/diagrams/:id/versions", async (req) => {
  const access = await diagramAccess(await requireUser(req), req.params[0] as string);
  const { rows } = await pool.query<VersionRow>(`${SELECT} WHERE v.diagram_id = $1 ORDER BY v.number DESC`, [access.diagramId]);
  return json(200, { versions: rows.map(view) });
});

route("POST", "/api/diagrams/:id/versions", async (req) => {
  const access = await diagramAccess(await requireUser(req), req.params[0] as string);
  requireRole(access, canEdit);
  const { name } = objectBody(req.body);
  requireFields({ name: name === undefined || name === null || (typeof name === "string" && name.length <= LIMITS.versionName) ? null : "Use up to 80 characters." });
  const label = typeof name === "string" && name.trim() ? name : null;
  const version = await transaction((db) => cutVersion(db, access.diagramId, access.user.id, label));
  return json(201, { version });
});

route("GET", "/api/diagrams/:id/versions/:version", async (req) => {
  const access = await diagramAccess(await requireUser(req), req.params[0] as string);
  return json(200, await versionOf(access.diagramId, req.params[1] as string));
});

route("POST", "/api/diagrams/:id/versions/:version/restore", async (req) => {
  const user = await requireUser(req);
  const access = await diagramAccess(user, req.params[0] as string);
  const { version, document } = await versionOf(access.diagramId, req.params[1] as string);
  requireRole(access, isOwner);
  const cut: { version?: VersionView } = {};
  const { result } = await runOperation(user, access.diagramId, {}, {
    socket: false,
    restore: { versionId: version.id, displayName: version.displayName, document },
    after: async (db) => {
      cut.version = await cutVersion(db, access.diagramId, user.id, copy.restoredName(version.displayName));
    },
  });
  if (!cut.version) throw new ApiError("internal");
  return json(200, { version: cut.version, seq: result.seq });
});
