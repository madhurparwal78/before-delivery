import type { App } from './app.js';
import type { Db } from './db.js';
import type { AppConfig } from './config.js';

export function startVersionTimer(app: App): void {
  void setInterval(() => {
    void tick(app);
  }, 1000);
}

export async function tick(app: App): Promise<void> {
  const db: Db = app.db;
  const due = await db.query(
    `SELECT vt.diagram_id, vt.author_id, d.seq FROM version_timers vt
     JOIN diagrams d ON d.id = vt.diagram_id
     WHERE vt.due_at <= now()`);
  for (const row of due.rows as { diagram_id: string; author_id: string; seq: number }[]) {
    await db.query('DELETE FROM version_timers WHERE diagram_id = $1', [row.diagram_id]);
    await cutVersion(app, row.diagram_id, row.author_id, null, row.seq);
  }
}

export async function cutVersion(
  app: App,
  diagramId: string,
  authorId: string,
  name: string | null,
  seq: number,
): Promise<void> {
  const existing = await app.db.query(
    `SELECT id FROM versions WHERE diagram_id = $1 AND seq = $2 AND name IS NOT DISTINCT FROM $3`,
    [diagramId, seq, name]);
  if ((existing.rows.length ?? 0) > 0) return;
  const doc = await app.loadDocument(diagramId);
  if (!doc) return;
  const count = await app.db.query('SELECT count(*)::int AS n FROM versions WHERE diagram_id = $1', [diagramId]);
  const number = ((count.rows[0] as { n: number }).n ?? 0) + 1;
  const id = app.newId('v');
  await app.db.query(
    `INSERT INTO versions (id, diagram_id, number, name, author_id, seq, created_at, content)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
    [id, diagramId, number, name, authorId, seq, JSON.stringify(doc)]);
  await app.db.query('DELETE FROM version_timers WHERE diagram_id = $1', [diagramId]);
  app.broadcast(diagramId, { kind: 'version', payload: { id } });
}

export async function ensureBucket(config: AppConfig): Promise<boolean> {
  const { ensureBucket: ensure } = await import('./storage.js');
  return ensure(config);
}
