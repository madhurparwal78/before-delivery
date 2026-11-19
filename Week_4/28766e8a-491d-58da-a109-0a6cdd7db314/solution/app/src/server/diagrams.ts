// Diagram list, creation and the current document (brief: API endpoints).
import { requireFields } from "../shared/errors";
import { titleError } from "../shared/text";
import type { DiagramDocument, DiagramSummary, Role } from "../shared/types";
import { diagramAccess } from "./access";
import { requireUser } from "./auth";
import { one, pool, transaction, type Queryable } from "./db";
import { json, objectBody, route } from "./http";
import { newId } from "./ids";

function emptyDocument(id: string, title: string): DiagramDocument {
  return {
    id, title, seq: 0,
    pages: [{ id: newId("p_"), name: "Page 1", order: 0, layers: [{ id: newId("l_"), name: "Layer 1", order: 0, visible: true, locked: false }], shapes: [], connectors: [], groups: [] }],
  };
}

export async function insertDiagram(db: Queryable, doc: DiagramDocument, ownerId: string): Promise<void> {
  await db.query("INSERT INTO diagrams (id, title, owner_id, doc, seq) VALUES ($1, $2, $3, $4, 0)", [doc.id, doc.title, ownerId, JSON.stringify(doc)]);
  await db.query("INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, 'owner')", [doc.id, ownerId]);
}

export async function loadDocument(db: Queryable, diagramId: string): Promise<DiagramDocument> {
  const row = one((await db.query<{ doc: DiagramDocument; seq: number }>("SELECT doc, seq FROM diagrams WHERE id = $1", [diagramId])).rows);
  return { ...row.doc, seq: row.seq };
}

route("GET", "/api/diagrams", async (req) => {
  const user = await requireUser(req);
  const { rows } = await pool.query<{ id: string; title: string; role: Role; updated_at: Date }>(
    `SELECT d.id, d.title, m.role, d.updated_at FROM diagrams d JOIN members m ON m.diagram_id = d.id
      WHERE m.user_id = $1 ORDER BY d.updated_at DESC, d.id DESC`, [user.id]);
  const diagrams: DiagramSummary[] = rows.map((r) => ({ id: r.id, title: r.title, role: r.role, updatedAt: r.updated_at.toISOString() }));
  return json(200, { diagrams });
});

route("POST", "/api/diagrams", async (req) => {
  const user = await requireUser(req);
  const { title } = objectBody(req.body);
  requireFields({ title: titleError(title) });
  const doc = emptyDocument(newId("d_"), title as string);
  await transaction((db) => insertDiagram(db, doc, user.id));
  return json(201, { diagram: { id: doc.id, title: doc.title }, document: doc });
});

route("GET", "/api/diagrams/:id/document", async (req) => {
  const user = await requireUser(req);
  const access = await diagramAccess(user, req.params[0] as string);
  return json(200, await loadDocument(pool, access.diagramId));
});
