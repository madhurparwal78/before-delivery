import type { PoolClient } from 'pg';
import type { DiagramDocument, Role } from '../shared/document.js';
import { query, queryOne } from './db.js';
import { notFound } from './errors.js';

export interface DiagramRow extends Record<string, unknown> {
  id: string;
  title: string;
  owner_id: string;
  document: DiagramDocument;
  seq: number;
  version_count: number;
}

export interface Membership {
  diagram: DiagramRow;
  role: Role;
  ownerName: string;
}

/**
 * Resolves a diagram for a member. A missing diagram and a diagram the requester is not a
 * member of both fall under the not-found rule, so they cannot be told apart.
 */
export async function requireMembership(diagramId: string, userId: string): Promise<Membership> {
  const row = await queryOne<DiagramRow & { role: string | null; owner_name: string }>(
    `SELECT d.id, d.title, d.owner_id, d.document, d.seq, d.version_count,
            m.role, o.name AS owner_name
       FROM diagrams d
       JOIN users o ON o.id = d.owner_id
       LEFT JOIN members m ON m.diagram_id = d.id AND m.user_id = $2
      WHERE d.id = $1`,
    [diagramId, userId],
  );
  if (!row || row.role === null) throw notFound();
  return {
    diagram: {
      id: row.id,
      title: row.title,
      owner_id: row.owner_id,
      document: row.document,
      seq: row.seq,
      version_count: row.version_count,
    },
    role: row.role as Role,
    ownerName: row.owner_name,
  };
}

export function canEdit(role: Role): boolean {
  return role === 'owner' || role === 'editor';
}

/** Locks the diagram row, so operations on one diagram apply one at a time. */
export async function lockDiagram(client: PoolClient, diagramId: string): Promise<DiagramRow> {
  const result = await client.query<DiagramRow>(
    'SELECT id, title, owner_id, document, seq, version_count FROM diagrams WHERE id = $1 FOR UPDATE',
    [diagramId],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  return row;
}

/** Every id that has ever belonged to the diagram, so a deleted object is not a 404. */
export async function knownIds(diagramId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await query<{ id: string }>(
    'SELECT id FROM object_ids WHERE diagram_id = $1 AND id = ANY($2)',
    [diagramId, ids],
  );
  return new Set(rows.map((r) => r.id));
}

export async function requireKnownIds(diagramId: string, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const known = await knownIds(diagramId, unique);
  for (const id of unique) {
    if (!known.has(id)) throw notFound();
  }
}

export async function registerObjectIds(
  client: PoolClient,
  diagramId: string,
  objects: readonly { id: string; kind: string }[],
): Promise<void> {
  if (objects.length === 0) return;
  await client.query(
    `INSERT INTO object_ids (diagram_id, id, kind)
     SELECT $1, * FROM unnest($2::text[], $3::text[])
     ON CONFLICT DO NOTHING`,
    [diagramId, objects.map((o) => o.id), objects.map((o) => o.kind)],
  );
}

export async function saveOutageActive(diagramId: string): Promise<boolean> {
  const row = await queryOne<{ active: boolean }>(
    'SELECT until > now() AS active FROM save_outages WHERE diagram_id = $1',
    [diagramId],
  );
  return row?.active === true;
}
