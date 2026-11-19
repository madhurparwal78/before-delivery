import type pg from 'pg';
import { applyOp, cloneDoc, isRefused } from '../shared/engine.ts';
import { ApiError } from '../shared/errors.ts';
import type {
  DocTopic,
  GroupStatus,
  LiveMessage,
  MapDoc,
  Op,
  OpReason,
  OpResult,
  OpsResponse,
  RecoveredEntry,
  Role,
} from '../shared/model.ts';
import {
  COPY,
  LIMITS,
  can,
  noticeCycle,
  noticeDeletedUnder,
  noticeLockedEdit,
  noticeLockedMove,
  noticeMovedAfter,
  noticeOrder,
} from '../shared/rules.ts';
import { describeOps } from '../shared/sentences.ts';
import { applyTitleEdit, normaliseTitle, transformTitleEdit, type TitleEdit } from '../shared/titleMerge.ts';
import { ancestorsOf, childrenOf, isRestricted, lockOf } from '../shared/tree.ts';
import { serverNow, toIso } from './clock.ts';
import { config, instanceId } from './config.ts';
import { query } from './db.ts';
import { deliver, notifyCommitted, transient, type Audience } from './hub.ts';
import type { Principal } from './http.ts';
import { randomId } from './ids.ts';
import { loadMap, type MapRow } from './mapStore.ts';

/** Work to do once the transaction has committed: live broadcasts. */
export class Effects {
  private readonly pending: (() => void)[] = [];

  add(effect: () => void): void {
    this.pending.push(effect);
  }

  run(): void {
    for (const effect of this.pending) effect();
  }
}

/** Store a live message under the map's next sequence number and queue its delivery. */
export async function emitEvent(
  client: pg.PoolClient,
  mapId: string,
  message: LiveMessage,
  audience: Audience,
  onlyId: string | null,
  fx: Effects,
): Promise<number> {
  const rows = await query<{ seq: number }>(client, 'UPDATE maps SET seq = seq + 1 WHERE id = $1 RETURNING seq', [mapId]);
  const seq = rows[0]?.seq ?? 0;
  await client.query('INSERT INTO events (map_id, seq, type, body, audience, only_id) VALUES ($1, $2, $3, $4, $5, $6)', [
    mapId,
    seq,
    message.type,
    JSON.stringify(message),
    audience,
    onlyId,
  ]);
  fx.add(() => deliver(mapId, seq, message, audience, onlyId));
  return seq;
}

export type Origin = 'edit' | 'undo' | 'redo' | 'restore' | 'graft' | 'paste' | 'reapply';

interface RemovedTopic {
  id: string;
  title: string;
  parent_id: string | null;
  ancestors: string[];
}

interface HistoryRow {
  revision: number;
  author_id: string;
  author: string;
  ops: Op[];
  removed: RemovedTopic[];
}

async function loadHistory(client: pg.PoolClient, mapId: string, base: number): Promise<HistoryRow[]> {
  return query<HistoryRow>(
    client,
    'SELECT revision, author_id, author, ops, removed FROM ops_log WHERE map_id = $1 AND revision > $2 ORDER BY revision',
    [mapId, base],
  );
}

interface RecoveredDraft {
  kind: RecoveredEntry['kind'];
  text: string;
  from_title: string;
  parent_id: string | null;
  chain: string[];
}

interface Resolution {
  status: GroupStatus;
  results: OpResult[];
  notice: string | null;
  doc: MapDoc;
  ops: Op[];
  inverse: Op[];
  touched: string[];
  focus: string | null;
  undoable: boolean;
  recovered: RecoveredDraft[];
  others: { to: string; text: string }[];
}

const topicRefs = (op: Op): string[] => {
  switch (op.kind) {
    case 'add':
      return [op.parent_id];
    case 'move':
      return [op.topic_id, op.parent_id];
    case 'link_add':
      return [op.from, op.to];
    case 'boundary_add':
    case 'title':
    case 'note':
    case 'delete':
    case 'task':
    case 'style':
    case 'pin':
    case 'lock':
    case 'unlock':
    case 'restrict':
    case 'float_move':
      return [op.topic_id];
    default:
      return [];
  }
};

