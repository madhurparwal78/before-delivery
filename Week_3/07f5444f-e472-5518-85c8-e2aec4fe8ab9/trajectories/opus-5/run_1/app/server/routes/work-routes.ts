import { randomBytes } from 'node:crypto';
import { barSpanLabel } from '../../shared/format.js';
import { loadProgrammeAggregate, programmeIdOfWork, stringCountOf } from '../data/programmes.js';
import { pool, withTransaction } from '../db/pool.js';
import { cutBarCount } from '../domain/running-time.js';
import { requireNotClosed, requireRole, viewContext, visibleProgramme } from '../http/access.js';
import type { RequestContext } from '../http/context.js';
import { DESK_ROLES, signedInPerson } from '../http/context.js';
import { conflict, notFound, validation } from '../http/errors.js';
import { sendJson } from '../http/http-io.js';
import { bodyObject, isInteger } from '../http/validate.js';
import { cutView, programmeSummaryView, workDetailView } from '../view/programme-view.js';

const PRINCIPAL = ['principal_librarian'] as const;
const CUT_ALREADY_RESTORED = 'That cut was already restored.';

export async function readWork(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const workId = context.params.id ?? '';
  const programmeId = await programmeIdOfWork(pool, workId);
  if (programmeId === null) throw notFound();
  const aggregate = await visibleProgramme(pool, person, programmeId);
  requireRole(person, DESK_ROLES);
  const work = aggregate.works.find((entry) => entry.row.id === workId);
  if (!work) throw notFound();
  sendJson(context.response, 200, workDetailView(programmeId, work, stringCountOf(aggregate.row)));
}

export async function createCut(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const workId = context.params.id ?? '';
  const programmeId = await programmeIdOfWork(pool, workId);
  if (programmeId === null) throw notFound();
  const aggregate = await visibleProgramme(pool, person, programmeId);
  requireRole(person, PRINCIPAL);
  const work = aggregate.works.find((entry) => entry.row.id === workId);
  if (!work) throw notFound();
  requireNotClosed(aggregate);

  const body = bodyObject(context.jsonBody);
  const errors: Record<string, string> = {};
  const fromBar = body.from_bar;
  const toBar = body.to_bar;
  if (!isInteger(fromBar) || fromBar < 1 || fromBar > work.row.bars) {
    errors.from_bar = `Enter a bar from 1 to ${work.row.bars}.`;
  }
  if (!isInteger(toBar) || toBar < 1 || toBar > work.row.bars) {
    errors.to_bar = `Enter a bar from 1 to ${work.row.bars}.`;
  }
  if (isInteger(fromBar) && isInteger(toBar) && fromBar > toBar && !errors.from_bar && !errors.to_bar) {
    errors.to_bar = 'The last bar of a cut cannot come before its first bar.';
  }
  if (Object.keys(errors).length > 0 || !isInteger(fromBar) || !isInteger(toBar)) throw validation(errors);

  const result = await withTransaction(async (db) => {
    await db.query(`SELECT 1 FROM programme_works WHERE id = $1 FOR UPDATE`, [workId]);
    const overlapping = await db.query(
      `SELECT 1 FROM cuts
        WHERE programme_work_id = $1 AND int4range(from_bar, to_bar, '[]') && int4range($2, $3, '[]')`,
      [workId, fromBar, toBar],
    );
    if (overlapping.rows.length > 0) {
      throw conflict('cut_overlaps', `Bars ${barSpanLabel(fromBar, toBar)} overlap an existing cut.`);
    }
    const cutId = `ct-${randomBytes(8).toString('hex')}`;
    await db.query(`INSERT INTO cuts (id, programme_work_id, from_bar, to_bar) VALUES ($1, $2, $3, $4)`, [
      cutId,
      workId,
      fromBar,
      toBar,
    ]);
    const stored = await db.query<{ from_bar: number; to_bar: number }>(
      `SELECT from_bar, to_bar FROM cuts WHERE programme_work_id = $1`,
      [workId],
    );
    if (cutBarCount(stored.rows) >= work.row.bars) {
      throw conflict('cut_removes_whole_work', "A cut can't remove every bar of a work.");
    }
    const reloaded = await loadProgrammeAggregate(db, programmeId);
    const reloadedWork = reloaded?.works.find((entry) => entry.row.id === workId);
    if (!reloaded || !reloadedWork) throw new Error(`work ${workId} could not be read back`);
    const cut = reloadedWork.cuts.find((entry) => entry.id === cutId);
    if (!cut) throw new Error(`cut ${cutId} could not be read back`);
    return { reloaded, reloadedWork, cut };
  });

  sendJson(context.response, 201, {
    cut: cutView(result.reloadedWork, result.cut),
    work: workDetailView(programmeId, result.reloadedWork, stringCountOf(result.reloaded.row)),
    programme: programmeSummaryView(result.reloaded, await viewContext(pool, context)),
  });
}

export async function deleteCut(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const cutId = context.params.id ?? '';
  const located = await pool.query<{ programme_work_id: string; programme_id: string }>(
    `SELECT c.programme_work_id, pw.programme_id
       FROM cuts c JOIN programme_works pw ON pw.id = c.programme_work_id
      WHERE c.id = $1`,
    [cutId],
  );
  const row = located.rows[0];
  if (!row) throw notFound(CUT_ALREADY_RESTORED);
  const aggregate = await visibleProgramme(pool, person, row.programme_id);
  requireRole(person, PRINCIPAL);
  requireNotClosed(aggregate);

  const result = await withTransaction(async (db) => {
    const deleted = await db.query(`DELETE FROM cuts WHERE id = $1`, [cutId]);
    if (deleted.rowCount === 0) throw notFound(CUT_ALREADY_RESTORED);
    const reloaded = await loadProgrammeAggregate(db, row.programme_id);
    const work = reloaded?.works.find((entry) => entry.row.id === row.programme_work_id);
    if (!reloaded || !work) throw new Error(`work ${row.programme_work_id} could not be read back`);
    return { reloaded, work };
  });

  sendJson(context.response, 200, {
    work: workDetailView(row.programme_id, result.work, stringCountOf(result.reloaded.row)),
    programme: programmeSummaryView(result.reloaded, await viewContext(pool, context)),
  });
}
