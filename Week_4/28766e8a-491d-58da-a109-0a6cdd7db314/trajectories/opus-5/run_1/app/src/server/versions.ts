import type { PoolClient } from 'pg';
import { versionDisplayName } from '../shared/copy.js';
import type { DiagramDocument } from '../shared/document.js';
import type { User } from './auth.js';
import { query, transaction } from './db.js';
import { lockDiagram, registerObjectIds } from './diagrams.js';
import { config } from './env.js';
import { broadcast } from './hub.js';
import { newId } from './ids.js';

export interface VersionSummary {
  id: string;
  number: number;
  name: string | null;
  displayName: string;
  author: { id: string; name: string };
  createdAt: string;
  seq: number;
}

interface VersionRow extends Record<string, unknown> {
  id: string;
  number: number;
  name: string | null;
  author_id: string;
  author_name: string;
  created_at: Date;
  seq: number;
}

function summaryOf(row: VersionRow): VersionSummary {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    displayName: versionDisplayName(row.name, row.number),
    author: { id: row.author_id, name: row.author_name },
    createdAt: row.created_at.toISOString(),
    seq: row.seq,
  };
}

export async function listVersions(diagramId: string): Promise<VersionSummary[]> {
  const rows = await query<VersionRow>(
    `SELECT v.id, v.number, v.name, v.author_id, u.name AS author_name, v.created_at, v.seq
       FROM versions v JOIN users u ON u.id = v.author_id
      WHERE v.diagram_id = $1
      ORDER BY v.number DESC`,
    [diagramId],
  );
  return rows.map(summaryOf);
}

export async function loadVersion(
  diagramId: string,
  versionId: string,
): Promise<{ version: VersionSummary; document: DiagramDocument } | undefined> {
  const rows = await query<VersionRow & { document: DiagramDocument }>(
    `SELECT v.id, v.number, v.name, v.author_id, u.name AS author_name, v.created_at, v.seq, v.document
       FROM versions v JOIN users u ON u.id = v.author_id
      WHERE v.diagram_id = $1 AND v.id = $2`,
    [diagramId, versionId],
  );
  const row = rows[0];
  if (!row) return undefined;
  return { version: summaryOf(row), document: row.document };
}

/** Writes one version row inside an open transaction, numbering it per diagram. */
async function insertVersion(
  client: PoolClient,
  diagramId: string,
  authorId: string,
  name: string | null,
  document: DiagramDocument,
  seq: number,
): Promise<VersionSummary> {
  const counted = await client.query<{ version_count: number }>(
    'UPDATE diagrams SET version_count = version_count + 1 WHERE id = $1 RETURNING version_count',
    [diagramId],
  );
  const number = counted.rows[0]?.version_count ?? 1;
  const id = newId('v');
  const inserted = await client.query<{ created_at: Date }>(
    `INSERT INTO versions (id, diagram_id, number, name, author_id, document, seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING created_at`,
    [id, diagramId, number, name, authorId, JSON.stringify(document), seq],
  );
  await registerObjectIds(client, diagramId, [{ id, kind: 'version' }]);
  const authorName = await client.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [
    authorId,
  ]);
  return {
    id,
    number,
    name,
    displayName: versionDisplayName(name, number),
    author: { id: authorId, name: authorName.rows[0]?.name ?? '' },
    createdAt: (inserted.rows[0]?.created_at ?? new Date()).toISOString(),
    seq,
  };
}

/** Save version. Cutting a version resets the automatic interval. */
export async function saveVersion(
  diagramId: string,
  actor: User,
  name: string | null,
): Promise<VersionSummary> {
  const version = await transaction(async (client) => {
    const diagram = await lockDiagram(client, diagramId);
    return insertVersion(client, diagramId, actor.id, name, diagram.document, diagram.seq);
  });
  broadcast(diagramId, { t: 'versions' });
  return version;
}

/** Every restore records a version named after the version it restored. */
export async function restoreVersionRecord(
  client: PoolClient,
  diagramId: string,
  actor: User,
  versionId: string,
  document: DiagramDocument,
  seq: number,
): Promise<string> {
  const restored = await client.query<{ name: string | null; number: number }>(
    'SELECT name, number FROM versions WHERE diagram_id = $1 AND id = $2',
    [diagramId, versionId],
  );
  const row = restored.rows[0];
  const restoredName = versionDisplayName(row?.name ?? null, row?.number ?? 0);
  await insertVersion(client, diagramId, actor.id, `Restored ${restoredName}`, document, seq);
  return restoredName;
}

/**
 * The server's own timer cuts an automatic version once the version interval has passed
 * after the first operation not yet covered by a version, even with no later edit. The due
 * time is read from the stored operation log, so a restart does not lose it.
 */
export async function cutDueVersions(): Promise<void> {
  const due = await query<{ diagram_id: string; actor_id: string; seq: number }>(
    `SELECT d.id AS diagram_id, o.actor_id, d.seq
       FROM diagrams d
       JOIN LATERAL (
         SELECT actor_id, created_at
           FROM operations
          WHERE diagram_id = d.id
            AND seq > COALESCE((SELECT max(seq) FROM versions WHERE diagram_id = d.id), 0)
          ORDER BY seq ASC LIMIT 1
       ) o ON true
      WHERE o.created_at + ($1::bigint * interval '1 millisecond') <= now()`,
    [config.versionIntervalMs],
  );
  for (const row of due) {
    await transaction(async (client) => {
      const diagram = await lockDiagram(client, row.diagram_id);
      const covered = await client.query<{ max: number | null }>(
        'SELECT max(seq) AS max FROM versions WHERE diagram_id = $1',
        [row.diagram_id],
      );
      const first = await client.query<{ actor_id: string; created_at: Date }>(
        `SELECT actor_id, created_at FROM operations
          WHERE diagram_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT 1`,
        [row.diagram_id, covered.rows[0]?.max ?? 0],
      );
      const start = first.rows[0];
      if (!start) return;
      if (start.created_at.getTime() + config.versionIntervalMs > Date.now()) return;
      await insertVersion(
        client,
        row.diagram_id,
        start.actor_id,
        null,
        diagram.document,
        diagram.seq,
      );
    });
    broadcast(row.diagram_id, { t: 'versions' });
  }
}

export function startVersionTimer(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void cutDueVersions().catch((error: unknown) => {
      process.stderr.write(`Version timer failed: ${String(error)}\n`);
    });
  }, 500);
  timer.unref();
  return timer;
}
