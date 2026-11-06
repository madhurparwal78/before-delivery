import { randomUUID } from 'node:crypto';
import type { ConflictField } from '../../shared/domain.js';
import { exactUnits } from '../core/decimal.js';
import { readPinCoordinate, unitsToFraction } from '../core/geometry.js';
import { isItemAction, mayRunAction, type ItemAction } from '../core/lifecycle.js';
import {
  applyEdit,
  bodyOf,
  checkEdit,
  createNote,
  currentRev,
  resultingLength,
} from '../core/notes.js';
import { db, type Queryable } from '../db.js';
import { ApiError, fail, FIELD_MESSAGES, validationBody, type ErrorBody } from '../errors.js';
import { emitItem, emitNote, jobWrite } from '../events.js';
import { body, requireAccount, route, sendJson, type Ctx, type Route } from '../http.js';
import { isUuid, requireJob, type JobContext } from '../jobctx.js';
import {
  canSeeItem,
  canSeeNote,
  loadItems,
  loadRooms,
  projectItem,
  roomForPin,
  type ItemRecord,
  type RoomRecord,
} from '../model.js';
import {
  checkTradeChange,
  clearConflict,
  encodeFieldValue,
  insertItem,
  raiseFieldErrors,
  readItemFields,
  recordConflict,
  recordItemChange,
  reloadItem,
  resolveRoomAndPin,
  writeItem,
} from '../itemcore.js';
import { queueAssignmentNotices } from '../mail.js';
import { currentRevision } from '../jobview.js';
import { applyTransitionTo, factsOf } from './items.js';
import { mapThrough, transformsSince } from './plan.js';

const MAX_OPS = 200;
const MERGED_FIELDS: ConflictField[] = [
  'title',
  'room_id',
  'trade',
  'cost_note',
  'quantity',
  'unit_cost',
  'pin',
];

type Outcome = 'applied' | 'duplicate' | 'conflict' | 'rejected';

type OpResult = {
  op_id: string;
  seq: number;
  outcome: Outcome;
  item: Record<string, unknown> | null;
  error: ErrorBody | null;
};

type RawOp = Record<string, unknown>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function contentOf(op: RawOp): string {
  const copy: RawOp = { ...op };
  delete copy.op_id;
  delete copy.seq;
  return canonical(copy);
}

/** The canonical comparison form of one field value. */
function encodeRaw(field: ConflictField, value: unknown): string {
  switch (field) {
    case 'pin': {
      if (value === null || typeof value !== 'object') return 'null';
      const point = value as Record<string, unknown>;
      const x = readPinCoordinate(point.x);
      const y = readPinCoordinate(point.y);
      return x === null || y === null ? 'invalid' : `${x},${y}`;
    }
    case 'quantity': {
      if (value === null) return 'null';
      if (typeof value !== 'string') return 'invalid';
      const units = exactUnits(value, 3);
      return units === null ? 'invalid' : units.toString();
    }
    case 'unit_cost': {
      if (value === null) return 'null';
      if (typeof value !== 'string') return 'invalid';
      const units = exactUnits(value, 2);
      return units === null ? 'invalid' : units.toString();
    }
    default:
      return value === null ? 'null' : JSON.stringify(value);
  }
}

function encodeServer(field: ConflictField, item: ItemRecord): string {
  switch (field) {
    case 'pin':
      return item.pin === null ? 'null' : `${item.pin.x},${item.pin.y}`;
    case 'quantity':
      return item.quantity === null ? 'null' : item.quantity.toString();
    case 'unit_cost':
      return item.unitCost === null ? 'null' : item.unitCost.toString();
    default:
      return JSON.stringify(encodeFieldValue(field, item) ?? null);
  }
}

type SyncState = {
  ctx: JobContext;
  rooms: RoomRecord[];
  transformsCache: Map<number, Awaited<ReturnType<typeof transformsSince>>>;
  currentPlanRevision: number | null;
  syncedItems: Set<string>;
  conflictItems: Set<string>;
  at: Date;
};

async function resolveClientId(
  tx: Queryable,
  jobId: string,
  kind: 'item' | 'note',
  id: unknown,
): Promise<string | null> {
  if (typeof id !== 'string') return null;
  const { rows } = await tx.query(
    `select server_id from client_ids where job_id = $1 and kind = $2 and client_id = $3`,
    [jobId, kind, id],
  );
  if (rows.length > 0) return rows[0].server_id as string;
  return isUuid(id) ? id : null;
}

