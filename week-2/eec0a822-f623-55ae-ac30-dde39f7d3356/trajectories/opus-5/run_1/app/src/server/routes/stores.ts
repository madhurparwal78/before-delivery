import { randomUUID } from 'node:crypto';
import { lockKey, query, queryOne, transaction, txRows } from '../db.js';
import { conflict, notFound, validation } from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction } from '../auth.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { Fields } from '../domain/validate.js';
import { requireYacht, type YachtRow } from '../records.js';
import { toInstantString } from '../../shared/zone.js';
import { json, noContent } from './helpers.js';

const CATEGORIES = ['provisions', 'drinks', 'cleaning', 'engine_room', 'safety'] as const;
const MOVEMENT_KINDS = ['received', 'used', 'spoiled'] as const;
const MAX_PAGE = 50;

interface ItemRow {
  readonly id: string;
  readonly yacht_id: string;
  readonly name: string;
  readonly unit: string;
  readonly category: string;
  readonly received_qty: string;
  readonly used_qty: string;
  readonly spoiled_qty: string;
}

const ITEM_SELECT = `
  SELECT i.id, i.yacht_id, i.name, i.unit, i.category,
    COALESCE(SUM(CASE WHEN m.kind = 'received' THEN m.quantity END), 0) AS received_qty,
    COALESCE(SUM(CASE WHEN m.kind = 'used' THEN m.quantity END), 0) AS used_qty,
    COALESCE(SUM(CASE WHEN m.kind = 'spoiled' THEN m.quantity END), 0) AS spoiled_qty
  FROM store_items i LEFT JOIN store_movements m ON m.item_id = i.id`;

function itemJson(item: ItemRow): Record<string, unknown> {
  const received = Number(item.received_qty);
  const used = Number(item.used_qty);
  const spoiled = Number(item.spoiled_qty);
  return {
    id: item.id,
    name: item.name,
    unit: item.unit,
    category: item.category,
    receivedQty: received,
    usedQty: used,
    spoiledQty: spoiled,
    onHandQty: received - used - spoiled,
  };
}

interface Cursor {
  readonly name: string;
  readonly id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.id}\u0000${cursor.name}`, 'utf8').toString('base64url');
}

function decodeCursor(value: string): Cursor {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const split = decoded.indexOf('\u0000');
  if (split < 0) throw validation({ cursor: FIELD_ERRORS.cursor });
  return { id: decoded.slice(0, split), name: decoded.slice(split + 1) };
}

async function listItems(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'stores');
  const search = (ctx.query.get('q') ?? '').trim();
  if ([...search].length > 60) throw validation({ q: FIELD_ERRORS.maxLength(60) });
  const limitValue = ctx.query.get('limit');
  let limit = MAX_PAGE;
  if (limitValue !== null && limitValue !== '') {
    const parsed = Number.parseInt(limitValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw validation({ limit: FIELD_ERRORS.wholeRange(1, MAX_PAGE) });
    }
    limit = Math.min(parsed, MAX_PAGE);
  }
  const cursorValue = ctx.query.get('cursor');
  const cursor = cursorValue === null || cursorValue === '' ? null : decodeCursor(cursorValue);
  const items = await query<ItemRow>(
    `${ITEM_SELECT}
      WHERE i.yacht_id = $1
        AND ($2::text = '' OR i.name ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR (lower(i.name), i.id) > ($3, $4))
      GROUP BY i.id
      ORDER BY lower(i.name), i.id
      LIMIT $5`,
    [
      yacht.id,
      search,
      cursor === null ? null : cursor.name,
      cursor === null ? null : cursor.id,
      limit + 1,
    ],
  );
  const page = items.slice(0, limit);
  const nextCursor =
    items.length > limit
      ? encodeCursor({ name: page[page.length - 1].name.toLowerCase(), id: page[page.length - 1].id })
      : null;
  return json(200, { items: page.map(itemJson), nextCursor });
}

async function requireItem(yacht: YachtRow, itemId: string): Promise<ItemRow> {
  const item = await queryOne<ItemRow>(
    `${ITEM_SELECT} WHERE i.id = $1 AND i.yacht_id = $2 GROUP BY i.id`,
    [itemId, yacht.id],
  );
  if (item === null) throw notFound();
  return item;
}

async function readItem(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  const item = await requireItem(yacht, ctx.params.itemId);
  requireAction(actor, 'stores');
  return json(200, { item: itemJson(item) });
}

async function addItem(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'stores');
  const body = readJsonBody(ctx);
  const fields = new Fields();
  const name = fields.text('name', body.name, 60);
  const unit = fields.text('unit', body.unit, 20);
  const category = fields.option('category', body.category, CATEGORIES);
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM store_items WHERE yacht_id = $1 AND lower(name) = lower($2)',
    [yacht.id, name],
  );
  if (existing !== null) throw conflict('item_exists');
  fields.throwIfFailed();
  const id = randomUUID();
  await query(
    `INSERT INTO store_items (id, workspace_id, yacht_id, name, unit, category, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, actor.workspaceId, yacht.id, name, unit, category, ctx.now],
  );
  return json(201, { item: itemJson(await requireItem(yacht, id)) });
}

async function removeItem(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  const item = await requireItem(yacht, ctx.params.itemId);
  requireAction(actor, 'stores');
  await query('DELETE FROM store_items WHERE id = $1', [item.id]);
  return noContent();
}

async function logMovement(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  const item = await requireItem(yacht, ctx.params.itemId);
  requireAction(actor, 'stores');
  const body = readJsonBody(ctx);
  const fields = new Fields();
  const kind = fields.option('kind', body.kind, MOVEMENT_KINDS);
  const quantity = fields.wholeNumber('quantity', body.quantity, 1, 100000);
  fields.throwIfFailed();
  const movementId = await transaction(async (client) => {
    await lockKey(client, 'store-item', item.id);
    const current = (
      await txRows<ItemRow>(client, `${ITEM_SELECT} WHERE i.id = $1 GROUP BY i.id`, [item.id])
    )[0];
    const onHand =
      Number(current.received_qty) - Number(current.used_qty) - Number(current.spoiled_qty);
    if (kind !== 'received' && quantity > onHand) {
      throw conflict('insufficient_stock', { onHandQty: onHand });
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO store_movements (id, item_id, kind, quantity, logged_by_member_id, logged_by_name, logged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, item.id, kind, quantity, actor.id, actor.name, ctx.now],
    );
    return id;
  });
  const movement = (await queryOne<{
    id: string;
    kind: string;
    quantity: number;
    logged_by_name: string;
    logged_at: Date;
  }>('SELECT id, kind, quantity, logged_by_name, logged_at FROM store_movements WHERE id = $1', [
    movementId,
  ])) as { id: string; kind: string; quantity: number; logged_by_name: string; logged_at: Date };
  return json(201, {
    movement: {
      id: movement.id,
      kind: movement.kind,
      quantity: movement.quantity,
      loggedBy: movement.logged_by_name,
      loggedAt: toInstantString(movement.logged_at),
    },
    item: itemJson(await requireItem(yacht, item.id)),
  });
}

export function registerStoreRoutes(router: Router): void {
  router.add('/api/w/:ws/yachts/:yachtSlug/stores', { GET: listItems, POST: addItem });
  router.add('/api/w/:ws/yachts/:yachtSlug/stores/:itemId', { GET: readItem, DELETE: removeItem });
  router.add('/api/w/:ws/yachts/:yachtSlug/stores/:itemId/movements', { POST: logMovement });
}