/** Topics a lock can stop an operation from touching. */
const lockTouches = (op: Op, doc: MapDoc): string[] => {
  switch (op.kind) {
    case 'move':
      return [op.topic_id, op.parent_id];
    case 'add':
      return [op.parent_id];
    case 'link_add':
      return [op.from];
    case 'link_remove':
      return doc.links.filter((l) => l.id === op.link_id).map((l) => l.from);
    case 'boundary_remove':
      return doc.boundaries.filter((b) => b.id === op.boundary_id).map((b) => b.topic_id);
    case 'title':
    case 'note':
    case 'delete':
    case 'task':
    case 'style':
    case 'pin':
    case 'float_move':
    case 'boundary_add':
    case 'lock':
      return [op.topic_id];
    case 'put_branch': {
      const ids = new Set(op.branch.topics.map((t) => t.id));
      const parents = op.branch.topics.filter((t) => t.parent_id !== null && !ids.has(t.parent_id)).map((t) => t.parent_id as string);
      return [...ids].filter((id) => doc.topics[id]).concat(parents);
    }
    default:
      return [];
  }
};

function assertLocks(doc: MapDoc, ops: readonly Op[], who: { id: string; name: string }, role: Role): void {
  const isMove = ops.some((o) => o.kind === 'move');
  for (const op of ops) {
    if (op.kind === 'unlock') {
      const held = doc.topics[op.topic_id]?.locked_by;
      if (held && held !== who.name && !can(role, 'unlock_any')) throw new ApiError('forbidden', 'Only the person who locked a branch or the owner can unlock it.');
      continue;
    }
    if (can(role, 'unlock_any') && op.kind !== 'lock') continue;
    for (const id of lockTouches(op, doc)) {
      const lock = lockOf(doc.topics, id);
      if (!lock || lock.holder === who.name) continue;
      const title = doc.topics[id]?.title ?? '';
      const message = isMove ? noticeLockedMove(title) : noticeLockedEdit(title, lock.holder);
      throw new ApiError('branch_locked', message);
    }
  }
}

interface ResolveInput {
  doc: MapDoc;
  history: HistoryRow[];
  ops: Op[];
  who: { id: string; name: string };
  role: Role;
  roleHolders: ReadonlySet<string>;
}

const titleChain = (history: readonly HistoryRow[], topicId: string, authorId: string): TitleEdit[] =>
  history
    .filter((h) => h.author_id !== authorId)
    .flatMap((h) => h.ops)
    .filter((o): o is Extract<Op, { kind: 'title' }> => o.kind === 'title' && o.topic_id === topicId);

