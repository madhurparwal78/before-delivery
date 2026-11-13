// Markups: cloud, arrow and text on a version, carried forward to each newer version of the sheet.
import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { fieldError } from '../shared/errors.ts';
import { MINIMUM_ROLE } from '../shared/rules.ts';
import { MARKUP_KINDS, type Markup } from '../shared/types.ts';
import { accessTo } from './access.ts';
import { requireUser } from './auth.ts';
import { type Body, objectBody } from './body.ts';
import { db, type Queryable } from './db.ts';
import { numberField } from './fields.ts';
import { hub } from './live.ts';
import { route } from './router.ts';

const COLUMNS = 'id, version_id, kind, x1, y1, x2, y2, text, flag, author';

export type MarkupDraft = Pick<Markup, 'kind' | 'x1' | 'y1' | 'x2' | 'y2' | 'text'>;

export function markupDraft(body: Body): MarkupDraft {
  const kind = MARKUP_KINDS.find((candidate) => candidate === body.kind);
  if (!kind) throw fieldError('kind', copy.MARKUP_KIND);
  if (body.text !== undefined && typeof body.text !== 'string') throw fieldError('text', copy.MARKUP_TEXT);
  return { kind, x1: numberField(body, 'x1'), y1: numberField(body, 'y1'), x2: numberField(body, 'x2'), y2: numberField(body, 'y2'), text: body.text ?? '' };
}

export const markupsOf = (versionId: string, q: Queryable = db): Promise<Markup[]> =>
  q.query<Markup>(`SELECT ${COLUMNS} FROM markups WHERE version_id = $1 ORDER BY seq`, [versionId]);

export async function insertMarkup(q: Queryable, versionId: string, draft: MarkupDraft, flag: Markup['flag'], author: string): Promise<Markup> {
  const { kind, x1, y1, x2, y2, text } = draft;
  const markup: Markup = { id: randomUUID(), version_id: versionId, kind, x1, y1, x2, y2, text, flag, author };
  await q.query(
    `INSERT INTO markups (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [markup.id, versionId, kind, x1, y1, x2, y2, text, flag, author],
  );
  return markup;
}

route('POST', '/api/versions/:id/markups', async (ctx) => {
  const { drawingId } = await accessTo(ctx, 'version', ctx.params.id, MINIMUM_ROLE.addMarkup);
  const markup = await insertMarkup(db, ctx.params.id, markupDraft(objectBody(ctx.json())), null, requireUser(ctx).username);
  hub.broadcast(drawingId, { type: 'markup', data: { markup } });
  return ctx.reply(201, markup);
});

route('GET', '/api/versions/:id/markups', async (ctx) => {
  await accessTo(ctx, 'version', ctx.params.id);
  return ctx.reply(200, { markups: await markupsOf(ctx.params.id) });
});
