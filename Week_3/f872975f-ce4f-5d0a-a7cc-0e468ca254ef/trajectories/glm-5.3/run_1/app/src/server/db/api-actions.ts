import type { PoolClient } from 'pg';
import type { RouteState } from '../http/router.js';
import type { Ctx } from '../http/router.js';
import type { HoldRecord, InvoiceRecord, TicketRecord, User } from './store.js';
import { mapBoard, mapHold } from './store.js';
import { ApiError } from '../http/errors.js';
import { boardSummary, canViewBoard, isStaff } from '../api/shapes.js';
import { DEPOSIT_CENTS, GRADES, KERF_ROUND_MM, MAX_PHOTOS_PER_BOARD, OPEN_STATUSES } from '../domain/constants.js';
import { allocateLines, boardFeetString, priceCents, volumeMm3 } from '../domain/money.js';
import { computeFit, type PieceInput } from '../domain/geometry.js';
import { LayoutFileError, migrateLayoutFile, serializeLayout } from '../domain/layout.js';
import { renderTicketPdf, type TicketPdfData } from '../services/pdf.js';
import { buildCopies, signatureMatches, pixelCount, type ImageKind } from '../services/images.js';
import type { KillBillLike } from './actions.js';
import { fingerprint } from './actions.js';
import { validateOffcutMm } from '../domain/validation.js';

const DECLINED_CARD = '4000000000000002';

// ---------------------------------------------------------------------------
// boards

export async function listBoards(state: RouteState, ctx: Ctx): Promise<Record<string, unknown>> {
  const species = ctx.query.getAll('species');
  const grades = ctx.query.getAll('grade');
  const minLengthRaw = ctx.query.get('min_length_mm');
  const minClearRaw = ctx.query.get('min_clear_mm');
  const lot = ctx.query.get('lot');
  const statusParams = ctx.query.getAll('status');
  const staff = isStaff(ctx.user);
  const fields: Record<string, string> = {};
  let minLengthMm: number | undefined;
  let minClearMm: number | undefined;
  if (minLengthRaw !== null && minLengthRaw !== '') {
    const value = Number(minLengthRaw);
    if (!Number.isInteger(value) || value < 0 || value > 12000) fields['min_length_mm'] = 'Minimum length must be an integer from 0 to 12,000.';
    else minLengthMm = value;
  }
  if (minClearRaw !== null && minClearRaw !== '') {
    const value = Number(minClearRaw);
    if (!Number.isInteger(value) || value < 0 || value > 12000) fields['min_clear_mm'] = 'Minimum clear run must be an integer from 0 to 12,000.';
    else minClearMm = value;
  }
  let statuses: string[] | undefined;
  if (staff && statusParams.length > 0) {
    statuses = [];
    for (const status of statusParams) {
      if (!['tagged', 'graded', 'available', 'held', 'sold-whole', 'cut'].includes(status)) {
        fields['status'] = 'Unknown board status.';
      } else {
        statuses.push(status);
      }
    }
  }
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);
  const boards = await state.store.boards({ statuses, species, grades, minLengthMm, minClearMm, lot: lot ?? undefined });
  const now = new Date();
  const summaries: Array<Record<string, unknown>> = [];
  for (const board of boards) {
    const rate = board.grade ? await state.store.rateInForce(board.species, board.grade, now) : null;
    summaries.push(boardSummary(board, rate));
  }
  return { count: boards.length, boards: summaries };
}

export async function boardDetail(state: RouteState, ctx: Ctx, tag: string): Promise<Record<string, unknown>> {
  const board = await state.store.board(tag);
  if (board === null || !canViewBoard(ctx.user, board.status)) throw new ApiError('not_found', 'Board not found');
  const now = new Date();
  const rate = board.grade ? await state.store.rateInForce(board.species, board.grade, now) : null;
  const summary = boardSummary(board, rate);
  const photos = await state.store.photos(tag);
  let myHold: Record<string, unknown> | null = null;
  if (ctx.user !== null && ctx.user.role === 'maker') {
    const holds = await state.store.holds({ makerId: ctx.user.id, status: ['pending-payment', 'held'] });
    const mine = holds.find((h) => h.board_tag === tag) ?? null;
    if (mine !== null) myHold = holdJsonFor(mine, false);
  }
  return {
    board: {
      ...summary,
      lot: { id: board.lot.id, name: board.lot.name, origin: board.lot.origin, built_year: board.lot.built_year },
      photos: photos.map((p) => ({ id: p.id, url: `/api/photos/${p.id}`, thumb_url: `/api/photos/${p.id}/thumb`, width: p.width, height: p.height })),
      my_hold: myHold,
    },
  };
}

export async function intakeBoard(state: RouteState, user: User, data: { lot: string; species: string; lengthMm: number; widthMm: number; thicknessMm: number; defects: Array<{ kind: string; startMm: number; endMm: number }> }): Promise<Record<string, unknown>> {
  const lot = await state.store.lot(data.lot);
  if (lot === null) throw new ApiError('not_found', 'Unknown lot');
  const tag = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const tag = await state.actions.allocateTag(client);
    await client.query(
      `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, parent_tag, from_intake, created_at)
       VALUES ($1, $2, NULL, 'tagged', $3, $4, $5, $6, NULL, true, now())`,
      [tag, data.species, data.lot, data.lengthMm, data.widthMm, data.thicknessMm],
    );
    for (let i = 0; i < data.defects.length; i += 1) {
      const defect = data.defects[i];
      await client.query(
        'INSERT INTO defect_zones (board_tag, kind, start_mm, end_mm, position) VALUES ($1, $2, $3, $4, $5)',
        [tag, defect.kind, defect.startMm, defect.endMm, i],
      );
    }
    const volume = BigInt(data.lengthMm) * BigInt(data.widthMm) * BigInt(data.thicknessMm);
    const movement = await client.query('INSERT INTO ledger_movements (kind, ticket, by_user_id) VALUES ($1, NULL, $2) RETURNING id', ['intake', user.id]);
    await client.query(
      'INSERT INTO ledger_entries (movement_id, account, volume_mm3) VALUES ($1, $2, $3), ($1, $4, $5)',
      [movement.rows[0].id, 'intake', -volume, `board:${tag}`, volume],
    );
    await client.query('COMMIT');
    return tag;
  });
  const board = await state.store.board(tag);
  if (board === null) throw new ApiError('not_found', 'Board not found');
  return { board: boardSummary(board, null) };
}

