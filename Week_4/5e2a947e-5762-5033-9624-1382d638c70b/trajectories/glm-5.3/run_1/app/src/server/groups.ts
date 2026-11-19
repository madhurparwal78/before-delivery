import { randomUUID, randomBytes } from 'node:crypto';
import type { Db } from './db.js';
import type { Services } from './services.js';
import type {
  Operation, GroupResponse, RecoveredEntry, Role, TopicNode, CrossLink, Boundary, MapPayload, MapMeta, Derived, VersionInfo,
} from '../shared/types.js';
import { publicSettings } from '../shared/settings.js';
import { ApiError, NOTICES } from './errors.js';
import { applyGroup, type MapState, type StoreTopic, descendantsOf, ancestorsOf } from './engine.js';
import { loadMapState, saveMapState } from './context.js';
import { buildSentence } from './sentences.js';
import { computeRollups, computeBlocked } from '../shared/tasks.js';
import { nowIso, now } from './clock.js';
import type { PoolClient } from 'pg';

/**
 * The group pipeline: validation → locks → apply → persist → log →
 * undo stack → activity → broadcast. Shared by /api/maps/:id/ops,
 * the grading ops route, undo/redo, restore, graft, paste and reapply.
 */

export const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export interface ApplyGroupInput {
  svc: Services;
  mapId: string;
  user: string;
  role: Role;
  groupId: string;
  baseRevision: number;
  ops: Operation[];
  /** extra context for the sentence builder */
  sentenceKind?: string;
  sentenceExtra?: { oldTitle?: string; otherTitle?: string; versionNumber?: number; count?: number };
  /** skip lock check (owner undoing a group that touched locked topics) */
  skipLocks?: boolean;
  persistToLog?: boolean;
}

export interface ApplyGroupOutput {
  response: GroupResponse;
  sentence: string | null;
  topicId: string | null;
  newRevision: number;
}

/** Load title frames and deletion history needed for conflict rules. */
async function loadContext(svc: Services, mapId: string, state: MapState, user: string, baseRevision: number, currentRevision: number) {
  const frames = new Map<string, { opId: string; edit: { offset: number; delete: number; insert: string }; author: string; revision: number }[]>();
  interface LoggedOp { op_id: string; kind: string; topic_id?: string | null; parent_id?: string | null; after?: string | null; offset?: number; delete?: number; insert?: string; title?: string }
  const log = await svc.db.query<{ ops: LoggedOp[]; author: string; revision: string; results: { status: string }[] }>(
    `SELECT ops, author, revision, results FROM op_log WHERE map_id = $1 ORDER BY seq`,
    [mapId],
  );
  const deletedAfterBase = new Set<string>();
  const deletedSnapshots = new Map<string, { title: string; parent_id: string | null }>();
  const moves = new Map<string, { topicId: string; author: string; revision: number }>();
  const anchorMovers = new Map<string, { user: string }>();
  for (const row of log.rows) {
    const applied = row.results.every((r) => r.status !== 'rejected' && r.status !== 'recovered');
    if (!applied) continue;
    for (const op of row.ops) {
      if (op.kind === 'title' && op.topic_id && Number(row.revision) > baseRevision) {
        const arr = frames.get(op.topic_id) ?? [];
        arr.push({ opId: op.op_id, edit: { offset: op.offset ?? 0, delete: op.delete ?? 0, insert: op.insert ?? '' }, author: row.author, revision: Number(row.revision) });
        frames.set(op.topic_id, arr);
      }
      if (op.kind === 'add' && op.topic_id && deletedSnapshots.has(op.topic_id)) {
        deletedSnapshots.set(op.topic_id, { title: op.title ?? '', parent_id: op.parent_id ?? null });
      }
      if (op.kind === 'delete' && op.topic_id) {
        // The current state no longer holds the deleted topic; rebuild
        // its last-known title and parent from the operations that
        // created and moved it in the same log window.
        const rebuild = (id: string): { title: string; parent_id: string | null } => {
          for (let i = log.rows.length - 1; i >= 0; i -= 1) {
            const rowOps = log.rows[i].ops;
            for (let j = rowOps.length - 1; j >= 0; j -= 1) {
              const o = rowOps[j];
              if (o.topic_id === id && (o.kind === 'add' || o.kind === 'add_floating')) {
                return { title: o.title ?? '', parent_id: o.parent_id ?? null };
              }
            }
          }
          return deletedSnapshots.get(id) ?? { title: '', parent_id: null };
        };
        deletedSnapshots.set(op.topic_id, rebuild(op.topic_id));
        const sub = descendantsOf(state.topics, op.topic_id);
        for (const id of [op.topic_id, ...sub]) {
          if (Number(row.revision) > baseRevision) deletedAfterBase.add(id);
          if (id !== op.topic_id) deletedSnapshots.set(id, rebuild(id));
        }
        anchorMovers.set(op.topic_id, { user: row.author });
      }
      if ((op.kind === 'move') && op.topic_id) {
        moves.set(op.topic_id, { topicId: op.topic_id, author: row.author, revision: Number(row.revision) });
        if (op.after) anchorMovers.set(op.after, { user: row.author });
      }
    }
  }
  return {
    state, user, role: 'editor' as const, baseRevision, currentRevision,
    titleFrames: frames, moves, anchorMovers, deletedAfterBase, deletedSnapshots,
  };
}