async function mapClientId(
  tx: Queryable,
  jobId: string,
  kind: 'item' | 'note',
  clientId: unknown,
  serverId: string,
): Promise<void> {
  if (typeof clientId !== 'string' || clientId === '') return;
  await tx.query(
    `insert into client_ids (job_id, kind, client_id, server_id) values ($1, $2, $3, $4)
     on conflict (job_id, kind, client_id) do nothing`,
    [jobId, kind, clientId, serverId],
  );
}

async function clientIdTaken(
  tx: Queryable,
  jobId: string,
  kind: 'item' | 'note',
  clientId: unknown,
): Promise<boolean> {
  if (typeof clientId !== 'string' || clientId === '') return false;
  const { rows } = await tx.query(
    `select 1 from client_ids where job_id = $1 and kind = $2 and client_id = $3`,
    [jobId, kind, clientId],
  );
  return rows.length > 0;
}

async function planTransforms(
  tx: Queryable,
  state: SyncState,
  revision: number,
): Promise<Awaited<ReturnType<typeof transformsSince>>> {
  const cached = state.transformsCache.get(revision);
  if (cached) return cached;
  const transforms = await transformsSince(tx, state.ctx.job.id, revision);
  state.transformsCache.set(revision, transforms);
  return transforms;
}

function readPlanRevision(state: SyncState, op: RawOp): number {
  const raw = op.plan_revision;
  if (raw === undefined || raw === null) return state.currentPlanRevision ?? 0;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new ApiError('validation', { fields: { plan_revision: 'Give the plan revision this pin was placed on.' } });
  }
  if (state.currentPlanRevision === null || raw > state.currentPlanRevision) {
    throw new ApiError('validation', { fields: { plan_revision: 'That plan revision does not exist yet.' } });
  }
  return raw;
}

async function requireSyncItem(
  tx: Queryable,
  state: SyncState,
  rawId: unknown,
): Promise<ItemRecord> {
  const id = await resolveClientId(tx, state.ctx.job.id, 'item', rawId);
  if (id === null) fail('not_found');
  const items = await loadItems(tx, state.ctx.job.id, [id]);
  const item = items[0];
  if (item === undefined || !canSeeItem(state.ctx.viewer, item)) fail('not_found');
  return item;
}

async function runCreateItem(
  tx: Queryable,
  state: SyncState,
  op: RawOp,
): Promise<{ outcome: Outcome; item: ItemRecord }> {
  const ctx = state.ctx;
  if (ctx.viewer.role === 'trade') fail('forbidden');
  if (await clientIdTaken(tx, ctx.job.id, 'item', op.client_item_id)) {
    throw new ApiError('validation', {
      fields: { client_item_id: 'That client item id is already used.' },
    });
  }
  const revision = readPlanRevision(state, op);
  const raw = { ...((op.fields as RawOp) ?? {}) };
  if (raw.pin !== undefined && raw.pin !== null && state.currentPlanRevision !== null) {
    const point = raw.pin as Record<string, unknown>;
    const x = readPinCoordinate(point.x);
    const y = readPinCoordinate(point.y);
    if (x !== null && y !== null) {
      const mapped = mapThrough(await planTransforms(tx, state, revision), { x, y });
      raw.pin = { x: unitsToFraction(mapped.x), y: unitsToFraction(mapped.y) };
    }
  }
  const fields = readItemFields(raw, state.rooms, ctx.viewer.role);
  if (!fields.present.has('title')) fields.errors.title = 'Give the item a title.';
  if (!fields.present.has('room_id')) fields.errors.room_id = 'Choose the room this item is in.';
  raiseFieldErrors(fields);

  let roomId = fields.roomId!;
  let pinStatus: 'placed' | 'unpinned' = 'unpinned';
  if (fields.present.has('pin') && fields.pin !== null) {
    const room = roomForPin(state.rooms, fields.pin, roomId, null);
    if (room === null) throw new ApiError('validation', { fields: { pin: FIELD_MESSAGES.pin } });
    roomId = room.id;
    pinStatus = 'placed';
  }
  const item = await insertItem(
    tx,
    ctx,
    {
      title: fields.title!,
      roomId,
      trade: fields.present.has('trade') ? fields.trade : null,
      costNote: fields.present.has('cost_note') ? fields.costNote : null,
      quantity: fields.present.has('quantity') ? fields.quantity : null,
      unitCost: fields.present.has('unit_cost') ? fields.unitCost : null,
      pin: pinStatus === 'placed' ? fields.pin : null,
      pinStatus,
    },
    state.at,
  );
  await mapClientId(tx, ctx.job.id, 'item', op.client_item_id, item.id);
  state.syncedItems.add(item.id);
  return { outcome: 'applied', item };
}