export async function uploadPhoto(state: RouteState, tag: string, ctx: Ctx): Promise<Record<string, unknown>> {
  if (ctx.contentType !== 'image/jpeg' && ctx.contentType !== 'image/png') {
    throw new ApiError('unsupported_media_type', 'Only JPEG and PNG photos are accepted');
  }
  if (ctx.bodyOverflow || ctx.body.length > 5000000) throw new ApiError('too_large', 'Photo too large');
  const kind: ImageKind = ctx.contentType === 'image/png' ? 'png' : 'jpeg';
  if (!signatureMatches(ctx.body, ctx.contentType)) {
    throw new ApiError('unsupported_media_type', 'The file contents do not match its type');
  }
  const board = await state.store.board(tag);
  if (board === null) throw new ApiError('not_found', 'Board not found');
  if (board.status === 'sold-whole' || board.status === 'cut') {
    throw new ApiError('board_state', 'Photos may only be added to an open board');
  }
  const pixels = pixelCount(ctx.body, kind);
  if (pixels === null) throw new ApiError('validation', 'Check the highlighted fields.', { photo: 'The photo could not be read.' });
  if (pixels > 40000000) throw new ApiError('validation', 'Check the highlighted fields.', { photo: 'The photo is too large.' });
  const count = await state.store.photoCount(tag);
  if (count >= MAX_PHOTOS_PER_BOARD) {
    throw new ApiError('validation', 'Check the highlighted fields.', { photo: 'A board holds at most 8 photos.' });
  }
  const copies = buildCopies(ctx.body, kind);
  if (copies === null) throw new ApiError('validation', 'Check the highlighted fields.', { photo: 'The photo could not be read.' });
  const photoId = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const photoId = await state.actions.allocateId(client, 'photo', 'PH-', 4);
    await client.query(
      `INSERT INTO photos (id, board_tag, content_type, key, width, height, position)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(max(position), 0) + 1 FROM photos WHERE board_tag = $2))`,
      [photoId, tag, ctx.contentType, `photos/${tag}/${photoId}/original.${kind === 'jpeg' ? 'jpg' : 'png'}`, copies.width, copies.height],
    );
    await client.query('COMMIT');
    return photoId;
  });
  const ext = kind === 'jpeg' ? 'jpg' : 'png';
  const originalKey = `photos/${tag}/${photoId}/original.${ext}`;
  const displayKey = `photos/${tag}/${photoId}/display.${ext}`;
  const thumbKey = `photos/${tag}/${photoId}/thumb.${ext}`;
  try {
    await state.storage.put(originalKey, ctx.body, ctx.contentType);
    await state.storage.put(displayKey, copies.display, ctx.contentType);
    await state.storage.put(thumbKey, copies.thumb, ctx.contentType);
  } catch {
    await state.storage.delete(originalKey).catch(() => {});
    await state.storage.delete(displayKey).catch(() => {});
    await state.storage.delete(thumbKey).catch(() => {});
    throw new ApiError('storage_unavailable', 'Photo storage is offline');
  }
  return {
    photo: {
      id: photoId,
      url: `/api/photos/${photoId}`,
      thumb_url: `/api/photos/${photoId}/thumb`,
      original_url: `/api/photos/${photoId}/original`,
      key: originalKey,
      width: copies.width,
      height: copies.height,
    },
  };
}

export async function gradeBoard(state: RouteState, tag: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const grade = body['grade'];
  if (typeof grade !== 'string' || !GRADES.includes(grade as (typeof GRADES)[number])) {
    throw new ApiError('validation', 'Check the highlighted fields.', { grade: 'Choose a grade.' });
  }
  const changed = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const affected = await correctionAffectedBoards(client, tag, 'grade', grade);
    for (const target of affected) {
      await client.query('UPDATE boards SET grade = $2, graded_at = now() WHERE tag = $1', [target.tag, grade]);
    }
    // tag -> graded: the board itself moves to graded when it was only tagged
    await client.query(`UPDATE boards SET status = 'graded' WHERE tag = $1 AND status = 'tagged'`, [tag]);
    await client.query('COMMIT');
    return affected.map((a) => a.tag);
  });
  const board = await state.store.board(tag);
  if (board === null) throw new ApiError('not_found', 'Board not found');
  const rate = board.grade ? await state.store.rateInForce(board.species, board.grade, new Date()) : null;
  return { board: boardSummary(board, rate), changed };
}

export async function listBoard(state: RouteState, tag: string): Promise<Record<string, unknown>> {
  const board = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const row = await state.actions.boardRow(client, tag);
    if (row === null) {
      await client.query('ROLLBACK');
      throw new ApiError('not_found', 'Board not found');
    }
    // An offcut may only be listed once its cut ticket is done.
    if (row.from_intake === false) {
      const ticket = await client.query('SELECT status FROM tickets WHERE offcut_tag = $1', [tag]);
      if (ticket.rowCount === 1 && (ticket.rows[0].status as string) !== 'done') {
        await client.query('ROLLBACK');
        throw new ApiError('offcut_not_cut', 'This offcut may not be listed yet');
      }
    }
    if (row.status !== 'graded') {
      await client.query('ROLLBACK');
      throw new ApiError('board_state', 'Only a graded board may be listed');
    }
    await client.query(`UPDATE boards SET status = 'available' WHERE tag = $1`, [tag]);
    await client.query('COMMIT');
    return true;
  });
  void board;
  const updated = await state.store.board(tag);
  if (updated === null) throw new ApiError('not_found', 'Board not found');
  const rate = updated.grade ? await state.store.rateInForce(updated.species, updated.grade, new Date()) : null;
  return { board: boardSummary(updated, rate) };
}

export async function correctDimensions(
  state: RouteState,
  user: User,
  tag: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields: Record<string, string> = {};
  const widthMm = body['width_mm'];
  const thicknessMm = body['thickness_mm'];
  const lengthRaw = body['length_mm'];
  if (typeof widthMm !== 'number' || !Number.isInteger(widthMm) || widthMm < 20 || widthMm > 600) {
    fields['width_mm'] = 'Width must be between 20 and 600 mm.';
  }
  if (typeof thicknessMm !== 'number' || !Number.isInteger(thicknessMm) || thicknessMm < 10 || thicknessMm > 400) {
    fields['thickness_mm'] = 'Thickness must be between 10 and 400 mm.';
  }
  let lengthMm: number | null = null;
  if (lengthRaw !== undefined && lengthRaw !== null) {
    if (typeof lengthRaw !== 'number' || !Number.isInteger(lengthRaw) || lengthRaw < 300 || lengthRaw > 12000) {
      fields['length_mm'] = 'Length must be between 300 and 12,000 mm.';
    } else {
      lengthMm = lengthRaw;
    }
  }
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);

  const changed = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const affected = await correctionAffectedBoards(client, tag, 'dimensions', { widthMm: widthMm as number, thicknessMm: thicknessMm as number, lengthMm });
    const adjustmentEntries: Array<{ account: string; delta: bigint }> = [];
    for (const target of affected) {
      const newLength = target.tag === tag && lengthMm !== null ? lengthMm : target.length_mm;
      const newVolume = BigInt(newLength) * BigInt(widthMm as number) * BigInt(thicknessMm as number);
      const oldVolume = BigInt(target.length_mm) * BigInt(target.width_mm) * BigInt(target.thickness_mm);
      await client.query(
        'UPDATE boards SET width_mm = $2, thickness_mm = $3, length_mm = $4 WHERE tag = $1',
        [target.tag, widthMm, thicknessMm, newLength],
      );
      const delta = newVolume - oldVolume;
      if (delta !== 0n) adjustmentEntries.push({ account: `board:${target.tag}`, delta });
    }
    if (adjustmentEntries.length > 0) {
      const movement = await client.query(
        'INSERT INTO ledger_movements (kind, ticket, by_user_id) VALUES ($1, NULL, $2) RETURNING id',
        ['adjustment', user.id],
      );
      const movementId = movement.rows[0].id as number;
      let total = 0n;
      for (const entry of adjustmentEntries) {
        await client.query('INSERT INTO ledger_entries (movement_id, account, volume_mm3) VALUES ($1, $2, $3)', [movementId, entry.account, entry.delta]);
        total += entry.delta;
      }
      await client.query('INSERT INTO ledger_entries (movement_id, account, volume_mm3) VALUES ($1, $2, $3)', [movementId, 'adjustment', -total]);
    }
    await client.query('COMMIT');
    return affected.map((a) => a.tag);
  });
  const board = await state.store.board(tag);
  if (board === null) throw new ApiError('not_found', 'Board not found');
  const rate = board.grade ? await state.store.rateInForce(board.species, board.grade, new Date()) : null;
  return { board: boardSummary(board, rate), changed };
}

