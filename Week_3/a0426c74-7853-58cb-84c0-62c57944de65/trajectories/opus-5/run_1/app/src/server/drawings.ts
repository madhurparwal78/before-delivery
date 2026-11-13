import { ApiError, MESSAGES } from '../shared/errors.js';
import {
  type ApplyContext,
  type ApplyOutcome,
  type ImportPayload,
  applyGroup,
  applyPatch,
  diffModel,
  lockedLayerError,
  refreshDerived,
  supersededTarget,
  undoSkipMessage,
} from '../shared/apply.js';
import type { DrawingModel, Entity, Layer } from '../shared/model.js';
import { emptyModel } from '../shared/model.js';
import type { ModelPatch, Notice, OpResult, Operation } from '../shared/operations.js';
import type { XrefSnapshot } from '../shared/snapshot.js';
import { transformEntity } from '../shared/geometry.js';
import { config } from './config.js';
import { now } from './clock.js';
import { one, query } from './db.js';
import { newId } from './ids.js';

export interface GroupRecord {
  seq: number;
  group_id: string;
  username: string;
  command: string;
  base_revision: number;
  revision_before: number;
  revision_after: number;
  patch: ModelPatch;
  targets: string[];
  undone: boolean;
  dropped: boolean;
  inverse_of: string | null;
  at: number;
}

export interface LiveMessage {
  seq: number;
  type: string;
  data: Record<string, unknown>;
  to?: string;
}

export interface LiveClient {
  username: string;
  connectionId: string;
  send(message: LiveMessage): void;
  close(): void;
}

export interface PresenceEntry {
  username: string;
  colour: number;
  x: number;
  y: number;
  zoom: number;
  pan_x: number;
  pan_y: number;
  connections: Set<string>;
  leaveAt: number | null;
}

export interface DrawingState {
  id: string;
  folder_id: string;
  name: string;
  model: DrawingModel;
  revision: number;
  groups: GroupRecord[];
  opResults: Map<string, { result: OpResult; group_id: string; revision: number }>;
  messages: LiveMessage[];
  liveSeq: number;
  clients: Set<LiveClient>;
  presence: Map<string, PresenceEntry>;
  opTimestamps: Map<string, number[]>;
  queue: Promise<unknown>;
}

const cache = new Map<string, DrawingState>();

interface DrawingRow {
  id: string;
  folder_id: string;
  name: string;
  revision: number;
  model: DrawingModel;
}

export async function loadDrawing(id: string): Promise<DrawingState | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  const row = await one<DrawingRow>('select id, folder_id, name, revision, model from drawings where id = $1', [id]);
  if (!row) return null;
  const groups = await query<{
    seq: string;
    group_id: string;
    username: string;
    command: string;
    base_revision: number;
    revision_before: number;
    revision_after: number;
    patch: ModelPatch;
    targets: string[];
    undone: boolean;
    dropped: boolean;
    inverse_of: string | null;
    at: Date;
  }>(
    'select seq, group_id, username, command, base_revision, revision_before, revision_after, patch, targets, undone, dropped, inverse_of, at from operation_groups where drawing_id = $1 order by seq',
    [id],
  );
  const operations = await query<{ op_id: string; group_id: string; result: OpResult; revision: number }>(
    'select op_id, group_id, result, revision from operations where drawing_id = $1',
    [id],
  );
  const messages = await query<{ seq: number; type: string; data: Record<string, unknown> }>(
    'select seq, type, data from live_messages where drawing_id = $1 order by seq',
    [id],
  );
  const state: DrawingState = {
    id: row.id,
    folder_id: row.folder_id,
    name: row.name,
    model: row.model,
    revision: row.revision,
    groups: groups.map((group) => ({
      seq: Number(group.seq),
      group_id: group.group_id,
      username: group.username,
      command: group.command,
      base_revision: group.base_revision,
      revision_before: group.revision_before,
      revision_after: group.revision_after,
      patch: group.patch,
      targets: group.targets,
      undone: group.undone,
      dropped: group.dropped,
      inverse_of: group.inverse_of,
      at: group.at.getTime(),
    })),
    opResults: new Map(
      operations.map((operation) => [
        operation.op_id,
        { result: operation.result, group_id: operation.group_id, revision: operation.revision },
      ]),
    ),
    messages: messages.map((message) => ({
      seq: message.seq,
      type: message.type,
      data: message.data,
      to: typeof message.data.to === 'string' ? message.data.to : undefined,
    })),
    liveSeq: messages.length ? messages[messages.length - 1].seq : 0,
    clients: new Set(),
    presence: new Map(),
    opTimestamps: new Map(),
    queue: Promise.resolve(),
  };
  cache.set(id, state);
  return state;
}