type FieldPlan = {
  field: ConflictField;
  applies: boolean;
  conflict: boolean;
  serverValue: unknown;
  phoneValue: unknown;
};

async function runUpdateItem(
  tx: Queryable,
  state: SyncState,
  op: RawOp,
): Promise<{ outcome: Outcome; item: ItemRecord }> {
  const ctx = state.ctx;
  const item = await requireSyncItem(tx, state, op.item_id);
  const changes = op.changes;
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) {
    throw new ApiError('validation', { fields: { changes: 'Send the fields that changed.' } });
  }
  const record = changes as Record<string, { from?: unknown; to?: unknown }>;
  const keys = Object.keys(record).filter((key) =>
    (MERGED_FIELDS as string[]).includes(key),
  ) as ConflictField[];
  if (keys.length === 0) {
    throw new ApiError('validation', { fields: { changes: 'Send the fields that changed.' } });
  }

  const revision = readPlanRevision(state, op);
  const transforms =
    record.pin === undefined ? [] : await planTransforms(tx, state, revision);
  const mapPin = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const point = value as Record<string, unknown>;
    const x = readPinCoordinate(point.x);
    const y = readPinCoordinate(point.y);
    if (x === null || y === null) return value;
    const mapped = mapThrough(transforms, { x, y });
    return { x: unitsToFraction(mapped.x), y: unitsToFraction(mapped.y) };
  };

  const rawTo: RawOp = {};
  for (const key of keys) {
    rawTo[key] = key === 'pin' ? mapPin(record[key].to) : record[key].to;
  }
  const fields = readItemFields(rawTo, state.rooms, ctx.viewer.role);
  const homeownerPinOnly =
    ctx.viewer.role === 'homeowner' &&
    keys.length === 1 &&
    keys[0] === 'pin' &&
    item.createdById === ctx.viewer.personId;
  if (ctx.viewer.role === 'trade') fail('forbidden');
  if (ctx.viewer.role === 'homeowner' && !homeownerPinOnly) fail('forbidden');

  if (fields.present.has('trade')) {
    const serverTrade = item.trade;
    const to = fields.trade;
    if (to !== serverTrade) checkTradeChange(item, to);
  }
  raiseFieldErrors(fields);

  const plans: FieldPlan[] = [];
  const pinSentWithRoom = keys.includes('pin');
  for (const key of keys) {
    if (key === 'room_id' && pinSentWithRoom) continue;
    const serverEnc = encodeServer(key, item);
    const fromEnc = encodeRaw(key, key === 'pin' ? mapPin(record[key].from) : record[key].from);
    const toEnc = encodeRaw(key, key === 'pin' ? mapPin(record[key].to) : record[key].to);
    if (serverEnc === fromEnc) {
      plans.push({ field: key, applies: true, conflict: false, serverValue: null, phoneValue: null });
    } else if (serverEnc === toEnc) {
      plans.push({ field: key, applies: false, conflict: false, serverValue: null, phoneValue: null });
    } else if (key === 'pin') {
      plans.push({
        field: key,
        applies: true,
        conflict: true,
        serverValue: encodeFieldValue('pin', item),
        phoneValue:
          fields.pin === null
            ? null
            : { x: unitsToFraction(fields.pin.x), y: unitsToFraction(fields.pin.y) },
      });
    } else {
      plans.push({
        field: key,
        applies: false,
        conflict: true,
        serverValue: encodeFieldValue(key, item),
        phoneValue: phoneValueOf(key, fields),
      });
    }
  }

  const applied = new Set(plans.filter((plan) => plan.applies).map((plan) => plan.field));
  const previousTrade = item.trade;
  const placement = resolveRoomAndPin(state.rooms, item, {
    pinSent: applied.has('pin'),
    pin: fields.pin,
    roomSent: applied.has('room_id') || (applied.has('pin') && keys.includes('room_id')),
    roomId: fields.roomId,
  });

  await writeItem(
    tx,
    item.id,
    {
      title: applied.has('title') ? fields.title! : undefined,
      trade: applied.has('trade') ? fields.trade : undefined,
      costNote: applied.has('cost_note') ? fields.costNote : undefined,
      quantity: applied.has('quantity') ? fields.quantity : undefined,
      unitCost: applied.has('unit_cost') ? fields.unitCost : undefined,
      roomId: placement.roomId,
      pin: placement.pin,
      pinStatus: placement.pinStatus,
      by: ctx.viewer.name,
    },
    state.at,
  );
  for (const plan of plans) {
    if (plan.conflict) {
      await recordConflict(
        tx,
        item.id,
        plan.field,
        plan.serverValue,
        serverAuthor(item),
        plan.phoneValue,
        ctx.viewer.name,
      );
    } else if (plan.applies) {
      await clearConflict(tx, item.id, plan.field);
    }
  }

  const fresh = await reloadItem(tx, ctx.job.id, item.id);
  if (fresh.roomId !== item.roomId) {
    await recordItemChange(tx, ctx.job.id, fresh, 'refiled', state.at);
  }
  await emitItem(tx, ctx.job.id, fresh, previousTrade);
  if (applied.has('trade') && fresh.trade !== null && fresh.trade !== previousTrade) {
    const room = state.rooms.find((candidate) => candidate.id === fresh.roomId)!;
    await queueAssignmentNotices(
      tx,
      ctx.job,
      fresh,
      room.name,
      fresh.trade,
      ctx.members,
      state.at,
    );
  }
  const hasConflict = plans.some((plan) => plan.conflict);
  if (!hasConflict) state.syncedItems.add(item.id);
  if (hasConflict) state.conflictItems.add(item.id);
  return { outcome: hasConflict ? 'conflict' : 'applied', item: fresh };
}

