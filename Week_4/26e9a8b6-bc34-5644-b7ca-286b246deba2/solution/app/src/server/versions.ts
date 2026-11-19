import { guideAccess } from './access';
import { encodeCursor, decodeNumberCursor } from './cursor';
import {
  contentCost, insertContent, latestVersion, loadSnapshot, loadWorking, type Content, type GuideRecord,
} from './content';
import { pool, transaction, type Db } from './db';
import { conflict, invalid, notFound } from './errors';
import type { Ctx } from './http';
import { pageSize } from './questions';
import { emitGuide } from './live';
import { syncFieldPaths } from './working';
import { compareVersions, differingFields } from '../shared/compare';
import { formatCost } from '../shared/cost';
import type { VersionBody, VersionSummary } from '../shared/types';

const snapshotOf = (content: Content): Content => ({
  steps: content.steps, parts: content.parts, model_id: content.model_id,
  model_scale: content.model_scale, model_scale_confirmed: content.model_scale_confirmed,
});

export async function insertVersion(db: Db, guideId: string, number: number, userId: string | null, content: Content, restoredFrom: number | null): Promise<void> {
  await db.query(
    'INSERT INTO versions (guide_id, number, saved_by, restored_from, model_id, snapshot) VALUES ($1, $2, $3, $4, $5, $6)',
    [guideId, number, userId, restoredFrom, content.model_id, JSON.stringify(snapshotOf(content))],
  );
}

export async function saveVersion(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member', confirmed: true });
  const { base_version: base } = await ctx.json();
  if (base !== null && !Number.isInteger(base)) throw invalid('base_version');
  const number = await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const latest = await latestVersion(db, guide.id);
    const current = await loadWorking(db, guide);
    if (latest !== base) {
      const baseSnapshot = typeof base === 'number' ? (await loadSnapshot(db, guide.id, base))?.content ?? null : null;
      const latestSnapshot = latest === null ? null : (await loadSnapshot(db, guide.id, latest))!.content;
      throw conflict('version_conflict', { current: latest, fields: differingFields(baseSnapshot, latestSnapshot ?? { steps: [], parts: [] }) });
    }
    const created = (latest ?? 0) + 1;
    await insertVersion(db, guide.id, created, ctx.user!.id, current, null);
    return created;
  });
  emitGuide(guide.id, { type: 'version', latest_version: number });
  return { number };
}

function summary(guide: GuideRecord, row: { number: number; saved_at: Date; saved_by: string | null; restored_from: number | null; snapshot: Content }): VersionSummary {
  const cost = contentCost(row.snapshot);
  return {
    number: row.number, saved_at: row.saved_at.toISOString(), saved_by: row.saved_by ?? '', restored_from: row.restored_from,
    step_count: row.snapshot.steps.length, parts_cost: cost, parts_cost_text: formatCost(cost, guide.currency),
  };
}

export async function listVersions(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!);
  const size = pageSize(ctx);
  const before = decodeNumberCursor(ctx.url.searchParams.get('cursor'));
  const rows = await pool.query<{ number: number; saved_at: Date; saved_by: string | null; restored_from: number | null; snapshot: Content }>(
    `SELECT v.number, v.saved_at, u.name AS saved_by, v.restored_from, v.snapshot FROM versions v LEFT JOIN users u ON u.id = v.saved_by
      WHERE v.guide_id = $1 AND ($2::int IS NULL OR v.number < $2) ORDER BY v.number DESC LIMIT $3`,
    [guide.id, before, size + 1],
  );
  const page = rows.rows.slice(0, size);
  return {
    items: page.map((row) => summary(guide, row)),
    next_cursor: rows.rows.length > size ? encodeCursor({ n: page[page.length - 1]!.number }) : null,
  };
}

export async function readVersion(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!);
  const number = Number(ctx.params.n);
  const found = Number.isInteger(number) ? await loadSnapshot(pool, guide.id, number) : null;
  if (!found) throw notFound();
  const cost = contentCost(found.content);
  const body: VersionBody = {
    number, steps: found.content.steps, parts: found.content.parts, model_id: found.content.model_id,
    parts_cost: cost, parts_cost_text: formatCost(cost, guide.currency),
  };
  return body;
}

export async function compare(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!);
  const [olderNumber, newerNumber] = ['older', 'newer'].map((key) => Number(ctx.url.searchParams.get(key)));
  if (!Number.isInteger(olderNumber) || !Number.isInteger(newerNumber)) throw invalid('older');
  const older = await loadSnapshot(pool, guide.id, olderNumber!);
  const newer = await loadSnapshot(pool, guide.id, newerNumber!);
  if (!older || !newer) throw notFound();
  return compareVersions(olderNumber!, older.content, newerNumber!, newer.content, guide.currency);
}

export async function restoreVersion(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member', confirmed: true });
  const old = Number(ctx.params.n);
  const number = await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const found = Number.isInteger(old) ? await loadSnapshot(db, guide.id, old) : null;
    if (!found) throw notFound();
    const { content } = found;
    await db.query('DELETE FROM steps WHERE guide_id = $1', [guide.id]);
    await db.query('DELETE FROM parts WHERE guide_id = $1', [guide.id]);
    await insertContent(db, guide.id, content);
    await db.query('UPDATE field_revisions SET revision = revision + 1 WHERE guide_id = $1', [guide.id]);
    await db.query('UPDATE guides SET model_id = $1, model_scale = $2, model_scale_confirmed = $3, revision = revision + 1 WHERE id = $4', [
      content.model_id, content.model_scale, content.model_scale_confirmed, guide.id,
    ]);
    await syncFieldPaths(db, guide.id);
    const created = ((await latestVersion(db, guide.id)) ?? 0) + 1;
    await insertVersion(db, guide.id, created, ctx.user!.id, content, old);
    return created;
  });
  emitGuide(guide.id, { type: 'working' });
  emitGuide(guide.id, { type: 'version', latest_version: number });
  return { number, restored_from: old };
}

