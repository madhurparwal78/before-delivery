import type { CarryMode, SyncOp, SyncRefusal, SyncResult } from '../../shared/types.js';
import { pool, transaction, type Db } from '../db.js';
import { validationFailed } from '../http/errors.js';
import { declaredBody, integerOf, isPlainObject, present, textOf } from '../http/json.js';
import type { Route } from '../http/pipeline.js';
import { buildTripList, isUuid, loadLineRows, loadProfileRow, type ListRow } from '../store.js';
import { MESSAGES, carryModeOf } from '../validate.js';

const OP_FIELDS = ['opId', 'listId', 'itemId', 'type', 'quantity', 'fromQuantity', 'mode'];
const TYPES = ['pack', 'set_quantity', 'set_mode', 'unpack'];

function refused(opId: string | null, reason: SyncRefusal): SyncResult {
  return { opId, result: 'refused', reason };
}

function applied(opId: string): SyncResult {
  return { opId, result: 'applied', reason: null };
}

/** Reads an op into its domain shape, or reports it invalid. */
function readOp(raw: unknown): { op: SyncOp } | { invalid: true; opId: string | null } {
  const object = isPlainObject(raw) ? raw : {};
  const opId = textOf(object['opId']);
  const id = opId !== null && opId.length >= 1 && opId.length <= 64 ? opId : null;
  if (id === null) return { invalid: true, opId: null };
  if (Object.keys(object).some((key) => !OP_FIELDS.includes(key))) {
    return { invalid: true, opId: id };
  }
  const type = textOf(object['type']);
  const listId = textOf(object['listId']);
  const itemId = textOf(object['itemId']);
  if (type === null || !TYPES.includes(type) || listId === null || itemId === null) {
    return { invalid: true, opId: id };
  }
  const op: SyncOp = {
    opId: id,
    listId,
    itemId,
    type: type as SyncOp['type'],
  };
  if (present(object['quantity'])) {
    const quantity = integerOf(object['quantity']);
    if (quantity === null || quantity < 1) return { invalid: true, opId: id };
    op.quantity = quantity;
  }
  if (present(object['mode'])) {
    const mode = carryModeOf(object['mode']);
    if (mode === null) return { invalid: true, opId: id };
    op.mode = mode;
  }
  if (present(object['fromQuantity'])) {
    if (type !== 'set_quantity') return { invalid: true, opId: id };
    const from = integerOf(object['fromQuantity']);
    if (from === null || from < 1) return { invalid: true, opId: id };
    op.fromQuantity = from;
  }
  if (type === 'set_quantity' && (op.quantity === undefined || op.fromQuantity === undefined)) {
    return { invalid: true, opId: id };
  }
  if (type === 'set_mode' && op.mode === undefined) return { invalid: true, opId: id };
  return { op };
}

function canonicalOp(op: SyncOp): string {
  return JSON.stringify([
    op.listId,
    op.itemId,
    op.type,
    op.quantity ?? null,
    op.fromQuantity ?? null,
    op.mode ?? null,
  ]);
}

interface ItemState {
  id: string;
  units_owned: number;
}

