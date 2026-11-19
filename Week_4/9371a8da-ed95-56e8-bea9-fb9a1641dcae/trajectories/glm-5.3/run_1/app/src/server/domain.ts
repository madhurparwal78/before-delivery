import type { Queryable } from './db.js';
import type { PersonShape, LedgerEntry } from '../shared/types.js';
import { newId, sha256Hex } from './ids.js';
import { moveRange, suggestionOrphaned, type Span } from './anchors.js';

export interface FileRow {
  id: string;
  project_id: string;
  path: string;
  kind: 'text' | 'asset';
  revision: number;
  size: number;
  content_type: string | null;
  sha256: string | null;
  deleted_at: Date | null;
}

export function personOf(u: { id: string; display_name: string; handle: string }): PersonShape {
  return { id: u.id, displayName: u.display_name, handle: u.handle };
}

export async function currentText(sql: Queryable, file: { id: string; revision: number }): Promise<string> {
  const rows = await sql<{ content: Buffer }>`
    SELECT content FROM file_versions WHERE file_id = ${file.id} AND revision = ${file.revision}`;
  return rows[0].content.toString('utf8');
}

/** Append a ledger entry and raise the project revision. The one place revisions move. */
export async function appendLedger(
  sql: Queryable,
  projectId: string,
  kind: LedgerEntry['kind'],
  summary: string,
  actor: PersonShape,
): Promise<number> {
  const rows = await sql<{ revision: number }>`
    UPDATE projects SET revision = revision + 1 WHERE id = ${projectId}
    RETURNING revision`;
  const revision = rows[0].revision;
  await sql`
    INSERT INTO ledger_entries (project_id, revision, kind, summary, actor_id, actor_name, actor_handle, at)
    VALUES (${projectId}, ${revision}, ${kind}, ${summary}, ${actor.id}, ${actor.displayName}, ${actor.handle}, now())`;
  return revision;
}

/** Record the file set at a project revision. */
export async function recordProjectRevision(
  sql: Queryable,
  projectId: string,
  revision: number,
  entries: { id: string; path: string; kind: string; size: number; sha256: string }[],
): Promise<void> {
  for (const e of entries) {
    await sql`
      INSERT INTO project_revisions (project_id, revision, file_id, path, kind, size, sha256)
      VALUES (${projectId}, ${revision}, ${e.id}, ${e.path}, ${e.kind}, ${e.size}, ${e.sha256})`;
  }
}

/** Commit one text revision and its ledger entry. */
export async function saveFileText(
  sql: Queryable,
  projectId: string,
  file: FileRow,
  content: string,
  actor: PersonShape,
  kind: LedgerEntry['kind'],
  summary: string,
): Promise<{ revision: number; fileRevision: number; sha256: string }> {
  const buf = Buffer.from(content, 'utf8');
  const sha256 = sha256Hex(buf);
  const fileRevision = file.revision + 1;
  await sql`
    INSERT INTO file_versions (file_id, revision, content, sha256)
    VALUES (${file.id}, ${fileRevision}, ${buf}, ${sha256})
    ON CONFLICT (file_id, revision) DO UPDATE SET content = ${buf}, sha256 = ${sha256}`;
  await sql`UPDATE files SET revision = ${fileRevision}, size = ${buf.length} WHERE id = ${file.id}`;
  const revision = await appendLedger(sql, projectId, kind, summary, actor);
  await recordProjectRevision(sql, projectId, revision, [{
    id: file.id, path: file.path, kind: 'text', size: buf.length, sha256: sha256,
  }]);
  return { revision, fileRevision, sha256: sha256 };
}

/** Move anchors in a file after a span replacement, and orphan covered ones. */
export async function applyAnchorRules(
  sql: Queryable,
  projectId: string,
  file: FileRow,
  span: Span,
): Promise<void> {
  const threads = await sql<{ id: string; from_pos: number | null; to_pos: number | null; orphaned: boolean }>`
    SELECT id, from_pos, to_pos, orphaned FROM threads
    WHERE project_id = ${projectId} AND file_id = ${file.id} AND orphaned = false`;
  for (const t of threads) {
    if (t.from_pos === null || t.to_pos === null) continue;
    const moved = moveRange(t.from_pos, t.to_pos, span);
    if (moved === null) {
      await sql`
        UPDATE threads SET orphaned = true, from_pos = NULL, to_pos = NULL, orphaned_at = now()
        WHERE id = ${t.id}`;
    } else {
      await sql`UPDATE threads SET from_pos = ${moved.from}, to_pos = ${moved.to} WHERE id = ${t.id}`;
    }
  }
  const suggestions = await sql<{ id: string; from_pos: number | null; to_pos: number | null; status: string }>`
    SELECT id, from_pos, to_pos, status FROM suggestions
    WHERE project_id = ${projectId} AND file_id = ${file.id} AND status = 'open'`;
  for (const s of suggestions) {
    if (s.from_pos === null || s.to_pos === null) continue;
    if (suggestionOrphaned(s.from_pos, s.to_pos, span)) {
      await sql`
        UPDATE suggestions SET status = 'orphaned', from_pos = NULL, to_pos = NULL, orphaned_at = now()
        WHERE id = ${s.id}`;
    } else {
      const moved = moveRange(s.from_pos, s.to_pos, span);
      if (moved) {
        await sql`UPDATE suggestions SET from_pos = ${moved.from}, to_pos = ${moved.to} WHERE id = ${s.id}`;
      }
    }
  }
}

/** The stored-text change of a save or restore, as one replaced span. */
export function spanOfChange(oldText: string, newText: string): Span {
  let a = 0;
  const maxA = Math.min(oldText.length, newText.length);
  while (a < maxA && oldText[a] === newText[a]) a++;
  let end = 0;
  const maxEnd = Math.min(oldText.length - a, newText.length - a);
  while (end < maxEnd && oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]) end++;
  return { a, b: oldText.length - end, n: newText.length - a - end };
}

export function newCheckId(): string {
  return newId('chk');
}