function phoneValueOf(field: ConflictField, fields: ReturnType<typeof readItemFields>): unknown {
  switch (field) {
    case 'title':
      return fields.title;
    case 'room_id':
      return fields.roomId;
    case 'trade':
      return fields.trade;
    case 'cost_note':
      return fields.costNote;
    case 'quantity':
      return fields.quantity === null ? null : formatUnitsOf(fields.quantity, 3);
    case 'unit_cost':
      return fields.unitCost === null ? null : formatUnitsOf(fields.unitCost, 2);
    case 'pin':
      return fields.pin === null
        ? null
        : { x: unitsToFraction(fields.pin.x), y: unitsToFraction(fields.pin.y) };
  }
}

function formatUnitsOf(units: bigint, scale: number): string {
  const text = units.toString().padStart(scale + 1, '0');
  return `${text.slice(0, text.length - scale)}.${text.slice(text.length - scale)}`;
}

/** Whoever last set the value the server is holding. */
function serverAuthor(item: ItemRecord): string {
  return item.lastBy ?? item.createdBy.name;
}

async function runItemAction(
  tx: Queryable,
  state: SyncState,
  op: RawOp,
): Promise<{ outcome: Outcome; item: ItemRecord }> {
  const item = await requireSyncItem(tx, state, op.item_id);
  const action = isItemAction(op.action) ? (op.action as ItemAction) : null;
  const items = await loadItems(tx, state.ctx.job.id);
  if (action === null) {
    throw new ApiError('validation', { fields: { action: 'Choose an item action.' } });
  }
  if (
    !mayRunAction(action, {
      role: state.ctx.viewer.role,
      trade: state.ctx.viewer.trade,
      personId: state.ctx.viewer.personId,
    }, factsOf(item, items))
  ) {
    fail('forbidden');
  }
  let reason: string | null = null;
  if (action === 'send_back') {
    if (typeof op.reason !== 'string' || op.reason.length < 1 || op.reason.length > 500) {
      throw new ApiError('validation', {
        fields: { reason: 'Give a reason of 1 to 500 characters.' },
      });
    }
    reason = op.reason;
  }
  const outcome = await applyTransitionTo(tx, state.ctx, item, action, reason, state.at);
  state.syncedItems.add(item.id);
  return { outcome: 'applied', item: outcome.item };
}

