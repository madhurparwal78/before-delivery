import { PoolClient } from 'pg';
import { GRADES } from '../../shared/constants';
import { boardLongestClearRun } from '../../shared/geometry';
import { volumeMm3 } from '../../shared/money';
import { pool, query, rows, transaction } from '../db/pool';
import {
  BoardRow,
  BoardStatus,
  boardDetail,
  boardSummary,
  isOpen,
  isPubliclyVisible,
  isRetired,
  loadAllBoards,
  loadBoard,
  loadPhotos,
  nextBoardTag
} from '../domain/boards';
import { computeFit } from '../domain/fit';
import { holdShape, loadMyHold, releaseExpiredHolds } from '../domain/holds';
import { ADJUSTMENT_ACCOUNT, INTAKE_ACCOUNT, accountBalance, boardAccount, writeMovement } from '../domain/ledger';
import { descendantsInOrder, isSelfOrDescendant, lineageTree, lockLineage } from '../domain/lineage';
import { RateBook, ratesInForce } from '../domain/rates';
import { readDefects, readFilterInteger, readIntakeDimensions, readPieces, readSpecies } from '../domain/validate';
import { ApiError, FieldErrors } from '../errors';
import { Reply, RequestContext, STAFF, jsonReply, pathParam, requireRole } from '../http';
import { Route, route } from './types';

const ALL_STATUSES: BoardStatus[] = ['tagged', 'graded', 'available', 'held', 'sold-whole', 'cut'];

function isStaff(context: RequestContext): boolean {
  return context.user !== null && context.user.role !== 'maker';
}

async function requireVisibleBoard(context: RequestContext, tag: string): Promise<BoardRow> {
  const board = await loadBoard(pool, tag);
  if (board === null) throw new ApiError('not_found');
  if (!isStaff(context) && !isPubliclyVisible(board.status)) throw new ApiError('not_found');
  return board;
}

async function listBoards(context: RequestContext): Promise<Reply> {
  await releaseExpiredHolds(pool, context.now);
  const search = context.url.searchParams;
  const species = search.getAll('species');
  const grades = search.getAll('grade');
  const minLength = readFilterInteger(search.get('min_length_mm'), 'min_length_mm');
  const minClear = readFilterInteger(search.get('min_clear_mm'), 'min_clear_mm');
  const lot = search.get('lot');
  const requested = search.getAll('status');

  let statuses: BoardStatus[] = ['available', 'held'];
  if (isStaff(context) && requested.length > 0) {
    for (const value of requested) {
      if (!(ALL_STATUSES as string[]).includes(value)) throw new ApiError('validation', { status: 'That board status is not known.' });
    }
    statuses = requested as BoardStatus[];
  }

  const rates = await ratesInForce(pool, context.now);
  const all = await loadAllBoards(pool);
  const matching = all.filter((board) => {
    if (!statuses.includes(board.status)) return false;
    if (species.length > 0 && !species.includes(board.species)) return false;
    if (grades.length > 0 && (board.grade === null || !grades.includes(board.grade))) return false;
    if (minLength !== null && board.length_mm < minLength) return false;
    if (minClear !== null && boardLongestClearRun(board) < minClear) return false;
    if (lot !== null && lot !== '' && board.lot_id !== lot) return false;
    return true;
  });
  return jsonReply(200, { count: matching.length, boards: matching.map((board) => boardSummary(board, rates)) });
}

async function readBoard(context: RequestContext): Promise<Reply> {
  await releaseExpiredHolds(pool, context.now);
  const board = await requireVisibleBoard(context, pathParam(context, 'tag'));
  const rates = await ratesInForce(pool, context.now);
  const photos = await loadPhotos(pool, board.tag);
  const mine = context.user !== null && context.user.role === 'maker' ? await loadMyHold(pool, board.tag, context.user.id) : null;
  return jsonReply(200, {
    board: boardDetail(board, rates, photos, mine === null ? null : holdShape(mine, false))
  });
}

