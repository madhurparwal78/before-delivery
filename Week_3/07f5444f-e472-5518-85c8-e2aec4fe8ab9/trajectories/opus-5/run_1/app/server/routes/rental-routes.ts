import { randomBytes } from 'node:crypto';
import type { RentalStatus } from '../../shared/api.js';
import { businessDateOf } from '../../shared/london.js';
import type { RentalAggregate } from '../data/rentals.js';
import { loadRentalAggregate, loadRentalAggregates } from '../data/rentals.js';
import { pool, withTransaction } from '../db/pool.js';
import type { Queryable } from '../db/pool.js';
import { readSingleLineText } from '../domain/text.js';
import { RENTAL_STATUS_LABELS, RENTAL_TRANSITION_TARGETS, rentalEdge } from '../domain/transitions.js';
import { requireDeskVisibility, requireRole } from '../http/access.js';
import type { RequestContext } from '../http/context.js';
import { LIBRARIANS, signedInPerson } from '../http/context.js';
import { conflict, forbidden, notFound, validation } from '../http/errors.js';
import { sendJson } from '../http/http-io.js';
import { bodyObject, isArray, isInteger, isObject, isString } from '../http/validate.js';
import { sweepReminders } from '../services/reminders.js';
import { copiesMissing, rentalSetView } from '../view/rental-view.js';

const PRINCIPAL = ['principal_librarian'] as const;
const COUNTS_MESSAGE = 'Returned copies must be from 0 to the slip count.';

function today(): string {
  return businessDateOf(Date.now());
}

async function locateRentalSet(context: RequestContext, db: Queryable): Promise<RentalAggregate> {
  const person = signedInPerson(context);
  requireDeskVisibility(person);
  const aggregate = await loadRentalAggregate(db, context.params.id ?? '');
  if (!aggregate) throw notFound();
  requireRole(person, LIBRARIANS);
  return aggregate;
}

export async function listRentalSets(context: RequestContext): Promise<void> {
  requireRole(signedInPerson(context), LIBRARIANS);
  const aggregates = await loadRentalAggregates(pool, null);
  const todayDate = today();
  const sets = aggregates
    .map((aggregate) => rentalSetView(aggregate, todayDate))
    .sort((left, right) => (left.due_date < right.due_date ? -1 : left.due_date > right.due_date ? 1 : 0));
  sendJson(context.response, 200, { rental_sets: sets });
}

export async function createRentalSet(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  requireDeskVisibility(person);
  const body = bodyObject(context.jsonBody);
  if (!isString(body.work_id)) throw validation({ work_id: 'Choose a work.' });
  const work = await pool.query<{ id: string; title: string }>(
    `SELECT pw.id, cw.title
       FROM programme_works pw JOIN catalogue_works cw ON cw.id = pw.catalogue_work_id
      WHERE pw.id = $1`,
    [body.work_id],
  );
  const workRow = work.rows[0];
  if (!workRow) throw notFound();
  requireRole(person, PRINCIPAL);

  const parts = await pool.query<{ id: string; ord: number }>(
    `SELECT id, ord FROM parts WHERE programme_work_id = $1 ORDER BY ord`,
    [workRow.id],
  );
  const partOrder = new Map(parts.rows.map((part) => [part.id, part.ord]));

  const errors: Record<string, string> = {};
  const publisher = readSingleLineText('publisher', body.publisher);
  if (publisher.message !== null) errors.publisher = publisher.message;

  const rawSlip = body.slip;
  const slip: { part_id: string; copies: number; ord: number }[] = [];
  if (!isArray(rawSlip) || rawSlip.length === 0) {
    errors.slip = 'Add at least one slip line.';
  } else {
    const seen = new Set<string>();
    for (const line of rawSlip) {
      if (!isObject(line) || !isString(line.part_id)) {
        errors.slip = 'Each slip line needs a part and a number of copies.';
        break;
      }
      const ord = partOrder.get(line.part_id);
      if (ord === undefined) throw notFound();
      if (seen.has(line.part_id)) {
        errors.slip = 'Each part can appear on the slip only once.';
        break;
      }
      seen.add(line.part_id);
      if (!isInteger(line.copies) || line.copies < 1 || line.copies > 99) {
        errors.slip = 'Enter 1 to 99 copies for each slip line.';
        break;
      }
      slip.push({ part_id: line.part_id, copies: line.copies, ord });
    }
  }
  if (Object.keys(errors).length > 0) throw validation(errors);

  const created = await withTransaction(async (db) => {
    await db.query(`SELECT 1 FROM programme_works WHERE id = $1 FOR UPDATE`, [workRow.id]);
    const open = await db.query(
      `SELECT 1 FROM rental_sets WHERE programme_work_id = $1 AND status <> 'checked_in'`,
      [workRow.id],
    );
    if (open.rows.length > 0) {
      throw conflict('rental_set_open', `${workRow.title} already has an open rental set.`);
    }
    const id = `rs-${randomBytes(8).toString('hex')}`;
    await db.query(
      `INSERT INTO rental_sets (id, programme_work_id, publisher, status) VALUES ($1, $2, $3, 'requested')`,
      [id, workRow.id, publisher.value],
    );
    for (const line of slip) {
      await db.query(
        `INSERT INTO rental_slip_lines (rental_set_id, part_id, copies, checked_in, ord) VALUES ($1, $2, $3, 0, $4)`,
        [id, line.part_id, line.copies, line.ord],
      );
    }
    const aggregate = await loadRentalAggregate(db, id);
    if (!aggregate) throw new Error(`rental set ${id} could not be read back`);
    return aggregate;
  });

  await sweepReminders();
  const reloaded = await loadRentalAggregate(pool, created.row.id);
  sendJson(context.response, 201, rentalSetView(reloaded ?? created, today()));
}