async function runAddNote(
  tx: Queryable,
  state: SyncState,
  op: RawOp,
): Promise<{ outcome: Outcome; item: ItemRecord }> {
  const ctx = state.ctx;
  const item = await requireSyncItem(tx, state, op.item_id);
  if (await clientIdTaken(tx, ctx.job.id, 'note', op.client_note_id)) {
    throw new ApiError('validation', {
      fields: { client_note_id: 'That client note id is already used.' },
    });
  }
  const text = op.body;
  if (typeof text !== 'string' || Array.from(text).length < 1 || Array.from(text).length > 2000) {
    throw new ApiError('validation', { fields: { body: 'Write a note of 1 to 2,000 characters.' } });
  }
  let audience: 'crew' | 'everyone' = 'everyone';
  if (op.audience !== undefined && op.audience !== null) {
    if (op.audience !== 'crew' && op.audience !== 'everyone') {
      throw new ApiError('validation', { fields: { audience: 'Choose who can see this note.' } });
    }
    audience = op.audience;
  }
  if (ctx.viewer.role === 'homeowner' && audience === 'crew') fail('forbidden');

  let parentId: string | null = null;
  if (op.parent_id !== undefined && op.parent_id !== null) {
    const resolved = await resolveClientId(tx, ctx.job.id, 'note', op.parent_id);
    const parent =
      resolved === null ? undefined : item.notes.find((candidate) => candidate.id === resolved);
    if (parent === undefined || !canSeeNote(ctx.viewer, parent)) fail('not_found');
    if (parent.parentId !== null) {
      throw new ApiError('validation', { fields: { parent_id: 'Replies go one level deep.' } });
    }
    if (parent.audience === 'crew' && audience !== 'crew') {
      throw new ApiError('validation', {
        fields: { audience: 'A reply to a crew note is crew only.' },
      });
    }
    parentId = parent.id;
  }

  const noteId = randomUUID();
  const doc = createNote(
    text,
    {
      personId: ctx.viewer.personId,
      memberId: ctx.viewer.memberId ?? ctx.viewer.personId,
      name: ctx.viewer.name,
      role: ctx.viewer.role,
    },
    state.at.toISOString(),
  );
  await tx.query(
    `insert into notes (id, job_id, item_id, parent_id, audience, author_id, doc, rev, body, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)`,
    [
      noteId,
      ctx.job.id,
      item.id,
      parentId,
      audience,
      ctx.viewer.personId,
      JSON.stringify(doc),
      text,
      state.at.toISOString(),
    ],
  );
  await mapClientId(tx, ctx.job.id, 'note', op.client_note_id, noteId);
  await emitNote(tx, ctx.job.id, item.id, noteId, item.trade, audience);
  state.syncedItems.add(item.id);
  return { outcome: 'applied', item: await reloadItem(tx, ctx.job.id, item.id) };
}

async function runEditNote(
  tx: Queryable,
  state: SyncState,
  op: RawOp,
): Promise<{ outcome: Outcome; item: ItemRecord }> {
  const ctx = state.ctx;
  const item = await requireSyncItem(tx, state, op.item_id);
  const noteId = await resolveClientId(tx, ctx.job.id, 'note', op.note_id);
  const note =
    noteId === null ? undefined : item.notes.find((candidate) => candidate.id === noteId);
  if (note === undefined || !canSeeNote(ctx.viewer, note)) fail('not_found');
  if (
    ctx.viewer.role !== 'owner' &&
    ctx.viewer.role !== 'lead' &&
    note.authorId !== ctx.viewer.personId
  ) {
    fail('forbidden');
  }
  const edit = {
    baseRev: typeof op.base_rev === 'number' ? op.base_rev : -1,
    pos: typeof op.pos === 'number' ? op.pos : -1,
    del: typeof op.delete === 'number' ? op.delete : 0,
    insert: typeof op.insert === 'string' ? op.insert : '',
  };
  const problem = checkEdit(note.doc, edit);
  if (problem !== null) {
    const key = problem === 'empty' ? 'delete' : problem;
    throw new ApiError('validation', { fields: { [key]: 'That edit does not fit this note.' } });
  }
  const resulting = resultingLength(note.doc, edit);
  if (resulting < 1 || resulting > 2000) {
    throw new ApiError('validation', { fields: { insert: 'A note is 1 to 2,000 characters.' } });
  }
  const doc = note.doc;
  applyEdit(
    doc,
    edit,
    {
      personId: ctx.viewer.personId,
      memberId: ctx.viewer.memberId ?? ctx.viewer.personId,
      name: ctx.viewer.name,
      role: ctx.viewer.role,
    },
    state.at.toISOString(),
  );
  await tx.query(`update notes set doc = $2, rev = $3, body = $4 where id = $1`, [
    note.id,
    JSON.stringify(doc),
    currentRev(doc),
    bodyOf(doc),
  ]);
  await emitNote(tx, ctx.job.id, item.id, note.id, item.trade, note.audience);
  state.syncedItems.add(item.id);
  return { outcome: 'applied', item: await reloadItem(tx, ctx.job.id, item.id) };
}