export async function reparent(state: RouteState, tag: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parentTag = body['parent_tag'];
  const board = await state.store.board(tag);
  if (board === null) throw new ApiError('not_found', 'Board not found');
  if (!board.from_intake) throw new ApiError('board_state', 'A board created by a cut ticket cannot be re-parented');
  if (parentTag === null) {
    await state.actions.withClient(async (client) => {
      await client.query('BEGIN');
      await client.query(`UPDATE boards SET parent_tag = NULL WHERE tag = $1`, [tag]);
      await client.query('COMMIT');
    });
  } else {
    if (typeof parentTag !== 'string') throw new ApiError('validation', 'Check the highlighted fields.', { parent_tag: 'Choose a parent board.' });
    const parent = await state.store.board(parentTag);
    if (parent === null) throw new ApiError('validation', 'Check the highlighted fields.', { parent_tag: 'Choose a parent board.' });
    if (parentTag === tag) throw new ApiError('lineage_cycle', 'The parent cannot be the board itself');
    if (await isDescendant(state, parentTag, tag)) throw new ApiError('lineage_cycle', 'The parent cannot be a descendant of the board');
    if (parent.status !== 'cut' || parent.species !== board.species) {
      throw new ApiError('validation', 'Check the highlighted fields.', { parent_tag: 'The parent must be a cut board of the same species.' });
    }
    await state.actions.withClient(async (client) => {
      await client.query('BEGIN');
      await client.query('UPDATE boards SET parent_tag = $2 WHERE tag = $1', [tag, parentTag]);
      await client.query('COMMIT');
    });
  }
  const updated = await state.store.board(tag);
  if (updated === null) throw new ApiError('not_found', 'Board not found');
  const rate = updated.grade ? await state.store.rateInForce(updated.species, updated.grade, new Date()) : null;
  return { board: boardSummary(updated, rate) };
}

async function isDescendant(state: RouteState, maybeDescendant: string, ofTag: string): Promise<boolean> {
  let cursor = maybeDescendant;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === ofTag) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    const row = await state.actions.withClient(async (client) => {
      const result = await client.query('SELECT parent_tag FROM boards WHERE tag = $1', [cursor]);
      return result.rowCount === 1 ? (result.rows[0].parent_tag as string | null) : null;
    });
    if (row === null) return false;
    cursor = row;
  }
  return false;
}

export async function lineage(state: RouteState, tag: string): Promise<Record<string, unknown>> {
  const board = await state.store.board(tag);
  if (board === null) throw new ApiError('not_found', 'Board not found');
  // Walk up to the root, then build the tree from the root down.
  const chain: string[] = [tag];
  const seen = new Set<string>();
  let cursor = tag;
  while (true) {
    const row = await state.actions.withClient(async (client) => {
      const result = await client.query('SELECT parent_tag FROM boards WHERE tag = $1', [cursor]);
      return result.rowCount === 1 ? (result.rows[0].parent_tag as string | null) : null;
    });
    if (row === null) break;
    if (row === null) break;
    if (seen.has(row)) break;
    seen.add(row);
    chain.unshift(row);
    cursor = row;
  }
  const root = chain[0];
  const now = new Date();
  const buildNode = async (nodeTag: string, pathSet: Set<string>, full: boolean): Promise<Record<string, unknown>> => {
    const node = await state.store.board(nodeTag);
    if (node === null) throw new ApiError('not_found', 'Board not found');
    const rate = node.grade ? await state.store.rateInForce(node.species, node.grade, now) : null;
    const summary = boardSummary(node, rate);
    const childrenRows = await state.actions.withClient(async (client) => {
      const result = await client.query(
        `SELECT tag FROM boards WHERE parent_tag = $1 ORDER BY created_at, tag`,
        [nodeTag],
      );
      return result.rows.map((r) => r.tag as string);
    });
    const nextPath = new Set(pathSet);
    nextPath.add(nodeTag);
    const children: Array<Record<string, unknown>> = [];
    for (const child of childrenRows) {
      const onPath = full || chain.includes(child);
      if (onPath) children.push(await buildNode(child, nextPath, false));
    }
    return { ...summary, created_at: node.created_at, children };
  };
  const node = await buildNode(root, new Set(), false);
  return { board: tag, root: node };
}

// ---------------------------------------------------------------------------
// fit and layouts

export async function fitCheck(state: RouteState, ctx: Ctx, tag: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const board = await state.store.board(tag);
  if (board === null || !canViewBoard(ctx.user, board.status)) throw new ApiError('not_found', 'Board not found');
  const fields: Record<string, string> = {};
  const piecesRaw = body['pieces'];
  if (!Array.isArray(piecesRaw) || piecesRaw.length < 1 || piecesRaw.length > 20) {
    throw new ApiError('validation', 'Check the highlighted fields.', { pieces: 'A layout holds 1 to 20 pieces.' });
  }
  const pieces: PieceInput[] = [];
  for (let i = 0; i < piecesRaw.length; i += 1) {
    const entry = piecesRaw[i];
    if (typeof entry !== 'object' || entry === null) {
      fields[`pieces.${i}`] = 'Check this piece.';
      continue;
    }
    const record = entry as Record<string, unknown>;
    const label = record['label'];
    const lengthMm = record['length_mm'];
    const widthMm = record['width_mm'];
    const startMm = record['start_mm'];
    const prefix = `pieces.${i}`;
    if (typeof label !== 'string' || label.length < 1 || label.length > 40) fields[prefix] = 'Label must be 1 to 40 characters.';
    if (typeof lengthMm !== 'number' || !Number.isInteger(lengthMm) || lengthMm < 1 || lengthMm > 12000) fields[prefix] = 'Length must be 1 to 12,000 mm.';
    if (typeof widthMm !== 'number' || !Number.isInteger(widthMm) || widthMm < 1 || widthMm > 600) fields[prefix] = 'Width must be 1 to 600 mm.';
    if (typeof startMm !== 'number' || !Number.isInteger(startMm) || startMm < 0 || startMm > 12000) fields[prefix] = 'Start must be 0 to 12,000 mm.';
    if (!fields[prefix]) {
      pieces.push({ label: label as string, length_mm: lengthMm as number, width_mm: widthMm as number, start_mm: startMm as number });
    }
  }
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);
  const rate = board.grade ? await state.store.rateInForce(board.species, board.grade, new Date()) : null;
  const fit = computeFit(
    board.length_mm,
    board.width_mm,
    board.defects,
    pieces,
    rate,
    (take) => (rate === null ? null : priceCents(board.thickness_mm, board.width_mm, take, rate)),
    (take) => boardFeetString(volumeMm3(take, board.width_mm, board.thickness_mm)),
  );
  return { board: tag, ...fit };
}

export async function importLayout(state: RouteState, ctx: Ctx, user: User, tag: string): Promise<Record<string, unknown>> {
  const board = await state.store.board(tag);
  if (board === null || !canViewBoard(user, board.status)) throw new ApiError('not_found', 'Board not found');
  let raw: unknown;
  try {
    raw = JSON.parse(ctx.body.toString('utf8'));
  } catch {
    throw new ApiError('bad_json', 'Body is not valid JSON');
  }
  try {
    const migrated = migrateLayoutFile(raw, tag);
    await state.store.saveStoredLayout(user.id, tag, migrated);
    return { layout: migrated };
  } catch (error) {
    if (error instanceof LayoutFileError) {
      if (error.code === 'unsupported_version') throw new ApiError('unsupported_version', 'This layout file is from a newer version.');
      if (error.code === 'wrong_board') throw new ApiError('wrong_board', 'This layout file is for another board.');
      throw new ApiError('validation', 'Check the highlighted fields.', { [error.field]: 'This layout file cannot be read.' });
    }
    throw error;
  }
}