export async function createDrawing(folderId: string, name: string, id = newId('dwg')): Promise<DrawingState> {
  const model = emptyModel();
  await query('insert into drawings (id, folder_id, name, revision, model) values ($1,$2,$3,0,$4)', [
    id,
    folderId,
    name,
    JSON.stringify(model),
  ]);
  const state = await loadDrawing(id);
  if (!state) throw new ApiError('invalid', MESSAGES.invalid);
  return state;
}

export async function drawingsInFolder(folderId: string): Promise<DrawingRow[]> {
  return query<DrawingRow>('select id, folder_id, name, revision, model from drawings where folder_id = $1 order by created_at', [
    folderId,
  ]);
}

export async function drawingNamed(folderId: string, name: string): Promise<DrawingRow | null> {
  return one<DrawingRow>('select id, folder_id, name, revision, model from drawings where folder_id = $1 and name = $2', [
    folderId,
    name,
  ]);
}

async function persistModel(state: DrawingState): Promise<void> {
  await query('update drawings set revision = $2, model = $3 where id = $1', [
    state.id,
    state.revision,
    JSON.stringify(state.model),
  ]);
}

/** One place for every live message: it takes the next per-drawing sequence number. */
export async function broadcast(
  state: DrawingState,
  type: string,
  data: Record<string, unknown>,
  to?: string,
  options: { keep?: boolean } = {},
): Promise<LiveMessage> {
  state.liveSeq += 1;
  const message: LiveMessage = { seq: state.liveSeq, type, data: to ? { ...data, to } : data, to };
  for (const client of state.clients) {
    if (to && client.username !== to) continue;
    client.send(message);
  }
  if (options.keep === false) return message;
  state.messages.push(message);
  await query('insert into live_messages (drawing_id, seq, type, data) values ($1,$2,$3,$4)', [
    state.id,
    message.seq,
    type,
    JSON.stringify(message.data),
  ]);
  return message;
}

export function messagesSince(state: DrawingState, since: number, username: string): LiveMessage[] {
  return state.messages.filter((message) => message.seq > since && (!message.to || message.to === username));
}

