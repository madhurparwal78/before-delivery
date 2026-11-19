/**
 * Pieces: their stamp rules, their filters and a cursor that never repeats or
 * skips a row while new pieces arrive.
 */
import { F } from '../../shared/feedback.ts';
import { toPlain, type Dec } from '../domain/decimal.ts';
import { emptyPlacements } from '../domain/layout.ts';
import { dateText } from '../domain/time.ts';
import { isStampNumber } from '../domain/stamp.ts';
import { fail } from '../http/errors.ts';
import { Check, LIMITS } from '../http/validate.ts';
import type { Ctx, Route } from '../http/context.ts';
import { findPiece, requireOwnClient, requireOwnPiece, resolvePiece, piece as resolved } from './lookup.ts';
import { PIECE_STATES, presentPiece, type PieceState, type Row } from '../present.ts';
import { pieceEntry, putEntries } from '../features/indexing.ts';
import { SearchUnavailable } from '../services/search.ts';

const PAGE_SIZE = 25;
const SORTS = ['title', 'dueDate'] as const;
type Sort = (typeof SORTS)[number];

interface Cursor {
  /** The last row's sort value, or null for an empty due date. */
  v: string | null;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(text: string): Cursor | null {
  try {
    const value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Cursor;
    if (typeof value.id !== 'string') return null;
    if (value.v !== null && typeof value.v !== 'string') return null;
    return value;
  } catch {
    return null;
  }
}

async function readStamp(ctx: Ctx, check: Check, pieceId: string | null): Promise<string | null | undefined> {
  const desk = ctx.requireDesk();
  const value = check.optionalText('stampNumber', 8);
  if (value === undefined || value === null || value === '') return value;
  if (!isStampNumber(value)) {
    check.add('stampNumber', F.badStamp);
    return null;
  }
  const taken = await ctx.app.db.one<Row>(
    `SELECT id FROM pieces WHERE desk_id = $1 AND stamp_number = $2 AND ($3::bigint IS NULL OR id <> $3)`,
    [desk.id, value, pieceId],
  );
  if (taken) {
    // The stamp is well formed; another piece already holds it.
    ctx.resolved.stampTaken = taken;
  }
  return value;
}

async function indexQuietly(ctx: Ctx, id: string, title: string): Promise<void> {
  try {
    await putEntries(ctx.app, [pieceEntry(ctx.requireDesk().id, id, title)]);
  } catch (error) {
    if (!(error instanceof SearchUnavailable)) throw error;
  }
}

export const pieceRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/pieces',
    auth: 'required',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const sortText = ctx.query('sort') ?? 'title';
      if (!(SORTS as readonly string[]).includes(sortText)) throw fail.invalid(F.outOfRange);
      const sort = sortText as Sort;

      const clientFilter = ctx.query('client');
      if (clientFilter !== null) await requireOwnClient(ctx, clientFilter);

      const stateFilter = ctx.query('state');
      if (stateFilter !== null && !(PIECE_STATES as readonly string[]).includes(stateFilter)) {
        throw fail.invalid(F.outOfRange);
      }

      const cursorText = ctx.query('cursor');
      const cursor = cursorText === null ? null : decodeCursor(cursorText);
      if (cursorText !== null && !cursor) throw fail.invalid(F.outOfRange);

      const values: unknown[] = [desk.id];
      const where = [`p.desk_id = $1`, `c.state IN ('active','closing')`];
      if (clientFilter !== null) {
        values.push(clientFilter);
        where.push(`p.client_id = $${values.length}`);
      }
      if (stateFilter !== null) {
        values.push(stateFilter);
        where.push(`p.state = $${values.length}`);
      } else {
        where.push(`p.state <> 'archived'`);
      }

      if (cursor) {
        if (sort === 'title') {
          values.push(cursor.v, cursor.id);
          where.push(`(p.title, p.id) > ($${values.length - 1}, $${values.length}::bigint)`);
        } else if (cursor.v === null) {
          values.push(cursor.id);
          where.push(`(p.due_date IS NULL AND p.id > $${values.length}::bigint)`);
        } else {
          values.push(cursor.v, cursor.id);
          const v = `$${values.length - 1}::date`;
          const id = `$${values.length}::bigint`;
          where.push(
            `(p.due_date IS NULL OR p.due_date > ${v} OR (p.due_date = ${v} AND p.id > ${id}))`,
          );
        }
      }

      const order =
        sort === 'title'
          ? `ORDER BY p.title, p.id`
          : `ORDER BY (p.due_date IS NULL), p.due_date, p.id`;

      const rows = await ctx.app.db.query<Row>(
        `SELECT p.*, c.name AS client_name FROM pieces p JOIN clients c ON c.id = p.client_id
          WHERE ${where.join(' AND ')} ${order} LIMIT ${PAGE_SIZE + 1}`,
        values,
      );

      const page = rows.slice(0, PAGE_SIZE);
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > PAGE_SIZE && last
          ? encodeCursor({
              v: sort === 'title' ? String(last.title) : last.due_date === null ? null : String(last.due_date),
              id: String(last.id),
            })
          : null;