const HANDLERS = {
  create_item: runCreateItem,
  update_item: runUpdateItem,
  item_action: runItemAction,
  add_note: runAddNote,
  edit_note: runEditNote,
} as const;

export const syncRoutes: Route[] = [
  route('POST', '/api/jobs/:jobId/sync', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    if (jobCtx.job.status === 'closed_out') fail('job_closed');
    const raw = body(ctx);
    const ops = raw.ops;
    const badOps = (): never => {
      throw new ApiError('validation', {
        fields: { ops: 'Send 1 to 200 operations, each with its own client sequence number.' },
      });
    };
    if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS) badOps();
    const seen = new Set<number>();
    for (const entry of ops as unknown[]) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) badOps();
      const op = entry as RawOp;
      const seq = op.seq;
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || seq > 2147483647) {
        badOps();
      }
      if (seen.has(seq as number)) badOps();
      seen.add(seq as number);
      if (typeof op.op_id !== 'string' || !isUuid(op.op_id)) {
        throw new ApiError('validation', { fields: { op_id: 'Give each operation a UUID.' } });
      }
    }

    const ordered = [...(ops as RawOp[])].sort((a, b) => (a.seq as number) - (b.seq as number));

    const results = await jobWrite(jobCtx.job.id, async (tx) => {
      const plan = await currentRevision(tx, jobCtx.job.id);
      const state: SyncState = {
        ctx: jobCtx,
        rooms: await loadRooms(tx, jobCtx.job.id),
        transformsCache: new Map(),
        currentPlanRevision: plan === null ? null : plan.revision,
        syncedItems: new Set<string>(),
        conflictItems: new Set<string>(),
        at: new Date(),
      };
      const out: OpResult[] = [];
      for (let index = 0; index < ordered.length; index++) {
        const op = ordered[index];
        const opId = op.op_id as string;
        const seq = op.seq as number;
        const logged = await tx.query(
          `select content, outcome, item_id from operation_log where job_id = $1 and op_id = $2`,
          [jobCtx.job.id, opId],
        );
        if (logged.rowCount > 0) {
          const row = logged.rows[0];
          if ((row.content as string) !== contentOf(op)) {
            out.push({
              op_id: opId,
              seq,
              outcome: 'rejected',
              item: null,
              error: validationBody({ op_id: 'That operation id was already used for other content.' }),
            });
            continue;
          }
          const itemId = row.item_id as string | null;
          let item: Record<string, unknown> | null = null;
          if (itemId !== null) {
            const items = await loadItems(tx, jobCtx.job.id, [itemId]);
            if (items[0] !== undefined && canSeeItem(jobCtx.viewer, items[0])) {
              item = projectItem(items[0], jobCtx.viewer);
            }
          }
          out.push({ op_id: opId, seq, outcome: 'duplicate', item, error: null });
          continue;
        }

        const type = op.type;
        const savepoint = `op_${index}`;
        await tx.query(`savepoint ${savepoint}`);
        try {
          if (typeof type !== 'string' || !(type in HANDLERS)) {
            throw new ApiError('validation', { fields: { type: 'That operation type does not exist.' } });
          }
          const handler = HANDLERS[type as keyof typeof HANDLERS];
          const outcome = await handler(tx, state, op);
          await tx.query(`release savepoint ${savepoint}`);
          await tx.query(
            `insert into operation_log (job_id, op_id, type, content, outcome, item_id, created_at)
             values ($1, $2, $3, $4, $5, $6, now())`,
            [jobCtx.job.id, opId, type, contentOf(op), outcome.outcome, outcome.item.id],
          );
          out.push({
            op_id: opId,
            seq,
            outcome: outcome.outcome,
            item: projectItem(outcome.item, jobCtx.viewer),
            error: null,
          });
        } catch (error) {
          await tx.query(`rollback to savepoint ${savepoint}`);
          if (!(error instanceof ApiError)) throw error;
          out.push({ op_id: opId, seq, outcome: 'rejected', item: null, error: error.body });
        }
      }
      return {
        results: out,
        synced: state.syncedItems.size,
        conflicts: state.conflictItems.size,
      };
    });

    sendJson(ctx.res, 200, results);
  }),
];