export function withLock<T>(state: DrawingState, work: () => Promise<T>): Promise<T> {
  const run = state.queue.then(work, work);
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function entityAtRevision(state: DrawingState, handle: string, revision: number): Entity | null {
  for (const group of state.groups) {
    if (group.revision_after <= revision) continue;
    const change = group.patch.entities[handle];
    if (change) return change.before;
  }
  const current = state.model.entities.find((entity) => entity.handle === handle);
  return current ?? null;
}

export interface OpsRequest {
  base_revision: number;
  group_id: string;
  command: string;
  ops: Operation[];
}

export interface OpsResponse {
  revision: number;
  results: OpResult[];
}

function rateLimited(state: DrawingState, username: string, count: number): boolean {
  const cutoff = now() - 60000;
  const stamps = (state.opTimestamps.get(username) ?? []).filter((stamp) => stamp > cutoff);
  if (stamps.length + count > config.opRate) {
    state.opTimestamps.set(username, stamps);
    return true;
  }
  for (let index = 0; index < count; index += 1) stamps.push(now());
  state.opTimestamps.set(username, stamps);
  return false;
}

export async function versionSnapshotModel(versionKey: string): Promise<DrawingModel | null> {
  const [sheetOrId, number] = versionKey.split(':');
  const row = number
    ? await one<{ snapshot: { model: DrawingModel } }>(
        'select snapshot from versions where sheet_id in (select id from sheets where drawing_id = $1) and number = $2 order by number desc limit 1',
        [sheetOrId, Number(number)],
      )
    : await one<{ snapshot: { model: DrawingModel } }>('select snapshot from versions where id = $1', [sheetOrId]);
  if (!row) return null;
  const model = emptyModel();
  Object.assign(model, row.snapshot.model);
  return model;
}

export async function lastPublishedVersion(drawingId: string): Promise<{ number: number; model: DrawingModel; xrefs: XrefSnapshot[] } | null> {
  const row = await one<{ number: number; snapshot: { model: DrawingModel & { xrefs: XrefSnapshot[] } } }>(
    `select v.number, v.snapshot from versions v
       join sheets s on s.id = v.sheet_id
      where s.drawing_id = $1 and v.state <> 'publishing'
      order by v.created_at desc limit 1`,
    [drawingId],
  );
  if (!row) return null;
  const model = emptyModel();
  Object.assign(model, row.snapshot.model);
  return { number: row.number, model, xrefs: row.snapshot.model.xrefs ?? [] };
}

/** The entities an xref draws: its source's last published model, transformed and clipped. */
export async function resolveXrefs(state: DrawingState): Promise<XrefSnapshot[]> {
  const out: XrefSnapshot[] = [];
  for (const xref of state.model.xrefs) {
    const published = await lastPublishedVersion(xref.source);
    const entities: Entity[] = [];
    const layers: Layer[] = [];
    if (published) {
      for (const entity of published.model.entities) {
        const drawn = transformEntity(entity, { x: xref.x, y: xref.y, scale: xref.scale, rotation: xref.rotation }, [0, 0]);
        entities.push(drawn);
      }
      for (const layer of published.model.layers) layers.push({ ...layer, name: `${xref.name}|${layer.name}` });
    }
    const clipped = xref.clip
      ? entities.filter((entity) => withinClip(entity, xref.clip as [number, number, number, number]))
      : entities;
    out.push({ ...xref, entities: clipped, layers, latest_version: published ? published.number : null });
  }
  return out;
}

function withinClip(entity: Entity, rect: [number, number, number, number]): boolean {
  const minX = Math.min(rect[0], rect[2]);
  const maxX = Math.max(rect[0], rect[2]);
  const minY = Math.min(rect[1], rect[3]);
  const maxY = Math.max(rect[1], rect[3]);
  const points: [number, number][] = [];
  switch (entity.type) {
    case 'line':
      points.push([entity.x1, entity.y1], [entity.x2, entity.y2]);
      break;
    case 'circle':
    case 'arc':
      points.push([entity.cx - entity.r, entity.cy - entity.r], [entity.cx + entity.r, entity.cy + entity.r]);
      break;
    case 'pline':
      points.push(...entity.points);
      break;
    case 'insert':
      points.push([entity.x, entity.y]);
      break;
    case 'hatch':
      points.push([entity.seed_x, entity.seed_y]);
      break;
    case 'dimension':
      points.push(...entity.points);
      break;
  }
  return points.some(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
}

export interface ApplyHooks {
  importPayload?: (importId: string) => ImportPayload | null;
  versionModel?: (versionId: string) => DrawingModel | null;
  drawingName?: (drawingId: string) => string | null;
  drawingXrefs?: (drawingId: string) => { name: string; source: string }[];
  publishedVersion?: (drawingId: string) => number | null;
  draggedPoints?: string[];
}

async function recordGroup(
  state: DrawingState,
  group: Omit<GroupRecord, 'seq'>,
  results: OpResult[],
  operations: Operation[],
): Promise<GroupRecord> {
  const rows = await query<{ seq: string }>(
    `insert into operation_groups
      (drawing_id, group_id, username, command, base_revision, revision_before, revision_after, patch, targets, undone, dropped, inverse_of, at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning seq`,
    [
      state.id,
      group.group_id,
      group.username,
      group.command,
      group.base_revision,
      group.revision_before,
      group.revision_after,
      JSON.stringify(group.patch),
      JSON.stringify(group.targets),
      group.undone,
      group.dropped,
      group.inverse_of,
      new Date(group.at).toISOString(),
    ],
  );
  const record: GroupRecord = { ...group, seq: Number(rows[0].seq) };
  state.groups.push(record);
  for (const result of results) {
    const operation = operations.find((candidate) => candidate.op_id === result.op_id);
    if (!operation) continue;
    state.opResults.set(result.op_id, { result, group_id: group.group_id, revision: group.revision_after });
    await query(
      'insert into operations (drawing_id, op_id, group_id, result, revision) values ($1,$2,$3,$4,$5) on conflict do nothing',
      [state.id, result.op_id, group.group_id, JSON.stringify(result), group.revision_after],
    );
  }
  return record;
}

async function broadcastGroup(
  state: DrawingState,
  group: GroupRecord,
  results: OpResult[],
  notices: Notice[],
): Promise<void> {
  const data: Record<string, unknown> = {
    group_id: group.group_id,
    username: group.username,
    command: group.command,
    base_revision: group.base_revision,
    revision: group.revision_after,
    results,
    patch: group.patch,
  };
  if (group.patch.other) data.xrefs = await resolveXrefs(state);
  await broadcast(state, 'ops', data);
  for (const notice of notices) {
    await broadcast(state, 'notice', { text: notice.text }, notice.to);
  }
}

export async function applyOperations(
  state: DrawingState,
  username: string,
  request: OpsRequest,
  hooks: ApplyHooks = {},
): Promise<OpsResponse> {
  return withLock(state, async () => {
    const replayed = request.ops
      .map((operation) => state.opResults.get(operation.op_id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    if (replayed.length === request.ops.length && request.ops.length > 0) {
      return { revision: replayed[replayed.length - 1].revision, results: replayed.map((entry) => entry.result) };
    }

    if (rateLimited(state, username, request.ops.length)) {
      throw new ApiError('rate_limited', MESSAGES.rateLimited);
    }
    const locked = lockedLayerError(state.model, request.ops);
    if (locked) throw locked;
    if (state.revision - request.base_revision > config.opWindow) {
      throw new ApiError('stale_base', MESSAGES.staleBase);
    }

    const context: ApplyContext = {
      username,
      baseRevision: request.base_revision,
      command: request.command,
      revision: state.revision,
      entityAtRevision: (handle, revision) => entityAtRevision(state, handle, revision),
      thisDrawingId: state.id,
      thisDrawingName: state.name,
      ...hooks,
    };
    const before = state.revision;
    const outcome: ApplyOutcome = applyGroup(state.model, request.ops, context);
    state.revision = outcome.revision;
    await persistModel(state);
    const group = await recordGroup(
      state,
      {
        group_id: request.group_id,
        username,
        command: request.command,
        base_revision: request.base_revision,
        revision_before: before,
        revision_after: outcome.revision,
        patch: outcome.patch,
        targets: outcome.targets,
        undone: false,
        dropped: false,
        inverse_of: null,
        at: now(),
      },
      outcome.results,
      request.ops,
    );
    for (const candidate of state.groups) {
      if (candidate.username === username && candidate.undone) candidate.dropped = true;
    }
    await query('update operation_groups set dropped = true where drawing_id = $1 and username = $2 and undone = true', [
      state.id,
      username,
    ]);
    await broadcastGroup(state, group, outcome.results, outcome.notices);
    return { revision: state.revision, results: outcome.results };
  });
}

function myGroups(state: DrawingState, username: string): GroupRecord[] {
  return state.groups
    .filter((group) => group.username === username && group.inverse_of === null && !group.dropped)
    .slice(-config.undoDepth);
}

export async function undo(state: DrawingState, username: string): Promise<{ revision: number; command: string }> {
  return withLock(state, async () => {
    const candidates = myGroups(state, username).filter((group) => !group.undone);
    const group = candidates[candidates.length - 1];
    if (!group) throw new ApiError('nothing_to_undo', MESSAGES.nothingToUndo);
    const superseded = supersededTarget(state.model, group.targets, group.revision_after, username);
    if (superseded) {
      group.dropped = true;
      await query('update operation_groups set dropped = true where drawing_id = $1 and group_id = $2', [
        state.id,
        group.group_id,
      ]);
      throw new ApiError('undo_superseded', undoSkipMessage(superseded.user, superseded.handle));
    }
    const before = structuredClone(state.model);
    const revisionBefore = state.revision;
    state.revision = applyPatch(state.model, group.patch, 'before', username, state.revision);
    refreshDerived(state.model);
    group.undone = true;
    await query('update operation_groups set undone = true where drawing_id = $1 and group_id = $2', [
      state.id,
      group.group_id,
    ]);
    await persistModel(state);
    const patch = diffModel(before, state.model);
    const record = await recordGroup(
      state,
      {
        group_id: newId('grp'),
        username,
        command: group.command,
        base_revision: revisionBefore,
        revision_before: revisionBefore,
        revision_after: state.revision,
        patch,
        targets: group.targets,
        undone: false,
        dropped: false,
        inverse_of: group.group_id,
        at: now(),
      },
      [],
      [],
    );
    await broadcastGroup(state, record, [], []);
    return { revision: state.revision, command: group.command };
  });
}

export async function redo(state: DrawingState, username: string): Promise<{ revision: number; command: string }> {
  return withLock(state, async () => {
    const candidates = myGroups(state, username).filter((group) => group.undone);
    const group = candidates[candidates.length - 1];
    if (!group) throw new ApiError('nothing_to_redo', MESSAGES.nothingToRedo);
    const before = structuredClone(state.model);
    const revisionBefore = state.revision;
    state.revision = applyPatch(state.model, group.patch, 'after', username, state.revision);
    refreshDerived(state.model);
    group.undone = false;
    await query('update operation_groups set undone = false where drawing_id = $1 and group_id = $2', [
      state.id,
      group.group_id,
    ]);
    await persistModel(state);
    const patch = diffModel(before, state.model);
    const record = await recordGroup(
      state,
      {
        group_id: newId('grp'),
        username,
        command: group.command,
        base_revision: revisionBefore,
        revision_before: revisionBefore,
        revision_after: state.revision,
        patch,
        targets: group.targets,
        undone: false,
        dropped: false,
        inverse_of: group.group_id,
        at: now(),
      },
      [],
      [],
    );
    await broadcastGroup(state, record, [], []);
    return { revision: state.revision, command: group.command };
  });
}

export interface HistoryEntry {
  revision: number;
  username: string;
  command: string;
  at: string;
}

export function entityHistory(state: DrawingState, handle: string): HistoryEntry[] {
  return state.groups
    .filter((group) => group.patch.entities[handle] !== undefined)
    .map((group) => ({
      revision: group.revision_after,
      username: group.username,
      command: group.command,
      at: new Date(group.at).toISOString(),
    }))
    .reverse();
}

export function cachedDrawings(): DrawingState[] {
  return [...cache.values()];
}

export function forgetDrawing(id: string): void {
  cache.delete(id);
}
