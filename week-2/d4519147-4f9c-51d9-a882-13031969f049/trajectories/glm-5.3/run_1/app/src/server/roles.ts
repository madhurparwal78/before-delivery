// Roles are read live from the database on every request.

import type { PoolClient } from 'pg';
import type { Role } from '../shared/types.js';
import { errors } from './errors.js';

export interface DiagramAccess {
  diagramId: string;
  title: string;
  role: Role;
  ownerId: string;
}

// The caller's live role on one diagram: owner, active share, or nothing.
export async function diagramRole(client: PoolClient, personId: string | null, diagramId: string): Promise<DiagramAccess | null> {
  const rows = await client.query<{ id: string; title: string; owner_id: string; role: string | null }>(
    `SELECT d.id, d.title, d.owner_id,
       CASE WHEN d.owner_id = $1 THEN 'owner'
            ELSE (SELECT sh.role FROM shares sh
                  WHERE sh.diagram_id = d.id AND lower(sh.email) = (SELECT email FROM people p WHERE p.id = $1)
                    AND sh.status = 'active'
                  LIMIT 1)
       END AS role
     FROM diagrams d
     WHERE d.id = $2`,
    [personId, diagramId],
  );
  if (rows.rowCount === 0) return null;
  const row = rows.rows[0];
  if (row.role === null) return null;
  return { diagramId: row.id, title: row.title, role: row.role as Role, ownerId: row.owner_id };
}

// Any diagram access check that fails answers not-found, never forbidden.
export async function requireDiagramAccess(client: PoolClient, personId: string | null, diagramId: string): Promise<DiagramAccess> {
  const access = await diagramRole(client, personId, diagramId);
  if (access === null) throw errors.notFound();
  return access;
}

export async function requireRole(access: DiagramAccess, minimum: 'owner' | 'editor'): Promise<void> {
  if (minimum === 'owner') {
    if (access.role !== 'owner') throw errors.forbidden();
    return;
  }
  if (access.role !== 'owner' && access.role !== 'editor') throw errors.forbidden();
}

// A page of the diagram, or not-found.
export interface PageRow {
  id: string;
  diagram_id: string;
  name: string;
  version: number;
  doc: unknown;
  derived: unknown;
  position: number;
}

export async function requirePage(client: PoolClient, diagramId: string, pageId: string): Promise<PageRow> {
  const rows = await client.query<PageRow>(
    'SELECT id, diagram_id, name, version, doc, derived, position FROM pages WHERE diagram_id = $1 AND id = $2',
    [diagramId, pageId],
  );
  if (rows.rowCount === 0) throw errors.notFound();
  return rows.rows[0];
}