export async function exportLayout(state: RouteState, user: User, tag: string): Promise<Buffer> {
  const file = await state.store.storedLayout(user.id, tag);
  if (file === null) throw new ApiError('not_found', 'No stored layout');
  return serializeLayout(file);
}

// ---------------------------------------------------------------------------
// holds

export function holdJsonFor(hold: HoldRecord, ownerView: boolean, makerName = ''): Record<string, unknown> {
  const json: Record<string, unknown> = {
    id: hold.id,
    board: hold.board_tag,
    status: hold.status,
    release_reason: hold.release_reason,
    pieces: hold.pieces,
    cuts_mm: hold.cuts_mm,
    take_mm: hold.take_mm,
    sale: hold.sale,
    offcut_mm: hold.offcut_mm,
    price_cents: hold.price_cents,
    deposit_cents: hold.deposit_cents,
    created_at: hold.created_at,
    held_at: hold.held_at,
    expires_at: hold.expires_at,
    killbill_payment_id: hold.killbill_payment_id,
  };
  if (ownerView) json['maker'] = { name: makerName };
  return json;
}

export async function holdsWithNames(state: RouteState): Promise<Array<Record<string, unknown>>> {
  const holds = await state.store.holds({});
  const out: Array<Record<string, unknown>> = [];
  for (const hold of holds) {
    const person = await state.store.userById(hold.maker_id);
    const json = holdJsonFor(hold, true);
    json['maker'] = { name: person?.name ?? '' };
    out.push(json);
  }
  return out;
}

export async function createHold(
  state: RouteState,
  ctx: Ctx,
  user: User,
  key: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const requestPath = ctx.path;
  const rawBody = ctx.body.toString('utf8');
  const existing = await state.store.idempotencyLookup(user.id, key);
  if (existing !== null) {
    if (existing.fingerprint !== fingerprint(ctx.method, requestPath, rawBody)) {
      throw new ApiError('idempotency_conflict', 'This key was used for a different request');
    }
    return { status: existing.status, body: existing.body };
  }
  const fields: Record<string, string> = {};
  const piecesRaw = body['pieces'];
  const boardRef = body['board'];
  const cardNumber = body['card_number'];
  if (typeof boardRef !== 'string') fields['board'] = 'Choose a board.';
  const digits = typeof cardNumber === 'string' ? cardNumber.replace(/\s+/g, '') : '';
  if (typeof cardNumber !== 'string' || !/^\d{13,19}$/.test(digits) || !luhn(digits)) {
    fields['card_number'] = 'Enter a valid card number.';
  }
  if (!Array.isArray(piecesRaw) || piecesRaw.length < 1 || piecesRaw.length > 20) {
    fields['pieces'] = 'A layout holds 1 to 20 pieces.';
  } else {
    for (let i = 0; i < piecesRaw.length; i += 1) {
      const entry = piecesRaw[i];
      if (typeof entry !== 'object' || entry === null) {
        fields[`pieces.${i}`] = 'Check this piece.';
        continue;
      }
      const record = entry as Record<string, unknown>;
      if (typeof record['label'] !== 'string' || (record['label'] as string).length < 1 || (record['label'] as string).length > 40) {
        fields[`pieces.${i}`] = 'Label must be 1 to 40 characters.';
        continue;
      }
      const lengthMm = record['length_mm'];
      const widthMm = record['width_mm'];
      const startMm = record['start_mm'];
      if (
        typeof lengthMm !== 'number' || !Number.isInteger(lengthMm) || lengthMm < 1 || lengthMm > 12000 ||
        typeof widthMm !== 'number' || !Number.isInteger(widthMm) || widthMm < 1 || widthMm > 600 ||
        typeof startMm !== 'number' || !Number.isInteger(startMm) || startMm < 0 || startMm > 12000
      ) {
        fields[`pieces.${i}`] = 'Check this piece.';
      }
    }
  }
  if (Object.keys(fields).length > 0) {
    const error = new ApiError('validation', 'Check the highlighted fields.', fields);
    await storeIdempotent(state, user.id, key, error, ctx, rawBody);
    return { status: error.status, body: error.body() };
  }
  const pieces = (piecesRaw as Array<Record<string, unknown>>).map((p) => ({
    label: p['label'] as string,
    length_mm: p['length_mm'] as number,
    width_mm: p['width_mm'] as number,
    start_mm: p['start_mm'] as number,
  }));

  try {
    const outcome = await performHold(state, user, pieces, digits, ctx, rawBody, key);
    return outcome;
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) throw error;
    if (error instanceof ApiError) {
      await storeIdempotent(state, user.id, key, error, ctx, rawBody);
      return { status: error.status, body: error.body() };
    }
    throw error;
  }
}

async function storeIdempotent(state: RouteState, makerId: number, key: string, error: ApiError, ctx: Ctx, rawBody: string): Promise<void> {
  if (![201, 402, 409, 422].includes(error.status)) return;
  await state.actions.withClient(async (client) => {
    await state.store.idempotencySave(client, makerId, key, error.status, error.body(), fingerprint(ctx.method, ctx.path, rawBody));
  });
}