export async function transitionRentalSet(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const aggregate = await locateRentalSet(context, pool);
  const body = bodyObject(context.jsonBody);
  const to = body.to;
  if (!isString(to) || !RENTAL_TRANSITION_TARGETS.includes(to as RentalStatus)) {
    throw validation({ to: 'Choose a status this rental set can move to.' });
  }
  const target = to as RentalStatus;
  if (person.role === 'assistant_librarian' && target !== 'returned') throw forbidden();

  const updated = await withTransaction(async (db) => {
    const locked = await db.query<{ status: RentalStatus }>(
      `SELECT status FROM rental_sets WHERE id = $1 FOR UPDATE`,
      [aggregate.row.id],
    );
    const current = locked.rows[0]?.status;
    if (!current) throw notFound();
    if (!rentalEdge(current, target)) {
      throw conflict(
        'illegal_transition',
        `${aggregate.row.work_title} set can't move from ${RENTAL_STATUS_LABELS[current]} to ${RENTAL_STATUS_LABELS[target]}.`,
      );
    }
    if (target === 'returned') {
      const fresh = await loadRentalAggregate(db, aggregate.row.id);
      if (!fresh) throw notFound();
      const missing = copiesMissing(fresh);
      if (missing.length > 0) {
        const total = missing.reduce((sum, line) => sum + line.missing, 0);
        const detail = missing.map((line) => `${line.part_name} ${line.missing}`).join(', ');
        throw conflict(
          'copies_missing',
          `Can't mark returned: ${total} ${total === 1 ? 'copy' : 'copies'} missing (${detail}).`,
          { missing },
        );
      }
      await db.query(`UPDATE rental_sets SET status = 'returned', returned_at = now() WHERE id = $1`, [
        aggregate.row.id,
      ]);
    } else {
      await db.query(`UPDATE rental_sets SET status = $2 WHERE id = $1`, [aggregate.row.id, target]);
    }
    const reloaded = await loadRentalAggregate(db, aggregate.row.id);
    if (!reloaded) throw new Error(`rental set ${aggregate.row.id} could not be read back`);
    return reloaded;
  });

  sendJson(context.response, 200, rentalSetView(updated, today()));
}

export async function saveCheckIn(context: RequestContext): Promise<void> {
  const aggregate = await locateRentalSet(context, pool);
  const body = bodyObject(context.jsonBody);
  const rawCounts = body.counts;
  if (!isArray(rawCounts)) throw validation({ counts: COUNTS_MESSAGE });

  const requested: { part_id: string; copies: number; expected: number }[] = [];
  for (const line of rawCounts) {
    if (!isObject(line) || !isString(line.part_id)) throw validation({ counts: COUNTS_MESSAGE });
    if (!aggregate.slip.some((slipLine) => slipLine.part_id === line.part_id)) throw notFound();
    if (!isInteger(line.copies) || !isInteger(line.expected)) throw validation({ counts: COUNTS_MESSAGE });
    requested.push({ part_id: line.part_id, copies: line.copies, expected: line.expected });
  }

  const updated = await withTransaction(async (db) => {
    const locked = await db.query<{ status: RentalStatus }>(
      `SELECT status FROM rental_sets WHERE id = $1 FOR UPDATE`,
      [aggregate.row.id],
    );
    const status = locked.rows[0]?.status;
    if (!status) throw notFound();
    if (status !== 'in_use') {
      throw conflict(
        'wrong_status',
        `Counts can't change: ${aggregate.row.work_title} set is already ${RENTAL_STATUS_LABELS[status]}.`,
      );
    }
    const fresh = await loadRentalAggregate(db, aggregate.row.id);
    if (!fresh) throw notFound();

    const stale = fresh.slip.filter((slipLine) => {
      const named = requested.find((line) => line.part_id === slipLine.part_id);
      return named !== undefined && named.expected !== slipLine.checked_in;
    });
    if (stale.length > 0) {
      throw conflict('count_changed', 'Counts changed while you were typing.', {
        lines: stale.map((line) => ({
          part_id: line.part_id,
          part_name: line.part_name,
          checked_in: line.checked_in,
        })),
      });
    }

    for (const line of requested) {
      const slipLine = fresh.slip.find((entry) => entry.part_id === line.part_id);
      if (!slipLine || line.copies < 0 || line.copies > slipLine.copies) {
        throw validation({ counts: COUNTS_MESSAGE });
      }
    }
    for (const line of requested) {
      await db.query(
        `UPDATE rental_slip_lines SET checked_in = $3 WHERE rental_set_id = $1 AND part_id = $2`,
        [aggregate.row.id, line.part_id, line.copies],
      );
    }
    const reloaded = await loadRentalAggregate(db, aggregate.row.id);
    if (!reloaded) throw new Error(`rental set ${aggregate.row.id} could not be read back`);
    return reloaded;
  });

  sendJson(context.response, 200, rentalSetView(updated, today()));
}
