// Sheets and their viewports: creation order numbers, A3/A4, viewports, the sheet lock and the editable title block values.
import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError, fieldError } from '../shared/errors.ts';
import { titleBlockFields } from '../shared/geometry/index.ts';
import { MINIMUM_ROLE } from '../shared/rules.ts';
import { PAPER_SIZE_NAMES, type DrawingListing, type PaperSize, type Sheet, type VersionState, type Viewport } from '../shared/types.ts';
import { accessTo } from './access.ts';
import { requireUser } from './auth.ts';
import { type Body, objectBody } from './body.ts';
import { db, type Queryable } from './db.ts';
import { nameField } from './fields.ts';
import { hub } from './live.ts';
import { requireRole, roleOnDrawing } from './roles.ts';
import { route } from './router.ts';
import { viewportInput, type ViewportInput } from './viewport-input.ts';


interface SheetRow {
  id: string; drawing_id: string; number: number; name: string; size: PaperSize; locked: boolean; locked_by: string | null;
  creator: string; attributes: Record<string, string>;
}
type ViewportRow = Viewport;

const sheetOf = (row: SheetRow, viewports: ViewportRow[]): Sheet => ({
  id: row.id, drawing_id: row.drawing_id, name: row.name, size: row.size, number: row.number, locked: row.locked,
  locked_by: row.locked_by, creator: row.creator, attributes: row.attributes,
  viewports: viewports.filter((viewport) => viewport.sheet_id === row.id),
});

async function readSheets(q: Queryable, rows: SheetRow[]): Promise<Sheet[]> {
  if (rows.length === 0) return [];
  const viewports = await q.query<ViewportRow>(
    'SELECT id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers FROM viewports WHERE sheet_id = ANY($1) ORDER BY seq',
    [rows.map((row) => row.id)],
  );
  return rows.map((row) => sheetOf(row, viewports));
}

/** The sheets of a drawing in creation order, with viewports. */
export async function sheetsOf(drawingId: string, q: Queryable = db): Promise<Sheet[]> {
  return readSheets(q, await q.query<SheetRow>('SELECT * FROM sheets WHERE drawing_id = $1 ORDER BY number', [drawingId]));
}

/** One sheet; `not_found` for an unknown id. */
export async function loadSheet(sheetId: string, q: Queryable = db): Promise<Sheet> {
  const rows = await q.query<SheetRow>('SELECT * FROM sheets WHERE id = $1', [sheetId]);
  if (rows.length === 0) throw new ApiError('not_found', copy.NOT_FOUND);
  return (await readSheets(q, rows))[0];
}

/** For the folder listing: each drawing's sheets with their versions, oldest first. */
export async function sheetListing(drawingIds: string[]): Promise<Map<string, DrawingListing['sheets']>> {
  const sheets = await db.query<{ drawing_id: string; id: string; name: string }>(
    'SELECT drawing_id, id, name FROM sheets WHERE drawing_id = ANY($1) ORDER BY number', [drawingIds],
  );
  const versions = await db.query<{ sheet_id: string; id: string; number: number; state: VersionState }>(
    'SELECT sheet_id, id, number, state FROM versions WHERE sheet_id = ANY($1) ORDER BY number', [sheets.map((sheet) => sheet.id)],
  );
  const listing = new Map<string, DrawingListing['sheets']>(drawingIds.map((id) => [id, []]));
  for (const sheet of sheets) {
    listing.get(sheet.drawing_id)?.push({
      id: sheet.id, name: sheet.name,
      versions: versions.filter((version) => version.sheet_id === sheet.id).map(({ id, number, state }) => ({ id, number, state })),
    });
  }
  return listing;
}

// ---------------------------------------------------------------- rules

/** A locked sheet refuses edits; `locked_by` names the manager who locked it. */
export function assertUnlocked(sheet: Sheet): void {
  if (sheet.locked_by !== null) throw new ApiError('sheet_locked', copy.sheetLockedBy(sheet.locked_by));
}

export interface SheetInput { name: string; size: PaperSize }

export function sheetInput(body: Body): SheetInput {
  const name = nameField(body);
  const size = PAPER_SIZE_NAMES.find((candidate) => candidate === body.size);
  if (!size) throw fieldError('size', copy.SHEET_SIZE);
  return { name, size };
}

/** The title block values a request may set: the editable tags, with text values. */
export function attributeInput(sheet: Sheet, value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fieldError('attributes', copy.TITLE_BLOCK_TEXT);
  const fields = titleBlockFields(sheet);
  const attributes: Record<string, string> = {};
  for (const [tag, text] of Object.entries(value)) {
    const field = fields.find((candidate) => candidate.tag === tag);
    if (!field) throw fieldError(tag, copy.titleBlockUnknown(tag));
    if (!field.editable) throw fieldError(tag, copy.titleBlockFilled(tag));
    if (typeof text !== 'string') throw fieldError(tag, copy.TITLE_BLOCK_TEXT);
    attributes[tag] = text;
  }
  return attributes;
}

// ---------------------------------------------------------------- storage

export interface NewSheet extends SheetInput { creator: string; locked_by: string | null; attributes: Record<string, string> }