async function performHold(
  state: RouteState,
  user: User,
  pieces: PieceInput[],
  digits: string,
  ctx: Ctx,
  rawBody: string,
  key: string,
): Promise<{ status: number; body: string }> {
  // Step 1: visibility + claim in one transaction.
  const claim = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const boardTag = typeof (ctx.body.length > 0 ? JSON.parse(rawBody) : {}).board === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>).board as string : '';
    const row = await state.actions.boardRow(client, boardTag);
    if (row === null) {
      await client.query('ROLLBACK');
      return { code: 'not_found' as const };
    }
    const status = row.status as string;
    const visible = status === 'available' || status === 'held' || (ctx.user !== null && isStaff(ctx.user));
    if (!visible) {
      await client.query('ROLLBACK');
      return { code: 'not_found' as const };
    }
    // Release expired holds on this board first.
    await client.query(
      `UPDATE holds SET status = 'released', release_reason = 'expired' WHERE board_tag = $1 AND status = 'held' AND expires_at <= now()`,
      [boardTag],
    );
    const pending = await client.query(
      `SELECT 1 FROM holds WHERE board_tag = $1 AND status IN ('pending-payment', 'held') LIMIT 1`,
      [boardTag],
    );
    if (pending.rowCount && pending.rowCount > 0) {
      await client.query('ROLLBACK');
      return { code: 'already_held' as const };
    }
    const refreshed = await state.actions.boardRow(client, boardTag);
    if ((refreshed?.status as string) !== 'available') {
      await client.query('ROLLBACK');
      return { code: 'board_state' as const };
    }
    const rate = refreshed?.grade
      ? await rateInForceUnder(client, refreshed.species as string, refreshed.grade as string)
      : null;
    const board = mapBoard(refreshed ?? ({} as Record<string, unknown>));
    const defects = await state.actions.defectList(client, boardTag);
    board.defects = defects;
    const fit = computeFit(
      board.length_mm,
      board.width_mm,
      defects,
      pieces,
      rate,
      (take) => (rate === null ? null : priceCents(board.thickness_mm, board.width_mm, take, rate)),
      (take) => boardFeetString(volumeMm3(take, board.width_mm, board.thickness_mm)),
    );
    const allClear = fit.pieces.every((p) => p.status === 'clear');
    if (!allClear || fit.price_cents === null || fit.price_cents <= DEPOSIT_CENTS) {
      await client.query('ROLLBACK');
      return { code: 'pieces' as const, fit };
    }
    const holdId = await state.actions.allocateId(client, 'hold', 'H-', 4);
    await client.query(
      `INSERT INTO holds (id, board_tag, maker_id, status, release_reason, pieces, cuts_mm, take_mm, sale, offcut_mm, price_cents, deposit_cents)
       VALUES ($1, $2, $3, 'pending-payment', NULL, $4, $5, $6, $7, $8, $9, $10)`,
      [holdId, boardTag, user.id, JSON.stringify(pieces), JSON.stringify(fit.cuts_mm), fit.take_mm, fit.sale, fit.offcut_mm, fit.price_cents, DEPOSIT_CENTS],
    );
    await client.query('COMMIT');
    return { code: 'claimed' as const, holdId, fit, board };
  });

  if (claim.code === 'not_found') throw new ApiError('not_found', 'Board not found');
  if (claim.code === 'already_held') {
    const error = new ApiError('already_held', 'This board is already held');
    await storeIdempotent(state, user.id, key, error, ctx, rawBody);
    return { status: error.status, body: error.body() };
  }
  if (claim.code === 'board_state') {
    const error = new ApiError('board_state', 'This board cannot be held');
    await storeIdempotent(state, user.id, key, error, ctx, rawBody);
    return { status: error.status, body: error.body() };
  }
  if (claim.code === 'pieces') {
    const error = new ApiError('validation', 'Check the highlighted fields.', { pieces: 'Every piece must clear the defects and the price must exceed the deposit.' });
    await storeIdempotent(state, user.id, key, error, ctx, rawBody);
    return { status: error.status, body: error.body() };
  }

  // Step 2: billing.
  if (digits === DECLINED_CARD) {
    await markHoldFailed(state, claim.holdId);
    const error = new ApiError('card_declined', 'Your card was declined');
    await storeIdempotent(state, user.id, key, error, ctx, rawBody);
    return { status: error.status, body: error.body() };
  }
  const billing = await chargeHold(state, user, claim.holdId);
  if (billing.error !== null) {
    // The claim is released: billing did not confirm the deposit.
    await markHoldFailed(state, claim.holdId);
    // A 503 is never stored, so the maker may retry the same key once billing returns.
    if (billing.error.status !== 503) {
      await storeIdempotent(state, user.id, key, billing.error, ctx, rawBody);
    }
    return { status: billing.error.status, body: billing.error.body() };
  }
  const hold = await state.store.hold(claim.holdId);
  if (hold === null) throw new ApiError('not_found', 'Hold not found');
  const body = JSON.stringify({ hold: holdJsonFor(hold, false) });
  await state.actions.withClient(async (client) => {
    await state.store.idempotencySave(client, user.id, key, 201, body, fingerprint(ctx.method, ctx.path, rawBody));
  });
  return { status: 201, body };
}

async function markHoldFailed(state: RouteState, holdId: string): Promise<void> {
  await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    await client.query(`UPDATE holds SET status = 'released', release_reason = 'payment-failed' WHERE id = $1 AND status = 'pending-payment'`, [holdId]);
    await client.query('COMMIT');
  });
}

async function chargeHold(
  state: RouteState,
  user: User,
  holdId: string,
): Promise<{ error: ApiError | null; paymentId: string | null }> {
  let accountId: string | null;
  try {
    accountId = await state.killbill.ensureAccount(user.email, user.name, user.email);
  } catch {
    return { error: new ApiError('billing_unavailable', 'Billing is offline'), paymentId: null };
  }
  if (accountId === null) return { error: new ApiError('payment_failed', 'Billing did not confirm the payment'), paymentId: null };
  const hasMethod = await state.killbill.hasDefaultPaymentMethod(accountId);
  if (!hasMethod) {
    await state.killbill.addPaymentMethod(accountId, `card-${user.id}`);
  }
  const yardId = await state.store.yardId();
  const outcome = await state.killbill.purchase(accountId, DEPOSIT_CENTS, `hold-${yardId}-${holdId}`);
  if (outcome.kind === 'unavailable') {
    return { error: new ApiError('billing_unavailable', 'Billing is offline'), paymentId: null };
  }
  if (outcome.kind !== 'success' || !outcome.paymentId) {
    return { error: new ApiError('payment_failed', 'Billing did not confirm the payment'), paymentId: null };
  }
  const expiresAt = new Date(Date.now() + state.holdSeconds * 1000);
  await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    await client.query(
      `UPDATE holds SET status = 'held', held_at = now(), expires_at = $2, killbill_payment_id = $3 WHERE id = $1 AND status = 'pending-payment'`,
      [holdId, expiresAt, outcome.paymentId],
    );
    await client.query(`UPDATE boards SET status = 'held' WHERE tag = (SELECT board_tag FROM holds WHERE id = $1)`, [holdId]);
    await client.query('COMMIT');
  });
  return { error: null, paymentId: outcome.paymentId };
}

