import { entityBlock } from "../shared/canonical.js";
import type { Layout } from "../shared/layout.js";
import type { Model } from "../shared/model.js";
import { requireUser, type User } from "./auth.js";
import { transaction, type Queryable } from "./db.js";
import { FIELD, fail } from "./errors.js";
import { deny } from "./guard.js";
import { json, parseJson, type Context, type Reply, type Router } from "./http.js";
import { live } from "./live.js";
import { activeShare, commitText, loadProject, parseText, projectAccess, projectJson, type ProjectRow } from "./project-store.js";

interface VersionRow {
  number: number;
  name: string;
  text: string;
  layout: Layout;
  revision: number;
  created_at: Date;
  created_by: string;
  creator_name: string;
  restored_from: number | null;
}

const VERSION_SELECT = `SELECT v.number, v.name, v.text, v.layout, v.revision, v.created_at, v.created_by, u.display_name AS creator_name,
  v.restored_from FROM versions v JOIN users u ON u.id = v.created_by`;

function versionJson(row: VersionRow) {
  return {
    number: row.number,
    name: row.name,
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    createdBy: { id: row.created_by, displayName: row.creator_name },
    restoredFrom: row.restored_from,
  };
}

function versionNumber(value: string | null | undefined): number | null {
  return value && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

async function loadVersion(db: Queryable, projectId: string, number: number | null): Promise<VersionRow> {
  if (number === null) throw fail.notFound();
  const rows = await db.query<VersionRow>(`${VERSION_SELECT} WHERE v.project_id = $1 AND v.number = $2`, [projectId, number]);
  const row = rows.rows[0];
  if (!row) throw fail.notFound();
  return row;
}

/** Inserts the next gapless version number; the caller holds the project row lock. */
export async function insertVersion(
  db: Queryable,
  project: ProjectRow,
  name: string,
  text: string,
  layout: Layout,
  user: User,
  restoredFrom: number | null,
): Promise<VersionRow> {
  const next = await db.query<{ n: number }>("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM versions WHERE project_id = $1", [project.id]);
  const number = next.rows[0]!.n;
  const now = new Date();
  await db.query(
    `INSERT INTO versions (project_id, number, name, text, layout, revision, created_by, created_at, restored_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [project.id, number, name, text, JSON.stringify(layout), project.revision, user.id, now, restoredFrom],
  );
  return {
    number,
    name,
    text,
    layout,
    revision: project.revision,
    created_at: now,
    created_by: user.id,
    creator_name: user.displayName,
    restored_from: restoredFrom,
  };
}

export function validVersionName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 80;
}

function entityBlocks(model: Model): Map<string, string> {
  return new Map(model.entities.map((e) => [e.name, entityBlock(model, e).lines.join("\n")]));
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function listVersions(db: Queryable, projectId: string): Promise<Reply> {
  const rows = await db.query<VersionRow>(`${VERSION_SELECT} WHERE v.project_id = $1 ORDER BY v.number DESC`, [projectId]);
  return json(200, { versions: rows.rows.map(versionJson) });
}

async function readVersion(db: Queryable, projectId: string, number: string): Promise<Reply> {
  const row = await loadVersion(db, projectId, versionNumber(number));
  return json(200, { ...versionJson(row), text: row.text, layout: row.layout });
}

async function compareVersions(db: Queryable, projectId: string, ctx: Context): Promise<Reply> {
  const from = await loadVersion(db, projectId, versionNumber(ctx.url.searchParams.get("from")));
  const to = await loadVersion(db, projectId, versionNumber(ctx.url.searchParams.get("to")));
  const a = parseText(from.text);
  const b = parseText(to.text);
  if (a.errors.length || b.errors.length) throw fail.versionHasErrors();
  const before = entityBlocks(a.model);
  const after = entityBlocks(b.model);
  const added = [...after.keys()].filter((n) => !before.has(n)).sort(byName);
  const removed = [...before.keys()].filter((n) => !after.has(n)).sort(byName);
  const changed = [...after.keys()].filter((n) => before.has(n) && before.get(n) !== after.get(n)).sort(byName);
  return json(200, { from: from.number, to: to.number, added, removed, changed });
}

/** Resolves the project behind a view token; edit tokens must join first. */
async function viewTokenProject(db: Queryable, token: string): Promise<string> {
  const share = await activeShare(db, token);
  if (!share) throw fail.notFound();
  if (share.access !== "view") throw fail.joinFirst();
  return share.project_id;
}

export function registerVersionRoutes(router: Router): void {
  const read = (work: (db: Queryable, projectId: string, ctx: Context) => Promise<Reply>) => async (ctx: Context) => {
    const user = await requireUser(ctx);
    return transaction(async (db) => {
      const { project } = await projectAccess(db, ctx.params.id!, user);
      return work(db, project.id, ctx);
    });
  };
  const shared = (work: (db: Queryable, projectId: string, ctx: Context) => Promise<Reply>) => async (ctx: Context) =>
    transaction(async (db) => work(db, await viewTokenProject(db, ctx.params.token!), ctx));

  router.add(
    "GET",
    "/api/projects/:id/versions",
    read((db, id) => listVersions(db, id)),
  );
  router.add("GET", "/api/projects/:id/versions/compare", read(compareVersions));
  router.add(
    "GET",
    "/api/projects/:id/versions/:n",
    read((db, id, ctx) => readVersion(db, id, ctx.params.n!)),
  );
  router.add(
    "GET",
    "/api/shared/:token/versions",
    shared((db, id) => listVersions(db, id)),
  );
  router.add("GET", "/api/shared/:token/versions/compare", shared(compareVersions));
  router.add(
    "GET",
    "/api/shared/:token/versions/:n",
    shared((db, id, ctx) => readVersion(db, id, ctx.params.n!)),
  );

  router.add("POST", "/api/projects/:id/versions", async (ctx) => {
    const user = await requireUser(ctx);
    const row = await transaction(async (db) => {
      const { project, role } = await projectAccess(db, ctx.params.id!, user, true);
      deny(role, "write");
      const body = parseJson(ctx.body);
      if (!validVersionName(body.name)) throw fail.invalid({ name: FIELD.versionName });
      return insertVersion(db, project, body.name.trim(), project.text, project.layout, user, null);
    });
    return json(201, versionJson(row));
  });

  router.add("POST", "/api/projects/:id/versions/:n/restore", async (ctx) => {
    const user = await requireUser(ctx);
    const result = await transaction(async (db) => {
      const { project, role } = await projectAccess(db, ctx.params.id!, user, true);
      deny(role, "write");
      const source = await loadVersion(db, project.id, versionNumber(ctx.params.n));
      const committed = await commitText(db, project, source.text, user, source.layout);
      if (JSON.stringify(project.layout) !== JSON.stringify(source.layout)) {
        await db.query("UPDATE projects SET layout = $2 WHERE id = $1", [project.id, JSON.stringify(source.layout)]);
        project.layout = source.layout;
      }
      const version = await insertVersion(
        db,
        project,
        `Restored from version ${source.number}`,
        source.text,
        source.layout,
        user,
        source.number,
      );
      const fresh = (await loadProject(db, project.id))!;
      return { version, project: fresh, role, revision: committed.revision };
    });
    live.revision(result.project.id, result.revision, result.project.text, user);
    live.layout(result.project.id, result.project.layout, user);
    return json(201, { version: versionJson(result.version), project: projectJson(result.project, result.role) });
  });
}