/** Decide a group against the current document: merge titles, place anchors, find conflicts. Never writes. */
function resolveGroup(input: ResolveInput): Resolution {
  const { doc, history, who, role } = input;
  assertLocks(doc, input.ops, who, role);
  const working = cloneDoc(doc);
  const removed = new Map<string, { row: RemovedTopic; by: string }>();
  for (const row of history) for (const topic of row.removed) removed.set(topic.id, { row: topic, by: row.author });
  const resolved: Op[] = [];
  const merged = new Set<number>();
  const causes = new Map<number, OpReason>();
  const phantom = new Set<string>();
  const drafts: RecoveredDraft[] = [];
  const inverse: Op[][] = [];
  const touched = new Set<string>();
  const others: { to: string; text: string }[] = [];
  let focus: string | null = null;
  let undoable = false;
  let deleter = '';
  let orderBy: string | null = null;
  let cycleTitle = '';

  for (let at = 0; at < input.ops.length; at += 1) {
    let op = input.ops[at] as Op;
    if (op.kind === 'task' && op.task && op.task.assignee && !input.roleHolders.has(op.task.assignee)) {
      throw new ApiError('invalid', 'Assignee must be someone with a role on the map.', { fields: { assignee: 'Assignee must be someone with a role on the map.' } });
    }
    if (op.kind === 'custom_colour' && !working.custom_colours.includes(op.colour) && working.custom_colours.length >= LIMITS.custom_colours) {
      throw new ApiError('invalid', 'A map keeps up to 8 custom colours.');
    }
    const missing = topicRefs(op).find((id) => !working.topics[id]);
    if (missing !== undefined) {
      const gone = removed.get(missing);
      if (phantom.has(missing)) continue;
      if (!gone) throw new ApiError('not_found', COPY.missing_topic);
      causes.set(at, 'deleted');
      deleter = gone.by;
      if (op.kind === 'add' || op.kind === 'add_floating') phantom.add(op.topic_id);
      if (op.kind === 'title') {
        const chain = titleChain(history, op.topic_id, who.id);
        const edit = chain.reduce<TitleEdit>((e, f) => transformTitleEdit(e, f), op);
        drafts.push({ kind: 'title', text: normaliseTitle(applyTitleEdit(gone.row.title, edit)), from_title: gone.row.title, parent_id: gone.row.parent_id, chain: gone.row.ancestors });
      } else if (op.kind === 'note') {
        drafts.push({ kind: 'note', text: op.text, from_title: gone.row.title, parent_id: gone.row.parent_id, chain: gone.row.ancestors });
      } else if (op.kind === 'add') {
        drafts.push({ kind: 'add', text: normaliseTitle(op.title), from_title: gone.row.title, parent_id: op.parent_id, chain: [op.parent_id, ...gone.row.ancestors] });
      }
      continue;
    }
    if (op.kind === 'title') {
      const chain = titleChain(history, op.topic_id, who.id);
      if (chain.length > 0) {
        const edit = chain.reduce<TitleEdit>((e, f) => transformTitleEdit(e, f), op);
        op = { ...op, offset: edit.offset, delete: edit.delete, insert: edit.insert };
        merged.add(at);
      }
    }
    if (op.kind === 'move') {
      const movedId = op.topic_id;
      for (const row of history) {
        if (row.author_id === who.id) continue;
        if (row.ops.some((o) => o.kind === 'move' && o.topic_id === movedId)) {
          const title = working.topics[movedId]?.title ?? '';
          const text = noticeMovedAfter(who.name, title);
          if (!others.some((n) => n.to === row.author_id && n.text === text)) others.push({ to: row.author_id, text });
        }
      }
    }
    const outcome = applyOp(working, op, who.name);
    if (isRefused(outcome)) {
      switch (outcome.refused) {
        case 'cycle':
          cycleTitle = op.kind === 'move' ? (working.topics[op.topic_id]?.title ?? '') : '';
          causes.set(at, 'cycle');
          break;
        case 'dependency_loop':
          causes.set(at, 'dependency_loop');
          break;
        case 'root_protected':
          throw new ApiError('root_protected', COPY.root_delete);
        case 'invalid_title':
          throw new ApiError('invalid', 'Titles are 1 to 200 characters.', { fields: { title: 'Titles are 1 to 200 characters.' } });
        default:
          if (op.kind === 'link_remove' || op.kind === 'boundary_remove') {
            resolved.push(op);
            continue;
          }
          throw new ApiError('not_found', COPY.missing_topic);
      }
      break;
    }
    if (outcome.anchorGone && (op.kind === 'add' || op.kind === 'move')) {
      const placed = op;
      const siblings = childrenOf(working.topics, placed.parent_id).filter((t) => t.id !== placed.topic_id);
      orderBy = anchorCulprit(history, placed.after, who.name);
      op = { ...placed, after: siblings[siblings.length - 1]?.id ?? null };
    }
    resolved.push(op);
    inverse.unshift(outcome.inverse);
    for (const id of outcome.touched) touched.add(id);
    focus = outcome.focus ?? focus;
    undoable = undoable || (outcome.undoable && outcome.inverse.length > 0);
  }

  const reasons = [...causes.values()];
  const rejected = reasons.some((r) => r === 'cycle' || r === 'dependency_loop');
  const recovered = !rejected && reasons.includes('deleted');
  const status: GroupStatus = rejected ? 'rejected' : recovered ? 'recovered' : merged.size > 0 ? 'merged' : 'applied';
  const results: OpResult[] = input.ops.map((op, at) => {
    if (rejected || recovered) return { op_id: op.op_id, status: rejected ? 'rejected' : 'recovered', reason: causes.get(at) ?? null };
    const anchored = resolvedAnchor(op, resolved[at]);
    return { op_id: op.op_id, status: merged.has(at) ? 'merged' : 'applied', reason: anchored ? 'anchor_gone' : null };
  });
  let notice: string | null = null;
  if (rejected) notice = reasons.includes('cycle') ? noticeCycle(cycleTitle) : COPY.dependency_loop;
  else if (recovered) notice = noticeDeletedUnder(deleter);
  else if (orderBy !== null) notice = noticeOrder(orderBy);
  return {
    status,
    results,
    notice,
    doc: working,
    ops: resolved,
    inverse: inverse.flat(),
    touched: [...touched],
    focus,
    undoable,
    recovered: recovered ? drafts : [],
    others: rejected || recovered ? [] : others,
  };
}