export async function cancelHold(state: RouteState, user: User, holdId: string): Promise<HoldRecord> {
  if (user.role !== 'maker') throw new ApiError('forbidden', 'Only the maker may cancel a hold');
  // Lock the hold and decide expiry first.
  const decision = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [holdId]);
    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { code: 'not_found' as const };
    }
    const hold = result.rows[0];
    if ((hold.maker_id as number) !== user.id) {
      await client.query('ROLLBACK');
      return { code: 'not_found' as const };
    }
    if (hold.status !== 'held') {
      await client.query('ROLLBACK');
      return { code: 'not_active' as const };
    }
    const expiresAt = hold.expires_at ? new Date(hold.expires_at) : null;
    if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
      await client.query(`UPDATE holds SET status = 'released', release_reason = 'expired' WHERE id = $1`, [holdId]);
      await client.query(`UPDATE boards SET status = 'available' WHERE tag = $1 AND status = 'held'`, [hold.board_tag]);
      await client.query('COMMIT');
      return { code: 'not_active' as const };
    }
    await client.query('COMMIT');
    return {
      code: 'active' as const,
      hold: mapHold(hold),
    };
  });
  if (decision.code === 'not_found') throw new ApiError('not_found', 'Hold not found');
  if (decision.code === 'not_active') throw new ApiError('hold_not_active', 'This hold is no longer active');
  const hold = decision.hold;

  const maker = await state.store.userById(hold.maker_id);
  if (maker === null) throw new ApiError('not_found', 'Hold not found');
  let accountId: string | null;
  try {
    accountId = await state.killbill.ensureAccount(maker.email, maker.name, maker.email);
  } catch {
    throw new ApiError('billing_unavailable', 'Billing is offline');
  }
  if (accountId === null) throw new ApiError('payment_failed', 'Billing did not confirm the refund');
  let refund: Awaited<ReturnType<KillBillLike['refund']>>;
  try {
    refund = await state.killbill.refund(accountId, hold.killbill_payment_id ?? '', DEPOSIT_CENTS);
  } catch {
    throw new ApiError('billing_unavailable', 'Billing is offline');
  }
  if (refund.kind === 'unavailable') throw new ApiError('billing_unavailable', 'Billing is offline');
  if (refund.kind !== 'success') throw new ApiError('payment_failed', 'Billing did not confirm the refund');

  await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE holds SET status = 'released', release_reason = 'cancelled' WHERE id = $1 AND status = 'held' RETURNING *`,
      [holdId],
    );
    if (updated.rowCount === 1) {
      await client.query(`UPDATE boards SET status = 'available' WHERE tag = $1 AND status = 'held'`, [hold.board_tag]);
    }
    await client.query('COMMIT');
  });
  const final = await state.store.hold(holdId);
  if (final === null) throw new ApiError('not_found', 'Hold not found');
  return final;
}

async function rateInForceUnder(client: PoolClient, species: string, grade: string): Promise<number | null> {
  const result = await client.query(
    `SELECT rate_cents FROM rate_versions WHERE species = $1 AND grade = $2 AND effective_at <= now()
     ORDER BY effective_at DESC, id DESC LIMIT 1`,
    [species, grade],
  );
  return result.rowCount === 1 ? (result.rows[0].rate_cents as number) : null;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// purchase

export async function purchaseHold(
  state: RouteState,
  ctx: Ctx,
  user: User,
  holdId: string,
  key: string,
): Promise<{ status: number; body: string }> {
  const rawBody = ctx.body.toString('utf8');
  const existing = await state.store.idempotencyLookup(user.id, key);
  if (existing !== null) {
    if (existing.fingerprint !== fingerprint(ctx.method, ctx.path, rawBody)) {
      throw new ApiError('idempotency_conflict', 'This key was used for a different request');
    }
    return { status: existing.status, body: existing.body };
  }
  try {
    const result = await performPurchase(state, ctx, user, holdId, key, rawBody);
    return result;
  } catch (error) {
    if (error instanceof ApiError && [201, 402, 409, 422].includes(error.status)) {
      await state.actions.withClient(async (client) => {
        await state.store.idempotencySave(client, user.id, key, error.status, error.body(), fingerprint(ctx.method, ctx.path, rawBody));
      });
      return { status: error.status, body: error.body() };
    }
    throw error;
  }
}

async function performPurchase(
  state: RouteState,
  ctx: Ctx,
  user: User,
  holdId: string,
  key: string,
  rawBody: string,
): Promise<{ status: number; body: string }> {
  const decision = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [holdId]);
    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { code: 'not_found' as const };
    }
    const hold = result.rows[0];
    if ((hold.maker_id as number) !== user.id) {
      await client.query('ROLLBACK');
      return { code: 'not_found' as const };
    }
    if (hold.status !== 'held') {
      await client.query('ROLLBACK');
      return { code: 'not_active' as const };
    }
    const expiresAt = hold.expires_at ? new Date(hold.expires_at) : null;
    if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
      await client.query(`UPDATE holds SET status = 'released', release_reason = 'expired' WHERE id = $1`, [holdId]);
      await client.query(`UPDATE boards SET status = 'available' WHERE tag = $1 AND status = 'held'`, [hold.board_tag]);
      await client.query('COMMIT');
      return { code: 'not_active' as const };
    }
    await client.query('COMMIT');
    return { code: 'active' as const, hold: mapHold(hold) };
  });
  if (decision.code === 'not_found') throw new ApiError('not_found', 'Hold not found');
  if (decision.code === 'not_active') throw new ApiError('hold_not_active', 'This hold is no longer active');
  const hold = decision.hold;
  if (hold.take_mm === null || hold.sale === null) throw new ApiError('hold_not_active', 'This hold is no longer active');

  const board = await state.store.board(hold.board_tag);
  if (board === null) throw new ApiError('not_found', 'Board not found');
  const amountCents = hold.price_cents - DEPOSIT_CENTS;

  // Allocate the ticket id and render the PDF before anything is charged.
  const ticketId = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const id = await state.actions.allocateId(client, 'ticket', 'CT-', 4);
    await client.query('COMMIT');
    return id;
  });
  const takeMm = hold.take_mm;
  const lines = allocateLines(hold.price_cents, hold.pieces.map((piece) => ({ label: piece.label, length_mm: piece.length_mm })));
  const pdfData: TicketPdfData = {
    ticketId,
    boardTag: board.tag,
    makerName: user.name,
    pieces: hold.pieces.map((p) => ({ label: p.label, startMm: p.start_mm })),
    cuts: hold.cuts_mm,
    takeMm,
    plannedOffcutMm: hold.offcut_mm,
    lines: lines.map((l) => ({ label: l.label, amountCents: l.amount_cents })),
  };
  const pdf = renderTicketPdf(pdfData);
  const pdfKey = `tickets/${ticketId}.pdf`;
  try {
    await state.storage.put(pdfKey, pdf, 'application/pdf');
  } catch {
    throw new ApiError('storage_unavailable', "Cut tickets can't be saved right now");
  }

  const maker = await state.store.userById(hold.maker_id);
  if (maker === null) throw new ApiError('not_found', 'Hold not found');
  let accountId: string | null;
  try {
    accountId = await state.killbill.ensureAccount(maker.email, maker.name, maker.email);
  } catch {
    await state.storage.delete(pdfKey).catch(() => {});
    throw new ApiError('billing_unavailable', 'Billing is offline');
  }
  if (accountId === null) {
    await state.storage.delete(pdfKey).catch(() => {});
    throw new ApiError('payment_failed', 'Billing did not confirm the payment');
  }
  try {
    const hasMethod = await state.killbill.hasDefaultPaymentMethod(accountId);
    if (!hasMethod) await state.killbill.addPaymentMethod(accountId, `card-${maker.id}`);
  } catch {
    await state.storage.delete(pdfKey).catch(() => {});
    throw new ApiError('billing_unavailable', 'Billing is offline');
  }
  const yardId = await state.store.yardId();
  const paymentKey = `sale-${yardId}-${ticketId}`;
  let outcome: Awaited<ReturnType<KillBillLike['purchase']>>;
  try {
    outcome = await state.killbill.purchase(accountId, amountCents, paymentKey);
  } catch {
    await state.storage.delete(pdfKey).catch(() => {});
    throw new ApiError('billing_unavailable', 'Billing is offline');
  }
  if (outcome.kind === 'unavailable') {
    await state.storage.delete(pdfKey).catch(() => {});
    throw new ApiError('billing_unavailable', 'Billing is offline');
  }
  if (outcome.kind !== 'success' || !outcome.paymentId) {
    await state.storage.delete(pdfKey).catch(() => {});
    throw new ApiError('payment_failed', 'Billing did not confirm the payment');
  }
  const paymentId = outcome.paymentId;

  const sale = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const invoiceId = await state.actions.allocateId(client, 'invoice', 'INV-', 4);
    let offcutTag: string | null = null;
    if (hold.sale === 'cut' && hold.offcut_mm !== null) {
      offcutTag = await state.actions.allocateTag(client);
      await client.query(
        `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, parent_tag, from_intake, created_at)
         VALUES ($1, $2, $3, 'graded', $4, $5, $6, $7, $8, false, now())`,
        [offcutTag, board.species, board.grade, board.lot.id, hold.offcut_mm, board.width_mm, board.thickness_mm, board.tag],
      );
      const zones = await state.actions.defectList(client, board.tag);
      let position = 0;
      for (const zone of zones) {
        const shiftedStart = zone.start_mm - (takeMm + KERF_ROUND_MM);
        const shiftedEnd = zone.end_mm - (takeMm + KERF_ROUND_MM);
        if (shiftedEnd <= 0 || shiftedStart >= hold.offcut_mm) continue;
        const clippedStart = Math.max(0, shiftedStart);
        const clippedEnd = Math.min(hold.offcut_mm, shiftedEnd);
        await client.query(
          'INSERT INTO defect_zones (board_tag, kind, start_mm, end_mm, position) VALUES ($1, $2, $3, $4, $5)',
          [offcutTag, zone.kind, clippedStart, clippedEnd, position],
        );
        position += 1;
      }
    }
    await client.query(
      `INSERT INTO tickets (id, board_tag, maker_id, status, pieces, cuts_mm, take_mm, sale, offcut_tag, offcut_planned_mm, pdf_key)
       VALUES ($1, $2, $3, 'issued', $4, $5, $6, $7, $8, $9, $10)`,
      [ticketId, board.tag, user.id, JSON.stringify(hold.pieces), JSON.stringify(hold.cuts_mm), takeMm, hold.sale, offcutTag, hold.offcut_mm, pdfKey],
    );
    await client.query('INSERT INTO ticket_events (ticket_id, kind, by_user_id) VALUES ($1, $2, $3)', [ticketId, 'issued', user.id]);
    await client.query(
      `INSERT INTO invoices (id, ticket_id, board_tag, maker_id, price_cents, deposit_cents, amount_cents, lines, killbill_payment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [invoiceId, ticketId, board.tag, user.id, hold.price_cents, DEPOSIT_CENTS, amountCents, JSON.stringify(lines), paymentId],
    );
    await client.query(`UPDATE holds SET status = 'converted-to-sale' WHERE id = $1`, [holdId]);
    await client.query(`UPDATE boards SET status = $2 WHERE tag = $1`, [board.tag, hold.sale === 'cut' ? 'cut' : 'sold-whole']);
    // Split movement
    const parentVolume = BigInt(board.length_mm) * BigInt(board.width_mm) * BigInt(board.thickness_mm);
    const soldVolume = BigInt(takeMm) * BigInt(board.width_mm) * BigInt(board.thickness_mm);
    const kerfVolume = BigInt(KERF_ROUND_MM) * BigInt(board.width_mm) * BigInt(board.thickness_mm);
    const movement = await client.query(
      'INSERT INTO ledger_movements (kind, ticket, by_user_id) VALUES ($1, $2, $3) RETURNING id',
      [hold.sale === 'cut' ? 'split' : 'whole-sale', ticketId, user.id],
    );
    const movementId = movement.rows[0].id as number;
    const entries: Array<[string, bigint]> = [[`board:${board.tag}`, -parentVolume], [`sold:${ticketId}`, soldVolume]];
    if (hold.sale === 'cut' && offcutTag !== null && hold.offcut_mm !== null) {
      entries.push([`board:${offcutTag}`, BigInt(hold.offcut_mm) * BigInt(board.width_mm) * BigInt(board.thickness_mm)]);
      entries.push(['kerf', kerfVolume]);
    }
    for (const [account, volume] of entries) {
      await client.query('INSERT INTO ledger_entries (movement_id, account, volume_mm3) VALUES ($1, $2, $3)', [movementId, account, volume]);
    }
    await client.query('COMMIT');
    return { ticketId, invoiceId, offcutTag };
  }).catch(async (error) => {
    await state.storage.delete(pdfKey).catch(() => {});
    await state.killbill.refund(accountId, paymentId, amountCents).catch(() => {});
    throw error;
  });

  const body = JSON.stringify({
    sale: {
      ticket: sale.ticketId,
      invoice: sale.invoiceId,
      board: board.tag,
      sale: hold.sale,
      sold_mm: hold.take_mm,
      offcut: sale.offcutTag !== null ? { tag: sale.offcutTag, length_mm: hold.offcut_mm } : null,
      price_cents: hold.price_cents,
      deposit_cents: DEPOSIT_CENTS,
      amount_cents: amountCents,
      killbill_payment_id: paymentId,
      pdf_url: `/api/tickets/${sale.ticketId}/pdf`,
    },
  });
  await state.actions.withClient(async (client) => {
    await state.store.idempotencySave(client, user.id, key, 201, body, fingerprint(ctx.method, ctx.path, rawBody));
  });
  return { status: 201, body };
}