/** The sync refusal order, decided here for every op. */
async function applyOp(db: Db, op: SyncOp): Promise<SyncResult> {
  const list = isUuid(op.listId)
    ? (
        await db.query<ListRow>(
          'SELECT id, name, state FROM trip_lists WHERE id = $1 FOR UPDATE',
          [op.listId],
        )
      ).rows[0]
    : undefined;
  if (list === undefined) return refused(op.opId, 'unknown_list');
  const item = isUuid(op.itemId)
    ? (
        await db.query<ItemState>('SELECT id, units_owned FROM items WHERE id = $1', [op.itemId])
      ).rows[0]
    : undefined;
  if (item === undefined) return refused(op.opId, 'unknown_item');
  if (list.state !== 'planning') return refused(op.opId, 'list_not_editable');
  if ((op.type === 'pack' || op.type === 'set_quantity') && item.units_owned === 0) {
    return refused(op.opId, 'item_retired');
  }
  const found = await db.query<{ id: string; quantity: number }>(
    'SELECT id, quantity FROM lines WHERE list_id = $1 AND item_id = $2 FOR UPDATE',
    [list.id, item.id],
  );
  const line = found.rows[0];

  if (op.type === 'pack') {
    if (line !== undefined) return refused(op.opId, 'already_packed');
    const quantity = op.quantity ?? 1;
    if (quantity > item.units_owned) return refused(op.opId, 'quantity_exceeds_owned');
    await db.query(
      'INSERT INTO lines (list_id, item_id, quantity, mode) VALUES ($1, $2, $3, $4)',
      [list.id, item.id, quantity, op.mode ?? 'base'],
    );
    return applied(op.opId);
  }
  if (line === undefined) return refused(op.opId, 'not_packed');
  if (op.type === 'set_quantity') {
    if (op.fromQuantity !== line.quantity) return refused(op.opId, 'line_changed');
    if ((op.quantity as number) > item.units_owned) {
      return refused(op.opId, 'quantity_exceeds_owned');
    }
    await db.query('UPDATE lines SET quantity = $2 WHERE id = $1', [line.id, op.quantity]);
    return applied(op.opId);
  }
  if (op.type === 'set_mode') {
    await db.query('UPDATE lines SET mode = $2 WHERE id = $1', [
      line.id,
      op.mode as CarryMode,
    ]);
    return applied(op.opId);
  }
  await db.query('DELETE FROM lines WHERE id = $1', [line.id]);
  return applied(op.opId);
}

async function runOp(raw: unknown): Promise<{ result: SyncResult; listId: string | null }> {
  const read = readOp(raw);
  if ('invalid' in read) {
    if (read.opId === null) return { result: refused(null, 'invalid_op'), listId: null };
    return {
      result: await rememberOrReplay(read.opId, `invalid:${JSON.stringify(raw ?? null)}`, async () =>
        refused(read.opId, 'invalid_op'),
      ),
      listId: null,
    };
  }
  const op = read.op;
  const result = await rememberOrReplay(op.opId, canonicalOp(op), () =>
    transaction((db) => applyOp(db, op)),
  );
  return { result, listId: op.listId };
}

/** opIds are remembered permanently, so a replayed queue never applies twice. */
async function rememberOrReplay(
  opId: string,
  canonical: string,
  work: () => Promise<SyncResult>,
): Promise<SyncResult> {
  const stored = await pool.query<{ op: string; result: SyncResult }>(
    'SELECT op, result FROM sync_ops WHERE op_id = $1',
    [opId],
  );
  const row = stored.rows[0];
  if (row !== undefined) {
    if (row.op !== canonical) return refused(opId, 'op_id_reused');
    return row.result;
  }
  const result = await work();
  await pool.query(
    `INSERT INTO sync_ops (op_id, op, result) VALUES ($1, $2, $3)
     ON CONFLICT (op_id) DO NOTHING`,
    [opId, canonical, JSON.stringify(result)],
  );
  return result;
}

export const syncRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/sync',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const body = declaredBody(ctx.body, ['ops']);
      const ops = body['ops'];
      if (!Array.isArray(ops) || ops.length < 1 || ops.length > 200) {
        throw validationFailed({ ops: MESSAGES.ops });
      }
      const results: SyncResult[] = [];
      const listIds: string[] = [];
      for (const raw of ops) {
        const { result, listId } = await runOp(raw);
        results.push(result);
        if (listId !== null && !listIds.includes(listId)) listIds.push(listId);
      }
      const profile = await loadProfileRow();
      const lists = [];
      for (const listId of listIds) {
        if (!isUuid(listId)) continue;
        const row = await pool.query<ListRow>(
          'SELECT id, name, state FROM trip_lists WHERE id = $1',
          [listId],
        );
        const listRow = row.rows[0];
        if (listRow === undefined) continue;
        const list = buildTripList(listRow, await loadLineRows(pool, listRow.id), profile);
        lists.push({ id: list.id, name: list.name, state: list.state, totals: list.totals });
      }
      return { status: 200, json: { results, lists } };
    },
  },
];