/** Adds a sheet with the next number of its drawing (creation order). */
export async function insertSheet(drawingId: string, input: NewSheet): Promise<Sheet> {
  const id = randomUUID();
  await db.tx(async (q) => {
    await q.query('SELECT 1 FROM drawings WHERE id = $1 FOR UPDATE', [drawingId]);
    await q.query(
      `INSERT INTO sheets (id, drawing_id, number, name, size, locked, locked_by, creator, attributes)
       VALUES ($1, $2, (SELECT coalesce(max(number), 0) + 1 FROM sheets WHERE drawing_id = $2), $3, $4, $5, $6, $7, $8)`,
      [id, drawingId, input.name, input.size, input.locked_by !== null, input.locked_by, input.creator, JSON.stringify(input.attributes)],
    );
  });
  return loadSheet(id);
}

export async function insertViewport(sheetId: string, input: ViewportInput): Promise<Viewport> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO viewports (id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, sheetId, input.x, input.y, input.width, input.height, input.scale, input.view_x, input.view_y, JSON.stringify(input.frozen_layers)],
  );
  return { id, sheet_id: sheetId, ...input };
}

// ---------------------------------------------------------------- routes

route('POST', '/api/drawings/:id/sheets', async (ctx) => {
  await roleOnDrawing(ctx, ctx.params.id, MINIMUM_ROLE.addSheet);
  const input = sheetInput(objectBody(ctx.json()));
  const sheet = await insertSheet(ctx.params.id, { ...input, creator: requireUser(ctx).username, locked_by: null, attributes: {} });
  hub.broadcast(sheet.drawing_id, { type: 'version', data: { event: 'sheet', sheet } });
  return ctx.reply(201, { id: sheet.id, name: sheet.name, size: sheet.size, number: sheet.number, locked: false });
});

route('PATCH', '/api/sheets/:id', async (ctx) => {
  const { role, drawingId } = await accessTo(ctx, 'sheet', ctx.params.id);
  const { locked, attributes: edits } = objectBody(ctx.json());
  requireRole(role, locked === undefined ? MINIMUM_ROLE.editSheet : MINIMUM_ROLE.lockSheet);
  const username = requireUser(ctx).username;
  // the sheet is locked for the read-merge-write, so two requests that race each other both keep their tags
  const changed = await db.tx(async (q) => {
    await q.query('SELECT 1 FROM sheets WHERE id = $1 FOR UPDATE', [ctx.params.id]);
    const sheet = await loadSheet(ctx.params.id, q);
    if (edits !== undefined && locked !== false) assertUnlocked(sheet);
    if (locked === undefined && edits === undefined) throw fieldError('attributes', copy.SHEET_PATCH);
    if (locked !== undefined && typeof locked !== 'boolean') throw fieldError('locked', copy.LOCKED_FLAG);
    const attributes = edits === undefined ? sheet.attributes : { ...sheet.attributes, ...attributeInput(sheet, edits) };
    const lockedBy = locked === undefined ? sheet.locked_by : locked ? username : null;
    await q.query('UPDATE sheets SET attributes = $2, locked = $3, locked_by = $4 WHERE id = $1', [sheet.id, JSON.stringify(attributes), lockedBy !== null, lockedBy]);
    return loadSheet(sheet.id, q);
  });
  hub.broadcast(drawingId, { type: 'version', data: { event: 'sheet', sheet: changed } });
  return ctx.reply(200, changed);
});

route('POST', '/api/sheets/:id/viewports', async (ctx) => {
  const { drawingId } = await accessTo(ctx, 'sheet', ctx.params.id, MINIMUM_ROLE.editSheet);
  assertUnlocked(await loadSheet(ctx.params.id));
  const viewport = await insertViewport(ctx.params.id, viewportInput(objectBody(ctx.json()), null));
  hub.broadcast(drawingId, { type: 'version', data: { event: 'viewport', sheet: await loadSheet(ctx.params.id) } });
  return ctx.reply(201, viewport);
});

route('PATCH', '/api/viewports/:id', async (ctx) => {
  const { drawingId } = await accessTo(ctx, 'viewport', ctx.params.id, MINIMUM_ROLE.editSheet);
  const body = objectBody(ctx.json());
  // the viewport is locked for the read-merge-write, so two requests that change different fields both keep their change
  const { sheet, viewport } = await db.tx(async (q) => {
    const [current] = await q.query<Viewport>(
      `SELECT id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers FROM viewports WHERE id = $1 FOR UPDATE`, [ctx.params.id],
    );
    assertUnlocked(await loadSheet(current.sheet_id, q));
    const input = viewportInput(body, current);
    await q.query(
      `UPDATE viewports SET x = $2, y = $3, width = $4, height = $5, scale = $6, view_x = $7, view_y = $8, frozen_layers = $9 WHERE id = $1`,
      [current.id, input.x, input.y, input.width, input.height, input.scale, input.view_x, input.view_y, JSON.stringify(input.frozen_layers)],
    );
    return { sheet: await loadSheet(current.sheet_id, q), viewport: { id: current.id, sheet_id: current.sheet_id, ...input } };
  });
  hub.broadcast(drawingId, { type: 'version', data: { event: 'viewport', sheet } });
  return ctx.reply(200, viewport);
});