export async function applyGroupPipeline(input: ApplyGroupInput): Promise<ApplyGroupOutput> {
  const { svc, mapId, user, role } = input;
  if (input.ops.length < 1 || input.ops.length > 500) throw new ApiError('invalid', 'A group holds 1 to 500 operations.');
  const loaded = await loadMapState(svc.db, mapId);
  const state = loaded.state;
  const currentRevision = state.revision;

  // stale base
  if (input.baseRevision < currentRevision - svc.settings.op_window) {
    throw new ApiError('stale_base', 'The base revision is too old.');
  }

  // operation id replay
  const seenIds: { op_id: string; group_id: string; response: GroupResponse }[] = [];
  for (const op of input.ops) {
    if (!ID_RE.test(op.op_id ?? '')) throw new ApiError('invalid', 'Invalid operation id.');
    const hit = await svc.db.one<{ group_id: string; response: GroupResponse }>(
      'SELECT group_id, response FROM op_ids WHERE map_id = $1 AND op_id = $2',
      [mapId, op.op_id],
    );
    if (hit) seenIds.push({ op_id: op.op_id, group_id: hit.group_id, response: hit.response });
  }
  if (seenIds.length === input.ops.length) {
    return {
      response: { ...seenIds[0].response, replayed: true },
      sentence: null,
      topicId: null,
      newRevision: currentRevision,
    };
  }
  if (seenIds.length > 0) {
    throw new ApiError('op_id_reused', 'A group cannot mix seen and new operation ids.');
  }

  // root protection and shape validation before anything else
  const earlierAdds = new Map<string, { title: string }>();
  for (const op of input.ops) {
    if (op.kind === 'delete' && op.topic_id) {
      const t = state.topics.get(op.topic_id);
      if (t && t.parent_id === null && !t.floating) throw new ApiError('root_protected', NOTICES.rootDelete);
    }
    validateShape(op, state, earlierAdds);
  }

  // locks: a group touching a locked topic is refused whole
  if (!input.skipLocks && (role === 'editor' || role === 'commenter' || role === 'viewer')) {
    for (const op of input.ops) {
      const touched = collectTouched(state, op);
      for (const id of touched) {
        const t = state.topics.get(id);
        if (t && isLockedFor(t, user, role)) {
          const isMoveGroup = input.ops.some((o) => o.kind === 'move');
          if (isMoveGroup) throw new ApiError('branch_locked', NOTICES.lockedMove(t.title));
          throw new ApiError('branch_locked', NOTICES.lockedEdit(t.title, t.locked_by ?? ''));
        }
      }
    }
  }

  const ctx = await loadContext(svc, mapId, state, user, input.baseRevision, currentRevision);
  const before = cloneState(state);
  const outcome = applyGroup(ctx, input.groupId, input.ops);

  let response: GroupResponse;
  let sentence: string | null = null;
  const newRevision = outcome.status === 'applied' || outcome.status === 'merged' ? currentRevision + 1 : currentRevision;

  if (outcome.status === 'rejected' || outcome.status === 'recovered') {
    response = {
      group_id: input.groupId,
      status: outcome.status,
      revision: currentRevision,
      replayed: false,
      results: outcome.results,
      notice: outcome.notice,
    };
  } else {
    state.revision = newRevision;
    sentence = buildSentence({
      user, ops: input.ops, before, after: state,
      kind: input.sentenceKind, extra: input.sentenceExtra,
    });
    response = {
      group_id: input.groupId,
      status: outcome.status,
      revision: newRevision,
      replayed: false,
      results: outcome.results,
      notice: outcome.notice,
    };
    await svc.db.transaction(async (c) => {
      await saveMapState(c, state, { revision: newRevision });
      await c.query(
        `INSERT INTO op_log (map_id, group_id, author, base_revision, ops, revision, results, notice, sentence, topic_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [mapId, input.groupId, user, input.baseRevision, JSON.stringify(input.ops), newRevision,
          JSON.stringify(outcome.results), outcome.notice, sentence, outcome.focusTopicId ?? null, nowIso()],
      );
      for (const op of input.ops) {
        await c.query('INSERT INTO op_ids (map_id, op_id, group_id, response, created_at) VALUES ($1,$2,$3,$4,$5)', [
          mapId, op.op_id, input.groupId, JSON.stringify(response), nowIso(),
        ]);
      }
      if (sentence) {
        const tid = outcome.focusTopicId ?? input.ops[0]?.topic_id ?? null;
        await c.query('INSERT INTO activity (map_id, "user", sentence, topic_id, created_at) VALUES ($1,$2,$3,$4,$5)', [
          mapId, user, sentence, tid, nowIso(),
        ]);
      }
    });
  }

  // record op ids for rejected/recovered too, so resends return the stored response
  if (outcome.status === 'rejected' || outcome.status === 'recovered') {
    for (const op of input.ops) {
      await svc.db.query(
        'INSERT INTO op_ids (map_id, op_id, group_id, response, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [mapId, op.op_id, input.groupId, JSON.stringify(response), nowIso()],
      );
    }
  }

  // recovered entries
  if (outcome.recovered.length > 0) {
    for (const entry of outcome.recovered) {
      await svc.db.query(
        'INSERT INTO recovered (id, map_id, username, text, kind, from_title, parent_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [entry.id, mapId, user, entry.text, entry.kind, entry.from_title, entry.parent_id],
      );
    }
  }

  return { response, sentence, topicId: outcome.focusTopicId, newRevision };
}

function cloneState(s: MapState): MapState {
  return {
    ...s,
    topics: new Map([...s.topics.entries()].map(([k, v]) => [k, { ...v, attachments: [...v.attachments] }])),
    links: new Map([...s.links.entries()].map(([k, v]) => [k, { ...v }])),
    boundaries: new Map([...s.boundaries.entries()].map(([k, v]) => [k, { ...v }])),
    slides: [...s.slides],
    customColours: [...s.customColours],
  };
}

export function isLockedFor(t: StoreTopic, user: string, role: Role): boolean {
  if (role === 'owner') return false;
  if (t.locked_by === null) return false;
  return t.locked_by !== user;
}

export function collectTouched(state: MapState, op: Operation): string[] {
  const ids = new Set<string>();
  const addWithAncestors = (id: string | null | undefined) => {
    if (!id) return;
    let cur: string | null = id;
    while (cur) {
      const t = state.topics.get(cur);
      if (!t) break;
      if (t.locked_by !== null) ids.add(cur);
      cur = t.parent_id;
    }
  };
  switch (op.kind) {
    case 'move': {
      addWithAncestors(op.topic_id);
      addWithAncestors(op.parent_id);
      break;
    }
    case 'add': {
      addWithAncestors(op.parent_id);
      break;
    }
    case 'link_add': {
      addWithAncestors(op.from);
      addWithAncestors(op.to);
      break;
    }
    case 'boundary_add': {
      addWithAncestors(op.topic_id);
      break;
    }
    default: {
      addWithAncestors(op.topic_id);
      const t = op.topic_id ? state.topics.get(op.topic_id) : undefined;
      if (t) for (const d of descendantsOf(state.topics, t.id)) addWithAncestors(d);
    }
  }
  return [...ids];
}

function validateShape(op: Operation, state: MapState, earlierAdds: Map<string, { title: string }> = new Map()): void {
  const need = (b: boolean, msg: string) => { if (!b) throw new ApiError('invalid', msg); };
  const title = (t: string | undefined) => {
    const norm = (t ?? '').replace(/\s+/g, ' ').trim();
    need(norm.length >= 1 && [...norm].length <= 200, 'Invalid title.');
    return norm;
  };
  switch (op.kind) {
    case 'add': {
      need(!!op.topic_id && ID_RE.test(op.topic_id), 'Invalid topic id.');
      need(!!op.parent_id, 'Missing parent.');
      // A parent earlier in the same group is legal: grafts build trees.
      const p = state.topics.get(op.parent_id!) ?? earlierAdds.get(op.parent_id!);
      need(!!p, 'Unknown parent topic.');
      title(op.title);
      earlierAdds.set(op.topic_id!, { title: op.title ?? '' });
      break;
    }
    case 'add_floating': {
      need(!!op.topic_id && ID_RE.test(op.topic_id), 'Invalid topic id.');
      need(typeof op.x === 'number' && typeof op.y === 'number', 'Invalid position.');
      title(op.title);
      break;
    }
    case 'title': {
      need(!!op.topic_id, 'Missing topic.');
      need(typeof op.offset === 'number' && op.offset >= 0, 'Invalid offset.');
      need(typeof op.delete === 'number' && op.delete >= 0, 'Invalid delete count.');
      need(typeof op.insert === 'string', 'Invalid insert text.');
      const after = applyLen(state.topics.get(op.topic_id!)?.title ?? '', op.offset!, op.delete!, op.insert!);
      need([...after.replace(/\s+/g, ' ').trim()].length >= 1 && [...after.replace(/\s+/g, ' ').trim()].length <= 200, 'Invalid title.');
      break;
    }
    case 'note': {
      need(!!op.topic_id, 'Missing topic.');
      need(typeof op.text === 'string' && [...op.text].length <= 5000, 'Invalid note.');
      break;
    }
    case 'move': {
      need(!!op.topic_id, 'Missing topic.');
      need(!!op.parent_id, 'Missing parent.');
      const p = state.topics.get(op.parent_id!);
      need(!!p, 'Unknown parent topic.');
      const t = state.topics.get(op.topic_id!);
      need(!!t, 'Unknown topic.');
      break;
    }
    case 'float_move': {
      need(!!op.topic_id, 'Missing topic.');
      need(typeof op.x === 'number' && typeof op.y === 'number', 'Invalid position.');
      break;
    }
    case 'delete': need(!!op.topic_id, 'Missing topic.'); break;
    case 'task': {
      need(!!op.topic_id, 'Missing topic.');
      if (op.task !== null) {
        need(typeof op.task === 'object', 'Invalid task.');
        const t = op.task as Record<string, unknown>;
        if ('percent' in t) need(typeof t.percent === 'number' && Number.isInteger(t.percent) && t.percent >= 0 && t.percent <= 100, 'Invalid percent.');
        if ('weight' in t) need(typeof t.weight === 'number' && Number.isInteger(t.weight) && t.weight >= 0 && t.weight <= 10, 'Invalid weight.');
        if ('priority' in t) need(['low', 'normal', 'high'].includes(String(t.priority)), 'Invalid priority.');
        if ('state' in t) need(['open', 'cancelled'].includes(String(t.state)), 'Invalid state.');
        if ('due' in t && t.due !== null) need(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(t.due)), 'Invalid due date.');
        if ('assignee' in t && t.assignee !== null) need(typeof t.assignee === 'string', 'Invalid assignee.');
      }
      break;
    }
    case 'style': {
      need(!!op.topic_id, 'Missing topic.');
      if (op.colour !== null && op.colour !== undefined) {
        need(typeof op.colour === 'string' && (/^#[0-9a-f]{6}$/.test(op.colour) || NAMED_COLOUR_SET.has(op.colour)), 'Invalid colour.');
      }
      if (op.shape !== null && op.shape !== undefined) need(['pill', 'underline', 'filled', 'rounded'].includes(String(op.shape)), 'Invalid shape.');
      if (op.icon !== null && op.icon !== undefined) need(typeof op.icon === 'string' && ICON_SET.has(op.icon), 'Invalid icon.');
      break;
    }
    case 'pin': {
      need(!!op.topic_id, 'Missing topic.');
      need(op.side === null || op.side === undefined || op.side === 'left' || op.side === 'right', 'Invalid side.');
      break;
    }
    case 'link_add': {
      need(!!op.link_id && ID_RE.test(op.link_id), 'Invalid link id.');
      need(!!op.from && !!op.to, 'Missing link end.');
      need((state.topics.has(op.from!) || earlierAdds.has(op.from!)) && (state.topics.has(op.to!) || earlierAdds.has(op.to!)), 'Unknown link end.');
      need(op.type === 'related' || op.type === 'depends', 'Invalid link type.');
      need(op.label === undefined || (typeof op.label === 'string' && [...op.label].length <= 40), 'Invalid label.');
      break;
    }
    case 'link_remove': need(!!op.link_id && ID_RE.test(op.link_id), 'Invalid link id.'); break;
    case 'boundary_add': {
      need(!!op.boundary_id && ID_RE.test(op.boundary_id), 'Invalid boundary id.');
      need(!!op.topic_id && (state.topics.has(op.topic_id) || earlierAdds.has(op.topic_id)), 'Unknown topic.');
      need(op.label === undefined || (typeof op.label === 'string' && [...op.label].length <= 40), 'Invalid label.');
      break;
    }
    case 'boundary_remove': need(!!op.boundary_id && ID_RE.test(op.boundary_id), 'Invalid boundary id.'); break;
    case 'lock': case 'unlock': need(!!op.topic_id && state.topics.has(op.topic_id), 'Unknown topic.'); break;
    case 'restrict': {
      need(!!op.topic_id && (state.topics.has(op.topic_id) || earlierAdds.has(op.topic_id)), 'Unknown topic.');
      need(typeof op.restricted === 'boolean', 'Invalid restriction.');
      break;
    }
    case 'layout': need(op.layout === 'map' || op.layout === 'org' || op.layout === 'list', 'Invalid layout.'); break;
    case 'theme': need(op.theme === 'daylight' || op.theme === 'paper' || op.theme === 'dusk', 'Invalid theme.'); break;
    case 'slides': need(Array.isArray(op.order) && op.order.every((s) => typeof s === 'string'), 'Invalid slides.'); break;
    case 'custom_colour': {
      need(typeof op.colour === 'string' && /^#[0-9a-f]{6}$/.test(op.colour), 'Invalid custom colour.');
      const cur = state.customColours;
      if (typeof op.colour === 'string' && !cur.includes(op.colour)) need(cur.length < 8, 'Too many custom colours.');
      break;
    }
  }
}

const NAMED_COLOUR_SET = new Set(['indigo', 'azure', 'teal', 'green', 'violet', 'magenta', 'orange', 'ochre', 'accent']);
const ICON_SET = new Set([
  'star', 'flag', 'bulb', 'check', 'cross', 'question', 'clock', 'calendar',
  'pin', 'home', 'book', 'pencil', 'music', 'coin', 'cart', 'truck',
  'people', 'heart', 'warning', 'leaf', 'camera', 'phone', 'key', 'gift',
]);

function applyLen(title: string, offset: number, deleteCount: number, insert: string): string {
  const chars = [...title];
  chars.splice(Math.min(offset, chars.length), deleteCount, ...[...insert]);
  return chars.join('');
}

export { randomUUID, randomBytes };