const resolvedAnchor = (original: Op, resolved: Op | undefined): boolean =>
  (original.kind === 'add' || original.kind === 'move') && resolved !== undefined && (resolved.kind === 'add' || resolved.kind === 'move') && resolved.after !== original.after;

function anchorCulprit(history: readonly HistoryRow[], anchor: string | null, fallback: string): string {
  for (let at = history.length - 1; at >= 0; at -= 1) {
    const row = history[at] as HistoryRow;
    if (row.removed.some((t) => t.id === anchor) || row.ops.some((o) => o.kind === 'move' && o.topic_id === anchor)) return row.author;
  }
  const last = [...history].reverse().find((h) => h.author !== fallback);
  return last?.author ?? fallback;
}

const referencedTopics = (op: Op): string[] => [...topicRefs(op), ...(op.kind === 'put_branch' ? op.branch.topics.map((t) => t.id) : []), ...(op.kind === 'add' ? [op.topic_id] : [])];

/** True when a group touches a restricted branch before or after it applied. */
function touchesRestricted(before: MapDoc, after: MapDoc, ops: readonly Op[]): boolean {
  return ops.some(
    (op) => op.kind === 'restrict' || referencedTopics(op).some((id) => isRestricted(before.topics, id) || isRestricted(after.topics, id)),
  );
}

interface CommitArgs {
  client: pg.PoolClient;
  map: MapRow;
  principal: Principal;
  role: Role;
  groupId: string;
  base: number;
  ops: Op[];
  origin: Origin;
  fx: Effects;
  sentence?: string;
  /** Names holding a role on the map, for assignee checks. */
  roleHolders: ReadonlySet<string>;
}

interface CommitResult {
  response: OpsResponse;
  resolution: Resolution;
  doc: MapDoc;
}

function removedTopics(before: MapDoc, after: MapDoc): RemovedTopic[] {
  const gone = Object.values(before.topics).filter((t) => !after.topics[t.id]);
  if (gone.length === 0) return [];
  const goneIds = new Set(gone.map((t) => t.id));
  return gone.map((t) => {
    let root: DocTopic = t;
    while (root.parent_id !== null && goneIds.has(root.parent_id) && before.topics[root.parent_id]) root = before.topics[root.parent_id] as DocTopic;
    return { id: t.id, title: t.title, parent_id: t.parent_id, ancestors: ancestorsOf(before.topics, root.id).map((a) => a.id) };
  });
}