async function tagBoard(context: RequestContext): Promise<Reply> {
  const staff = requireRole(context, STAFF);
  const body = context.json;

  const lot = body.lot;
  if (typeof lot === 'string' && lot !== '') {
    const found = await query<{ id: string }>('SELECT id FROM lots WHERE id = $1', [lot]);
    if (found[0] === undefined) throw new ApiError('not_found');
  }

  const errors = new FieldErrors();
  if (typeof lot !== 'string' || lot === '') errors.add('lot', 'Choose a salvage lot.');
  const species = readSpecies(body.species, errors);
  readIntakeDimensions(body, errors);
  const lengthMm = typeof body.length_mm === 'number' ? body.length_mm : 0;
  const defects = readDefects(body.defects, lengthMm, errors);
  errors.throwIfAny();

  const created = await transaction(async (client) => {
    const tag = await nextBoardTag(client);
    await client.query(
      `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, defects, created_at)
       VALUES ($1, $2, NULL, 'tagged', $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        tag,
        species,
        lot,
        body.length_mm,
        body.width_mm,
        body.thickness_mm,
        JSON.stringify(defects),
        context.now
      ]
    );
    const volume = volumeMm3(Number(body.thickness_mm), Number(body.width_mm), Number(body.length_mm));
    await writeMovement(client, {
      kind: 'intake',
      ticketId: null,
      byUserId: staff.id,
      at: context.now,
      entries: [
        { account: INTAKE_ACCOUNT, volume_mm3: -volume },
        { account: boardAccount(tag), volume_mm3: volume }
      ]
    });
    const board = await loadBoard(client, tag);
    if (board === null) throw new Error('board was not created');
    return board;
  });

  const rates = await ratesInForce(pool, context.now);
  return jsonReply(201, { board: boardDetail(created, rates, [], null) });
}

async function assertOffcutReady(client: PoolClient, board: BoardRow): Promise<void> {
  if (board.cut_ticket_id === null) return;
  const found = await rows<{ status: string }>(client, 'SELECT status FROM tickets WHERE id = $1', [board.cut_ticket_id]);
  if (found[0] !== undefined && found[0].status !== 'done') throw new ApiError('offcut_not_cut');
}

async function gradeBoard(context: RequestContext): Promise<Reply> {
  requireRole(context, ['owner']);
  const tag = pathParam(context, 'tag');
  const existing = await loadBoard(pool, tag);
  if (existing === null) throw new ApiError('not_found');

  const result = await transaction(async (client) => {
    await lockLineage(client, tag);
    const board = await loadBoard(client, tag);
    if (board === null) throw new ApiError('not_found');

    let affected: BoardRow[];
    if (board.status === 'tagged' || board.status === 'graded') {
      affected = [board];
    } else if (board.status === 'cut') {
      affected = (await descendantsInOrder(client, tag)).filter(
        (row) => row.status === 'graded' || row.status === 'available'
      );
    } else {
      throw new ApiError('board_state');
    }
    if (affected.length === 0) throw new ApiError('board_state');
    if (affected.some((row) => row.status === 'held')) throw new ApiError('board_state');
    for (const row of affected) await assertOffcutReady(client, row);

    const grade = context.json.grade;
    if (typeof grade !== 'string' || !(GRADES as readonly string[]).includes(grade)) {
      throw new ApiError('validation', { grade: 'Choose Select, Character or Rustic.' });
    }

    for (const row of affected) {
      const nextStatus = row.status === 'tagged' ? 'graded' : row.status;
      await client.query('UPDATE boards SET grade = $2, status = $3 WHERE tag = $1', [row.tag, grade, nextStatus]);
    }
    const updated = await loadBoard(client, tag);
    if (updated === null) throw new Error('board vanished during the regrade');
    return { board: updated, changed: affected.map((row) => row.tag) };
  });

  const rates = await ratesInForce(pool, context.now);
  const photos = await loadPhotos(pool, tag);
  return jsonReply(200, { board: boardDetail(result.board, rates, photos, null), changed: result.changed });
}

async function listOnRack(context: RequestContext): Promise<Reply> {
  requireRole(context, ['owner']);
  const tag = pathParam(context, 'tag');
  const existing = await loadBoard(pool, tag);
  if (existing === null) throw new ApiError('not_found');

  const updated = await transaction(async (client) => {
    const board = await loadBoard(client, tag);
    if (board === null) throw new ApiError('not_found');
    if (board.status !== 'graded') throw new ApiError('board_state');
    await assertOffcutReady(client, board);
    await client.query(`UPDATE boards SET status = 'available' WHERE tag = $1`, [tag]);
    const after = await loadBoard(client, tag);
    if (after === null) throw new Error('board vanished while being listed');
    return after;
  });

  const rates = await ratesInForce(pool, context.now);
  const photos = await loadPhotos(pool, tag);
  return jsonReply(200, { board: boardDetail(updated, rates, photos, null) });
}

async function correctDimensions(context: RequestContext): Promise<Reply> {
  const owner = requireRole(context, ['owner']);
  const tag = pathParam(context, 'tag');
  const existing = await loadBoard(pool, tag);
  if (existing === null) throw new ApiError('not_found');
  const hasLength = context.json.length_mm !== undefined && context.json.length_mm !== null;

  const result = await transaction(async (client) => {
    await lockLineage(client, tag);
    const board = await loadBoard(client, tag);
    if (board === null) throw new ApiError('not_found');

    const descendants = await descendantsInOrder(client, tag);
    const affected = [...(isOpen(board.status) ? [board] : []), ...descendants.filter((row) => isOpen(row.status))];
    if (affected.length === 0) throw new ApiError('board_state');
    if (affected.some((row) => row.status === 'held')) throw new ApiError('board_state');
    if (hasLength && !isOpen(board.status)) throw new ApiError('board_state');
    for (const row of affected) await assertOffcutReady(client, row);

    const errors = new FieldErrors();
    const checks: Array<[string, number, number]> = [
      ['width_mm', 20, 600],
      ['thickness_mm', 10, 400]
    ];
    for (const [field, low, high] of checks) {
      const value = context.json[field];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
        errors.add(field, `Give a whole number of millimetres from ${low} to ${high}.`);
      }
    }
    if (hasLength) {
      const length = context.json.length_mm;
      const defectEnd = board.defects.reduce((most, zone) => Math.max(most, zone.end_mm), 0);
      if (typeof length !== 'number' || !Number.isInteger(length) || length < 300 || length > 12_000 || length < defectEnd) {
        errors.add('length_mm', 'Give a whole number of millimetres that covers every defect zone.');
      }
    }
    errors.throwIfAny();

    const widthMm = Number(context.json.width_mm);
    const thicknessMm = Number(context.json.thickness_mm);
    const entries: Array<{ account: string; volume_mm3: number }> = [];
    for (const row of affected) {
      const lengthMm = row.tag === tag && hasLength ? Number(context.json.length_mm) : row.length_mm;
      await client.query('UPDATE boards SET width_mm = $2, thickness_mm = $3, length_mm = $4 WHERE tag = $1', [
        row.tag,
        widthMm,
        thicknessMm,
        lengthMm
      ]);
      const balance = await accountBalance(client, boardAccount(row.tag));
      const change = volumeMm3(thicknessMm, widthMm, lengthMm) - balance;
      if (change !== 0) {
        entries.push({ account: boardAccount(row.tag), volume_mm3: change });
        entries.push({ account: ADJUSTMENT_ACCOUNT, volume_mm3: -change });
      }
    }
    if (entries.length > 0) {
      await writeMovement(client, {
        kind: 'adjustment',
        ticketId: null,
        byUserId: owner.id,
        at: context.now,
        entries
      });
    }
    const updated = await loadBoard(client, tag);
    if (updated === null) throw new Error('board vanished during the re-measure');
    return { board: updated, changed: affected.map((row) => row.tag) };
  });

  const rates = await ratesInForce(pool, context.now);
  const photos = await loadPhotos(pool, tag);
  return jsonReply(200, { board: boardDetail(result.board, rates, photos, null), changed: result.changed });
}

async function reParent(context: RequestContext): Promise<Reply> {
  requireRole(context, ['owner']);
  const tag = pathParam(context, 'tag');
  const existing = await loadBoard(pool, tag);
  if (existing === null) throw new ApiError('not_found');

  const parentTag = context.json.parent_tag;
  if (parentTag !== null && parentTag !== undefined) {
    if (typeof parentTag !== 'string') throw new ApiError('validation', { parent_tag: 'Give a board tag or null.' });
    const candidate = await loadBoard(pool, parentTag);
    if (candidate === null) throw new ApiError('not_found');
  }

  const updated = await transaction(async (client) => {
    await lockLineage(client, tag);
    const board = await loadBoard(client, tag);
    if (board === null) throw new ApiError('not_found');
    if (board.from_cut) throw new ApiError('board_state');

    if (parentTag === null || parentTag === undefined) {
      await client.query('UPDATE boards SET parent_tag = NULL WHERE tag = $1', [tag]);
    } else {
      const next = typeof parentTag === 'string' ? parentTag : '';
      if (await isSelfOrDescendant(client, next, tag)) throw new ApiError('lineage_cycle');
      const candidate = await loadBoard(client, next);
      if (candidate === null) throw new ApiError('not_found');
      if (candidate.status !== 'cut' || candidate.species !== board.species) {
        throw new ApiError('validation', { parent_tag: 'Choose a cut board of the same species.' });
      }
      await client.query('UPDATE boards SET parent_tag = $2 WHERE tag = $1', [tag, next]);
    }
    const after = await loadBoard(client, tag);
    if (after === null) throw new Error('board vanished during re-parenting');
    return after;
  });

  const rates = await ratesInForce(pool, context.now);
  const photos = await loadPhotos(pool, tag);
  return jsonReply(200, { board: boardDetail(updated, rates, photos, null) });
}

async function readLineage(context: RequestContext): Promise<Reply> {
  requireRole(context, STAFF);
  const tag = pathParam(context, 'tag');
  const board = await loadBoard(pool, tag);
  if (board === null) throw new ApiError('not_found');
  const rates = await ratesInForce(pool, context.now);
  return jsonReply(200, { board: board.tag, root: await lineageTree(pool, board, rates) });
}

function rateForBoard(board: BoardRow, rates: RateBook): number | null {
  if (board.grade === null || isRetired(board.status)) return null;
  return rates.rateFor(board.species, board.grade);
}

async function fitLayout(context: RequestContext): Promise<Reply> {
  const board = await requireVisibleBoard(context, pathParam(context, 'tag'));
  const pieces = readPieces(context.json.pieces);
  const rates = await ratesInForce(pool, context.now);
  return jsonReply(200, computeFit(board, pieces, rateForBoard(board, rates)));
}

export const boardRoutes: Route[] = [
  route('GET', '/api/boards', false, listBoards),
  route('POST', '/api/boards', true, tagBoard),
  route('GET', '/api/boards/:tag', false, readBoard),
  route('POST', '/api/boards/:tag/grade', true, gradeBoard),
  route('POST', '/api/boards/:tag/list', true, listOnRack),
  route('PUT', '/api/boards/:tag/dimensions', true, correctDimensions),
  route('PUT', '/api/boards/:tag/parent', true, reParent),
  route('GET', '/api/boards/:tag/lineage', true, readLineage),
  route('POST', '/api/boards/:tag/fit', false, fitLayout)
];

export { rateForBoard, requireVisibleBoard };
