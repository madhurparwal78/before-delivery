import { one, type Db } from "./db.ts";
import { forbidden, notFound } from "./http.ts";
import type { User } from "./sessions.ts";

export type Role = "owner" | "editor" | "viewer";

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

interface DiagramAccess {
  diagramId: string;
  role: Role;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** The caller's live role on a diagram, read from the database on every request; null when they cannot see it. */
export async function liveRole(db: Db, diagramId: string, userId: string, lock = false): Promise<Role | null> {
  if (!isUuid(diagramId)) return null;
  const row = await one<{ owner_id: string; share_role: Role | null }>(
    db,
    `SELECT d.owner_id,
            (SELECT s.role FROM shares s JOIN users u ON u.id = $2 WHERE s.diagram_id = d.id AND s.status = 'active' AND s.email = u.email) AS share_role
       FROM diagrams d WHERE d.id = $1 AND d.deleted_at IS NULL${lock ? " FOR UPDATE OF d" : ""}`,
    [diagramId, userId],
  );
  if (!row) return null;
  if (row.owner_id === userId) return "owner";
  return row.share_role;
}

/** 404 for anyone who cannot see the diagram, 403 for a member whose role is too low. */
export async function requireRole(db: Db, diagramId: string, user: User, minimum: Role, lock = false): Promise<DiagramAccess> {
  const role = await liveRole(db, diagramId, user.id, lock);
  if (!role) throw notFound();
  if (RANK[role] < RANK[minimum]) throw forbidden();
  return { diagramId, role };
}