/** Resolve a group and, when it applies, write the new revision, history, undo entry and live message. */
export async function commitGroup(args: CommitArgs): Promise<CommitResult> {
  const { client, principal, role, fx } = args;
  const map = (await loadMap(client, args.map.id, true)) as MapRow;
  const base = Math.min(args.base, map.revision);
  const history = args.origin === 'edit' ? await loadHistory(client, map.id, base) : [];
  const who = { id: principal.id, name: principal.name };
  const resolution = resolveGroup({ doc: map.doc, history, ops: args.ops, who, role, roleHolders: args.roleHolders });
  const applied = resolution.status === 'applied' || resolution.status === 'merged';
  const revision = applied ? map.revision + 1 : map.revision;
  const response: OpsResponse = {
    group_id: args.groupId,
    status: resolution.status,
    revision,
    replayed: false,
    results: resolution.results,
    notice: resolution.notice,
  };
  await client.query('INSERT INTO op_groups (map_id, group_id, author_id, response) VALUES ($1, $2, $3, $4)', [map.id, args.groupId, who.id, JSON.stringify(response)]);
  for (const op of args.ops) {
    await client.query('INSERT INTO op_ids (map_id, op_id, group_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [map.id, op.op_id, args.groupId]);
  }
  const now = toIso(serverNow());
  if (!applied) {
    if (resolution.recovered.length > 0) await storeRecovered(client, map.id, who.id, resolution.recovered, fx);
    for (const note of resolution.others) fx.add(() => transient(map.id, { type: 'notice', text: note.text }, note.to));
    return { response, resolution, doc: map.doc };
  }
  const described = describeOps(who.name, resolution.ops, map.doc, resolution.doc);
  const sentence = args.sentence ?? ({ undo: `${who.name} undid a change to ${titleFor(resolution, map.doc)}`, redo: `${who.name} redid a change to ${titleFor(resolution, map.doc)}` } as Record<string, string>)[args.origin] ?? described.sentence;
  const restricted = touchesRestricted(map.doc, resolution.doc, resolution.ops);
  const removed = removedTopics(map.doc, resolution.doc);
  await client.query('UPDATE maps SET doc = $2, revision = $3, updated_at = $4, home = $5 WHERE id = $1', [map.id, JSON.stringify(resolution.doc), revision, now, instanceId]);
  await client.query(
    `INSERT INTO ops_log (map_id, revision, group_id, author_id, author, base_revision, origin, ops, sentence, topic_id, restricted, removed, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [map.id, revision, args.groupId, who.id, who.name, base, args.origin, JSON.stringify(resolution.ops), sentence, described.topic_id ?? resolution.focus, restricted, JSON.stringify(removed), now],
  );
  await pushUndo(client, map.id, who.id, args.origin, args.groupId, revision, resolution);
  const message: LiveMessage = {
    type: 'op',
    group_id: args.groupId,
    user: who.name,
    revision,
    ops: resolution.ops,
    sentence,
    focus_topic_id: resolution.focus,
  };
  await emitEvent(client, map.id, message, restricted ? 'resync' : 'all', null, fx);
  fx.add(() => notifyCommitted(map.id));
  for (const note of resolution.others) fx.add(() => transient(map.id, { type: 'notice', text: note.text }, note.to));
  return { response, resolution, doc: resolution.doc };
}

function titleFor(resolution: Resolution, before: MapDoc): string {
  const id = resolution.focus ?? resolution.touched[0] ?? '';
  return resolution.doc.topics[id]?.title ?? before.topics[id]?.title ?? '';
}

async function storeRecovered(client: pg.PoolClient, mapId: string, userId: string, drafts: RecoveredDraft[], fx: Effects): Promise<void> {
  const now = toIso(serverNow());
  for (const draft of drafts) {
    await client.query(
      'INSERT INTO recovered (id, map_id, user_id, kind, text, from_title, parent_id, chain, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [randomId(), mapId, userId, draft.kind, draft.text, draft.from_title, draft.parent_id, JSON.stringify(draft.chain), now],
    );
  }
  const entries = await query<RecoveredEntry>(
    client,
    'SELECT id, text, kind, from_title, parent_id FROM recovered WHERE map_id = $1 AND user_id = $2 ORDER BY created_at, id',
    [mapId, userId],
  );
  await emitEvent(client, mapId, { type: 'recovered', entries }, 'user', userId, fx);
}

async function pushUndo(
  client: pg.PoolClient,
  mapId: string,
  userId: string,
  origin: Origin,
  groupId: string,
  revision: number,
  resolution: Resolution,
): Promise<void> {
  if (!resolution.undoable || resolution.inverse.length === 0) return;
  const kind = origin === 'undo' ? 'redo' : 'undo';
  if (origin !== 'undo' && origin !== 'redo') await client.query("DELETE FROM undo_stack WHERE map_id = $1 AND user_id = $2 AND kind = 'redo'", [mapId, userId]);
  const entry = { group_id: groupId, revision, inverse: resolution.inverse, touched: resolution.touched, focus: resolution.focus };
  await client.query('INSERT INTO undo_stack (map_id, user_id, kind, entry) VALUES ($1, $2, $3, $4)', [mapId, userId, kind, JSON.stringify(entry)]);
  await client.query(
    `DELETE FROM undo_stack WHERE id IN (
       SELECT id FROM undo_stack WHERE map_id = $1 AND user_id = $2 AND kind = $3 ORDER BY id DESC OFFSET $4)`,
    [mapId, userId, kind, config.undoDepth],
  );
}