// ---------------------------------------------------------------------------
// tickets

export async function startTicket(state: RouteState, user: User, ticketId: string): Promise<TicketRecord> {
  const ticket = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = result.rows[0];
    if (row.status !== 'issued') {
      await client.query('ROLLBACK');
      return { conflict: true as const, row };
    }
    await client.query(`UPDATE tickets SET status = 'at-saw' WHERE id = $1`, [ticketId]);
    await client.query('INSERT INTO ticket_events (ticket_id, kind, by_user_id) VALUES ($1, $2, $3)', [ticketId, 'started', user.id]);
    await client.query('COMMIT');
    return { conflict: false as const, row };
  });
  if (ticket === null) throw new ApiError('not_found', 'Ticket not found');
  if (ticket.conflict) throw new ApiError('ticket_state', 'This ticket cannot be started');
  const updated = await state.store.ticket(ticketId);
  if (updated === null) throw new ApiError('not_found', 'Ticket not found');
  return updated;
}

export async function doneTicket(state: RouteState, user: User, ticketId: string, body: Record<string, unknown>): Promise<TicketRecord> {
  const decision = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = result.rows[0];
    if (row.status !== 'at-saw') {
      await client.query('ROLLBACK');
      return { conflict: true as const, row };
    }
    const planned = row.offcut_planned_mm as number | null;
    const measured = validateOffcutMm(body, planned);
    if (measured === null) {
      await client.query('ROLLBACK');
      return { conflict: false as const, row, measured: null as number | null };
    }
    await client.query('COMMIT');
    return { conflict: false as const, row, measured };
  });
  if (decision === null) throw new ApiError('not_found', 'Ticket not found');
  if (decision.conflict) throw new ApiError('ticket_state', 'This ticket cannot be marked done');
  const row = decision.row;
  const measured = decision.measured;
  const planned = row.offcut_planned_mm as number | null;
  const offcutTag = row.offcut_tag as string | null;

  const final = await state.actions.withClient(async (client) => {
    await client.query('BEGIN');
    const lock = await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (lock.rowCount !== 1 || (lock.rows[0].status as string) !== 'at-saw') {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(`UPDATE tickets SET status = 'done', offcut_measured_mm = $2 WHERE id = $1`, [ticketId, measured]);
    await client.query('INSERT INTO ticket_events (ticket_id, kind, by_user_id) VALUES ($1, $2, $3)', [ticketId, 'done', user.id]);
    if (offcutTag !== null && measured !== null) {
      const boardRow = await client.query('SELECT * FROM boards WHERE tag = $1 FOR UPDATE', [offcutTag]);
      if (boardRow.rowCount === 1) {
        const oldLength = boardRow.rows[0].length_mm as number;
        const width = boardRow.rows[0].width_mm as number;
        const thickness = boardRow.rows[0].thickness_mm as number;
        await client.query('UPDATE boards SET length_mm = $2 WHERE tag = $1', [offcutTag, measured]);
        await client.query('DELETE FROM defect_zones WHERE board_tag = $1 AND (start_mm >= $2 OR end_mm > $2)', [offcutTag, measured]);
        await client.query('UPDATE defect_zones SET end_mm = $2 WHERE board_tag = $1 AND end_mm > $2', [offcutTag, measured]);
        const delta = BigInt(oldLength - measured) * BigInt(width) * BigInt(thickness);
        if (delta > 0n) {
          const movement = await client.query(
            'INSERT INTO ledger_movements (kind, ticket, by_user_id) VALUES ($1, $2, $3) RETURNING id',
            ['trim', ticketId, user.id],
          );
          const movementId = movement.rows[0].id as number;
          await client.query('INSERT INTO ledger_entries (movement_id, account, volume_mm3) VALUES ($1, $2, $3), ($1, $4, $5)', [
            movementId,
            `board:${offcutTag}`,
            -delta,
            'kerf',
            delta,
          ]);
        }
      }
    }
    await client.query('COMMIT');
    return true;
  });
  if (final === null) throw new ApiError('ticket_state', 'This ticket cannot be marked done');
  const updated = await state.store.ticket(ticketId);
  if (updated === null) throw new ApiError('not_found', 'Ticket not found');
  void planned;
  return updated;
}

