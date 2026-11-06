import { randomUUID } from "node:crypto";
import { derivePage } from "../../shared/derive.ts";
import { LIMITS, type Derived, type PageDoc } from "../../shared/model.ts";
import { isUuid, requireRole, type Role } from "../access.ts";
import { eventJson, type EventRow } from "../audit.ts";
import { many, one, oneRow, pool, tx, type Db } from "../db.ts";
import { ApiError, notFound, sendEmpty, sendJson, validation } from "../http.ts";
import { route } from "../router.ts";
import { plainText, validatePage } from "../validate.ts";

interface DiagramRow {
  id: string;
  title: string;
  owner_name: string;
  updated_at: Date;
}

interface PageRow {
  id: string;
  name: string;
  version: number;
  doc: PageDoc;
  derived: Derived;
}

async function diagramJson(db: Db, diagramId: string, role: Role) {
  const d = await oneRow<DiagramRow>(db, "SELECT d.id, d.title, u.display_name AS owner_name, d.updated_at FROM diagrams d JOIN users u ON u.id = d.owner_id WHERE d.id = $1", [diagramId]);
  const pages = await many<{ id: string; name: string; version: number }>(db, "SELECT id, name, version FROM pages WHERE diagram_id = $1 ORDER BY seq", [diagramId]);
  return { id: d.id, title: d.title, role, ownerName: d.owner_name, pages, updatedAt: d.updated_at.toISOString() };
}

/** 409 `page_limit` when the diagram already has 20 pages. Call with the diagram row locked. */
export async function assertPageRoom(db: Db, diagramId: string): Promise<void> {
  const count = await one<{ n: string }>(db, "SELECT count(*) AS n FROM pages WHERE diagram_id = $1", [diagramId]);
  if (Number(count?.n ?? 0) >= LIMITS.pages) throw new ApiError(409, "page_limit", "This diagram already has 20 pages.");
}

/** Stores a new page with its derived values, in the caller's transaction. */
export async function createPage(db: Db, diagramId: string, doc: PageDoc): Promise<void> {
  await db.query("INSERT INTO pages (id, diagram_id, name, version, doc, derived) VALUES ($1, $2, $3, $4, $5, $6)", [doc.id, diagramId, doc.name, doc.version, JSON.stringify(doc), JSON.stringify(derivePage(doc))]);
  await db.query("UPDATE diagrams SET updated_at = now() WHERE id = $1", [diagramId]);
}

/** The body when it parses, so its ids can be checked before validation; null otherwise (answered 422 at the validation step). */
function readable(read: () => Record<string, unknown>): Record<string, unknown> | null {
  try {
    return read();
  } catch {
    return null;
  }
}

const emptyPage = (name: string): PageDoc => ({ id: randomUUID(), name, version: 1, zones: [], shapes: [], connectors: [] });

route("GET", "/api/diagrams", { auth: "session" }, async ({ res, session }) => {
  const rows = await many<{ id: string; title: string; role: Role; updated_at: Date }>(
    pool,
    `SELECT d.id, d.title, 'owner' AS role, d.updated_at FROM diagrams d WHERE d.owner_id = $1 AND d.deleted_at IS NULL
     UNION ALL
     SELECT d.id, d.title, s.role, d.updated_at FROM shares s JOIN diagrams d ON d.id = s.diagram_id
      WHERE s.status = 'active' AND s.email = $2 AND d.deleted_at IS NULL AND d.owner_id <> $1
     ORDER BY updated_at DESC, id`,
    [session.user.id, session.user.email],
  );
  sendJson(res, 200, { diagrams: rows.map((r) => ({ id: r.id, title: r.title, role: r.role, updatedAt: r.updated_at.toISOString() })) });
});

route("POST", "/api/diagrams", { auth: "session" }, async (ctx) => {
  const title = plainText(ctx.body().title, 120);
  if (title === null) throw validation({ title: "invalid" });
  const id = randomUUID();
  const diagram = await tx(async (db) => {
    await db.query("INSERT INTO diagrams (id, owner_id, title) VALUES ($1, $2, $3)", [id, ctx.session.user.id, title]);
    await createPage(db, id, emptyPage("Page 1"));
    return diagramJson(db, id, "owner");
  });
  sendJson(ctx.res, 201, { diagram });
});

route("GET", "/api/diagrams/{id}", { auth: "session" }, async ({ res, session, params }) => {
  const { role } = await requireRole(pool, params.id, session.user, "viewer");
  sendJson(res, 200, { diagram: await diagramJson(pool, params.id, role) });
});

route("PATCH", "/api/diagrams/{id}", { auth: "session" }, async (ctx) => {
  const diagram = await tx(async (db) => {
    const { role } = await requireRole(db, ctx.params.id, ctx.session.user, "editor", true);
    const title = plainText(ctx.body().title, 120);
    if (title === null) throw validation({ title: "invalid" });
    await db.query("UPDATE diagrams SET title = $1, updated_at = now() WHERE id = $2", [title, ctx.params.id]);
    return diagramJson(db, ctx.params.id, role);
  });
  sendJson(ctx.res, 200, { diagram });
});