      ctx.json(200, { pieces: page.map(presentPiece), nextCursor });
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces',
    auth: 'required',
    body: 'json',
    async handle(ctx) {
      const desk = ctx.requireDesk();

      if (ctx.body.duplicateOf !== undefined) {
        const source = await requireOwnPiece(ctx, ctx.body.duplicateOf);
        const copy = await ctx.app.db.one<Row>(
          `INSERT INTO pieces (desk_id, client_id, title, maker, year, width_cm, depth_cm,
             height_cm, weight_kg, due_date, notes, state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'received') RETURNING *`,
          [
            desk.id,
            source.client_id,
            `${String(source.title)} (copy)`,
            source.maker,
            source.year,
            source.width_cm,
            source.depth_cm,
            source.height_cm,
            source.weight_kg,
            source.due_date,
            source.notes,
          ],
        );
        await ctx.app.db.query(
          `INSERT INTO layouts (piece_id, version, placements) VALUES ($1, 1, $2)`,
          [copy!.id, JSON.stringify(emptyPlacements())],
        );
        await indexQuietly(ctx, String(copy!.id), String(copy!.title));
        ctx.json(201, { piece: presentPiece(copy!) });
        return;
      }

      const check = new Check(ctx.body);
      const clientRow = await requireOwnClient(ctx, ctx.body.clientId);
      const title = check.text('title', LIMITS.pieceTitle);
      const maker = check.optionalText('maker', LIMITS.maker);
      const year = check.optionalText('year', LIMITS.year);
      const stamp = await readStamp(ctx, check, null);
      const widthCm = check.decimal('widthCm', { required: false, maxScale: 2 });
      const depthCm = check.decimal('depthCm', { required: false, maxScale: 2 });
      const heightCm = check.decimal('heightCm', { required: false, maxScale: 2 });
      const weightKg = check.decimal('weightKg', { required: false, maxScale: 2 });
      const dueDate = check.date('dueDate', false);
      const notes = check.optionalText('notes', LIMITS.pieceNotes);
      check.done();
      if (ctx.resolved.stampTaken) throw fail.conflict(F.stampTaken);

      const row = await ctx.app.db.one<Row>(
        `INSERT INTO pieces (desk_id, client_id, title, maker, year, stamp_number,
           width_cm, depth_cm, height_cm, weight_kg, due_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          desk.id,
          clientRow.id,
          title,
          maker ?? null,
          year ?? null,
          stamp ?? null,
          decimalText(widthCm),
          decimalText(depthCm),
          decimalText(heightCm),
          decimalText(weightKg),
          dueDate ? dateText(dueDate) : null,
          notes ?? null,
        ],
      );
      await ctx.app.db.query(
        `INSERT INTO layouts (piece_id, version, placements) VALUES ($1, 1, $2)`,
        [row!.id, JSON.stringify(emptyPlacements())],
      );
      await indexQuietly(ctx, String(row!.id), String(row!.title));
      ctx.json(201, { piece: presentPiece(row!) });
    },
  },

  {
    method: 'GET',
    pattern: '/api/pieces/:id',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      ctx.json(200, { piece: presentPiece(resolved(ctx)) });
    },
  },

  {
    method: 'PATCH',
    pattern: '/api/pieces/:id',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const row = resolved(ctx);
      const check = new Check(ctx.body);

      const clientRow = check.has('clientId') ? await requireOwnClient(ctx, ctx.body.clientId) : null;
      const title = check.has('title') ? check.text('title', LIMITS.pieceTitle) : undefined;
      const maker = check.optionalText('maker', LIMITS.maker);
      const year = check.optionalText('year', LIMITS.year);
      const stamp = check.has('stampNumber') ? await readStamp(ctx, check, String(row.id)) : undefined;
      const widthCm = check.decimal('widthCm', { required: false, maxScale: 2 });
      const depthCm = check.decimal('depthCm', { required: false, maxScale: 2 });
      const heightCm = check.decimal('heightCm', { required: false, maxScale: 2 });
      const weightKg = check.decimal('weightKg', { required: false, maxScale: 2 });
      const dueDate = check.date('dueDate', false);
      const notes = check.optionalText('notes', LIMITS.pieceNotes);
      const state = check.has('state')
        ? (check.choice('state', PIECE_STATES) as PieceState | null)
        : undefined;
      check.done();
      if (ctx.resolved.stampTaken) throw fail.conflict(F.stampTaken);

      const sets: string[] = [];
      const values: unknown[] = [row.id];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      if (clientRow) set('client_id', clientRow.id);
      if (title !== undefined) set('title', title);
      if (maker !== undefined) set('maker', maker);
      if (year !== undefined) set('year', year);
      if (stamp !== undefined) set('stamp_number', stamp === '' ? null : stamp);
      if (widthCm !== undefined) set('width_cm', decimalText(widthCm));
      if (depthCm !== undefined) set('depth_cm', decimalText(depthCm));
      if (heightCm !== undefined) set('height_cm', decimalText(heightCm));
      if (weightKg !== undefined) set('weight_kg', decimalText(weightKg));
      if (dueDate !== undefined) {
        set('due_date', dueDate ? dateText(dueDate) : null);
      }
      if (notes !== undefined) set('notes', notes);
      if (state !== undefined) set('state', state);

      const updated =
        sets.length === 0
          ? await findPiece(ctx, String(row.id))
          : (await ctx.app.db.one<Row>(
              `UPDATE pieces SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
              values,
            ))!;
      if (title !== undefined) await indexQuietly(ctx, String(row.id), String(title));
      ctx.json(200, { piece: presentPiece(updated) });
    },
  },
];


function decimalText(value: Dec | null | undefined): string | null {
  return value === undefined || value === null ? null : toPlain(value);
}