// ---------------------------------------------------------------------------
// lineage corrections

interface AffectedBoard {
  tag: string;
  status: string;
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  from_intake: boolean;
}

async function correctionAffectedBoards(
  client: PoolClient,
  tag: string,
  kind: 'grade' | 'dimensions',
  payload: unknown,
): Promise<Array<AffectedBoard>> {
  const root = await lineageRoot(client, tag);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [root]);
  const boardRow = (await client.query('SELECT * FROM boards WHERE tag = $1 FOR UPDATE', [tag])).rows[0];
  if (boardRow === undefined) throw new ApiError('not_found', 'Board not found');
  const isOffcut = boardRow.from_intake === false;
  if (isOffcut) {
    const ticket = await client.query('SELECT status FROM tickets WHERE offcut_tag = $1', [tag]);
    if (ticket.rowCount === 1 && (ticket.rows[0].status as string) !== 'done') {
      throw new ApiError('offcut_not_cut', 'This offcut may not be corrected yet');
    }
  }
  let affected: Array<Record<string, unknown>>;
  if (kind === 'grade') {
    const status = boardRow.status as string;
    if (status === 'tagged' || status === 'graded') {
      if (status === 'tagged' && (payload as string) === undefined) throw new ApiError('board_state', 'This board cannot be graded');
      affected = [boardRow];
    } else if (status === 'cut') {
      affected = await openDescendants(client, tag, ['graded', 'available']);
    } else {
      throw new ApiError('board_state', 'This board cannot be graded');
    }
  } else {
    const status = boardRow.status as string;
    const wantsLength = (payload as { lengthMm: number | null }).lengthMm !== null;
    if (wantsLength && !OPEN_STATUSES.has(status as never)) {
      throw new ApiError('board_state', 'This board cannot be corrected');
    }
    if (wantsLength) {
      const defects = await client.query('SELECT max(end_mm) AS max_end FROM defect_zones WHERE board_tag = $1', [tag]);
      const maxEnd = (defects.rows[0].max_end as number | null) ?? 0;
      const length = (payload as { lengthMm: number }).lengthMm as number;
      if (length < maxEnd) {
        throw new ApiError('validation', 'Check the highlighted fields.', { length_mm: 'Length must cover every defect zone.' });
      }
    }
    // A re-measure of a retired board changes its open descendants only.
    const statuses = OPEN_STATUSES.has(status as never)
      ? ['tagged', 'graded', 'available', 'held']
      : ['tagged', 'graded', 'available'];
    const descendants = await openDescendants(client, tag, statuses);
    affected = OPEN_STATUSES.has(status as never)
      ? [boardRow, ...descendants.filter((d) => d.tag !== tag)]
      : descendants;
    if (affected.length === 0) throw new ApiError('board_state', 'No board to correct');
  }
  for (const target of affected) {
    if ((target.status as string) === 'held') throw new ApiError('board_state', 'A held board cannot be corrected');
    if (target.from_intake === false) {
      const ticket = await client.query('SELECT status FROM tickets WHERE offcut_tag = $1', [target.tag]);
      if (ticket.rowCount === 1 && (ticket.rows[0].status as string) !== 'done') {
        throw new ApiError('offcut_not_cut', 'This offcut may not be corrected yet');
      }
    }
  }
  return affected.map((row) => ({
    tag: row.tag as string,
    status: row.status as string,
    length_mm: row.length_mm as number,
    width_mm: row.width_mm as number,
    thickness_mm: row.thickness_mm as number,
    from_intake: row.from_intake as boolean,
  }));
}

async function lineageRoot(client: PoolClient, tag: string): Promise<string> {
  let cursor = tag;
  const seen = new Set<string>([tag]);
  while (true) {
    const result = await client.query('SELECT parent_tag FROM boards WHERE tag = $1', [cursor]);
    if (result.rowCount !== 1) return cursor;
    const parent = result.rows[0].parent_tag as string | null;
    if (parent === null || seen.has(parent)) return cursor;
    seen.add(parent);
    cursor = parent;
  }
}

async function openDescendants(client: PoolClient, tag: string, statuses: string[]): Promise<Array<Record<string, unknown>>> {
  const result = await client.query(
    `WITH RECURSIVE tree AS (
       SELECT tag, parent_tag, created_at FROM boards WHERE tag = $1
       UNION ALL
       SELECT b.tag, b.parent_tag, b.created_at FROM boards b JOIN tree t ON b.parent_tag = t.tag
     )
     SELECT DISTINCT b.* FROM boards b JOIN tree t ON b.tag = t.tag WHERE b.status = ANY($2) AND b.tag <> $1`,
    [tag, statuses],
  );
  return result.rows.sort((a, b) => {
    const at = new Date(a.created_at as string).getTime();
    const bt = new Date(b.created_at as string).getTime();
    if (at !== bt) return at - bt;
    return String(a.tag).localeCompare(String(b.tag));
  });
}

// ---------------------------------------------------------------------------
// json shapes

export interface TicketEventJson {
  kind: string;
  byName: string;
  at: string;
}

export function ticketJson(
  ticket: TicketRecord,
  events: TicketEventJson[],
  makerName: string,
): Record<string, unknown> {
  return {
    id: ticket.id,
    status: ticket.status,
    board: ticket.board_tag,
    maker: { name: makerName },
    pieces: ticket.pieces,
    cuts_mm: ticket.cuts_mm,
    take_mm: ticket.take_mm,
    sale: ticket.sale,
    offcut:
      ticket.offcut_tag !== null
        ? { tag: ticket.offcut_tag, planned_mm: ticket.offcut_planned_mm, measured_mm: ticket.offcut_measured_mm }
        : null,
    pdf_key: ticket.pdf_key,
    created_at: ticket.created_at,
    events: events.map((event) => ({ kind: event.kind, by: { name: event.byName }, at: event.at })),
  };
}

export function invoiceJson(invoice: InvoiceRecord): Record<string, unknown> {
  return {
    id: invoice.id,
    ticket: invoice.ticket_id,
    board: invoice.board_tag,
    price_cents: invoice.price_cents,
    deposit_cents: invoice.deposit_cents,
    amount_cents: invoice.amount_cents,
    lines: invoice.lines,
    status: 'paid',
    paid_at: invoice.paid_at,
    killbill_payment_id: invoice.killbill_payment_id,
  };
}

export function movementJson(movement: {
  id: number;
  kind: string;
  ticket: string | null;
  by_user_id: number | null;
  created_at: string;
  entries: Array<{ account: string; volume_mm3: string }>;
  by_name: string | null;
}): Record<string, unknown> {
  return {
    id: movement.id,
    kind: movement.kind,
    created_at: movement.created_at,
    ticket: movement.ticket,
    by: movement.by_name === null ? null : { name: movement.by_name },
    entries: movement.entries.map((e) => ({ account: e.account, volume_mm3: Number(e.volume_mm3) })),
  };
}