route("DELETE", "/api/diagrams/{id}", { auth: "session" }, async ({ res, session, params }) => {
  await tx(async (db) => {
    await requireRole(db, params.id, session.user, "owner", true);
    await db.query("UPDATE diagrams SET deleted_at = now() WHERE id = $1", [params.id]);
    await db.query("UPDATE shares SET status = 'withdrawn', token_seed = NULL WHERE diagram_id = $1 AND status = 'invited'", [params.id]);
    await db.query("UPDATE messages SET status = 'cancelled' WHERE diagram_id = $1 AND status = 'queued'", [params.id]);
  });
  sendEmpty(res, 204);
});

route("GET", "/api/diagrams/{id}/audit", { auth: "session", getOnly: true }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "owner");
  const rows = await many<EventRow>(pool, "SELECT id, at, actor, action, detail FROM audit_events WHERE diagram_id = $1 ORDER BY id DESC LIMIT 500", [params.id]);
  sendJson(res, 200, { events: rows.map(eventJson) });
});

route("POST", "/api/diagrams/{id}/pages", { auth: "session" }, async (ctx) => {
  const page = await tx(async (db) => {
    await requireRole(db, ctx.params.id, ctx.session.user, "editor", true);
    await assertPageRoom(db, ctx.params.id);
    const name = plainText(ctx.body().name, 80);
    if (name === null) throw validation({ name: "invalid" });
    const doc = emptyPage(name);
    await createPage(db, ctx.params.id, doc);
    return { id: doc.id, name: doc.name, version: doc.version };
  });
  sendJson(ctx.res, 201, { page });
});

/** The page row when `pageId` belongs to the diagram (which the caller has already been allowed to see). */
async function pageOf(db: Db, diagramId: string, pageId: string, lock = false): Promise<PageRow> {
  if (!isUuid(pageId)) throw notFound();
  const row = await one<PageRow>(db, `SELECT id, name, version, doc, derived FROM pages WHERE id = $1 AND diagram_id = $2${lock ? " FOR UPDATE" : ""}`, [pageId, diagramId]);
  if (!row) throw notFound();
  return row;
}

route("GET", "/api/diagrams/{id}/pages/{pageId}", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "viewer");
  const page = await pageOf(pool, params.id, params.pageId);
  sendJson(res, 200, { page: page.doc, derived: page.derived });
});

route("PUT", "/api/diagrams/{id}/pages/{pageId}", { auth: "session" }, async (ctx) => {
  const result = await tx(async (db) => {
    await requireRole(db, ctx.params.id, ctx.session.user, "viewer");
    const stored = await pageOf(db, ctx.params.id, ctx.params.pageId, true);
    const body = readable(ctx.body);
    if (body && body.id !== ctx.params.pageId) throw notFound();
    await requireRole(db, ctx.params.id, ctx.session.user, "editor");
    if (body && body.version !== stored.version) throw new ApiError(409, "version_conflict", "Someone else saved this page first.");
    const doc = { ...validatePage(body ?? ctx.body()), version: stored.version + 1 };
    const derived = derivePage(doc);
    await db.query("UPDATE pages SET name = $1, version = $2, doc = $3, derived = $4 WHERE id = $5", [doc.name, doc.version, JSON.stringify(doc), JSON.stringify(derived), doc.id]);
    await db.query("UPDATE diagrams SET updated_at = now() WHERE id = $1", [ctx.params.id]);
    return { page: doc, derived };
  });
  sendJson(ctx.res, 200, result);
});

route("GET", "/api/diagrams/{id}/pages/{pageId}/shapes/{shapeId}", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "viewer");
  const page = await pageOf(pool, params.id, params.pageId);
  const shape = page.doc.shapes.find((s) => s.id === params.shapeId);
  if (!shape) throw notFound();
  sendJson(res, 200, { shape, zoneIds: page.derived.zones.filter((z) => z.members.includes(shape.id)).map((z) => z.id) });
});

route("GET", "/api/diagrams/{id}/pages/{pageId}/zones/{zoneId}", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "viewer");
  const page = await pageOf(pool, params.id, params.pageId);
  const zone = page.doc.zones.find((z) => z.id === params.zoneId);
  const derived = page.derived.zones.find((z) => z.id === params.zoneId);
  if (!zone || !derived) throw notFound();
  const crossingPoints = page.derived.crossings.filter((c) => c.zoneId === zone.id).map(({ connectorId, x, y, direction }) => ({ connectorId, x, y, direction }));
  sendJson(res, 200, { zone, derived: { systems: derived.systems, crossings: derived.crossings, members: derived.members, crossingPoints } });
});

route("GET", "/api/diagrams/{id}/pages/{pageId}/connectors/{connectorId}", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "viewer");
  const page = await pageOf(pool, params.id, params.pageId);
  const connector = page.doc.connectors.find((c) => c.id === params.connectorId);
  if (!connector) throw notFound();
  const crossings = page.derived.crossings.filter((c) => c.connectorId === connector.id).map(({ zoneId, x, y, direction }) => ({ zoneId, x, y, direction }));
  sendJson(res, 200, { connector, crossings });
});

