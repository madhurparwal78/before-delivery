import type {
  Operation, OpResult, GroupResponse, OpStatus, RejectReason, RecoveredEntry, TopicNode, CrossLink, Boundary,
} from '../shared/types.js';
import { ApiError, NOTICES } from './errors.js';
import { transformThroughAll, applyEdit, type TitleEdit } from '../shared/title-merge.js';
import { normaliseTitle, ICON_NAMES, NAMED_COLOURS } from '../shared/outline.js';
import { wouldLoop } from '../shared/tasks.js';

/**
 * The operations engine: applies groups all-or-nothing under the
 * published conflict rules, records the log and builds responses.
 */

export interface StoreTopic {
  id: string;
  parent_id: string | null;
  rank: number;
  floating: boolean;
  x: number | null;
  y: number | null;
  title: string;
  note: string;
  icon: string | null;
  colour: string | null;
  shape: string | null;
  side_pin: string | null;
  task: Record<string, unknown> | null;
  locked_by: string | null;
  restricted: boolean;
  attachments: { id: string; sha256: string; bytes: number; type: 'png' | 'jpg'; state: string }[];
}

export interface StoreLink extends CrossLink {}
export interface StoreBoundary extends Boundary {}

export interface MapState {
  mapId: string;
  title: string;
  layout: 'map' | 'org' | 'list';
  theme: 'daylight' | 'paper' | 'dusk';
  revision: number;
  customColours: string[];
  topics: Map<string, StoreTopic>;
  links: Map<string, StoreLink>;
  boundaries: Map<string, StoreBoundary>;
  slides: string[];
}

export interface TitleFrameRecord {
  opId: string;
  edit: TitleEdit;
  author: string;
  revision: number;
}

export interface MoveRecord {
  topicId: string;
  author: string;
  revision: number;
}

export interface DeletedSnapshot {
  title: string;
  parent_id: string | null;
}

export interface ApplyContext {
  state: MapState;
  user: string;
  role: 'owner' | 'editor' | 'commenter' | 'viewer';
  baseRevision: number;
  currentRevision: number;
  titleFrames: Map<string, TitleFrameRecord[]>; // per topic, in server order
  moves: Map<string, MoveRecord>; // last move of each topic
  anchorMovers: Map<string, { user: string }>; // who last moved/deleted a sibling
  deletedAfterBase: Set<string>; // topics deleted after this group's base
  deletedSnapshots: Map<string, DeletedSnapshot>; // last-known shape of those topics
}

export interface GroupOutcome {
  status: OpStatus;
  results: OpResult[];
  notice: string | null;
  sentence: string | null;
  recovered: RecoveredEntry[];
  focusTopicId: string | null;
  layoutChanged: boolean;
  themeChanged: boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function validateOperation(op: Operation, state: MapState): void {
  if (!op || typeof op !== 'object') throw new ApiError('invalid', 'Invalid operation.');
  if (!ID_RE.test(op.op_id ?? '')) throw new ApiError('invalid', 'Invalid operation id.');
  const kind = op.kind;
  const needTopic = () => {
    if (!op.topic_id || typeof op.topic_id !== 'string') throw new ApiError('invalid', 'Missing topic id.');
  };
  switch (kind) {
    case 'add': {
      needTopic();
      if (!op.parent_id || typeof op.parent_id !== 'string') throw new ApiError('invalid', 'Missing parent id.');
      const title = normaliseTitle(op.title ?? '');
      if (title.length < 1 || [...title].length > 200) throw new ApiError('invalid', 'Invalid title.');
      break;
    }
    case 'add_floating': {
      needTopic();
      const title = normaliseTitle(op.title ?? '');
      if (title.length < 1 || [...title].length > 200) throw new ApiError('invalid', 'Invalid title.');
      if (typeof op.x !== 'number' || typeof op.y !== 'number') throw new ApiError('invalid', 'Invalid position.');
      break;
    }
    case 'title': {
      needTopic();
      if (typeof op.offset !== 'number' || typeof op.delete !== 'number' || op.delete < 0 || typeof op.insert !== 'string') {
        throw new ApiError('invalid', 'Invalid title edit.');
      }
      break;
    }
    case 'note': {
      needTopic();
      if (typeof op.text !== 'string' || [...op.text].length > 5000) throw new ApiError('invalid', 'Invalid note.');
      validateNoteLinks(op.text);
      break;
    }
    case 'move': {
      needTopic();
      if (!op.parent_id) throw new ApiError('invalid', 'Missing parent id.');
      break;
    }
    case 'float_move': {
      needTopic();
      if (typeof op.x !== 'number' || typeof op.y !== 'number') throw new ApiError('invalid', 'Invalid position.');
      break;
    }
    case 'delete': needTopic(); break;
    case 'task': {
      needTopic();
      if (op.task !== null && typeof op.task !== 'object') {
        const t = op.task as unknown as Record<string, unknown>;
        if ('percent' in t && (typeof t.percent !== 'number' || t.percent < 0 || t.percent > 100 || !Number.isInteger(t.percent))) throw new ApiError('invalid', 'Invalid percent.');
        if ('weight' in t && (typeof t.weight !== 'number' || t.weight < 0 || t.weight > 10 || !Number.isInteger(t.weight))) throw new ApiError('invalid', 'Invalid weight.');
        if ('priority' in t && t.priority !== 'low' && t.priority !== 'normal' && t.priority !== 'high') throw new ApiError('invalid', 'Invalid priority.');
        if ('state' in t && t.state !== 'open' && t.state !== 'cancelled') throw new ApiError('invalid', 'Invalid state.');
        if ('due' in t && t.due !== null && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(t.due))) throw new ApiError('invalid', 'Invalid due date.');
        if ('assignee' in t && t.assignee !== null && typeof t.assignee !== 'string') throw new ApiError('invalid', 'Invalid assignee.');
      }
      break;
    }
    case 'style': {
      needTopic();
      if ('colour' in op && op.colour !== null && op.colour !== undefined) {
        if (typeof op.colour !== 'string' || !(/^#[0-9a-f]{6}$/.test(op.colour) || NAMED_COLOURS.has(op.colour))) {
          throw new ApiError('invalid', 'Invalid colour.');
        }
      }
      if ('shape' in op && op.shape !== null && op.shape !== undefined) {
        if (!['pill', 'underline', 'filled', 'rounded'].includes(String(op.shape))) throw new ApiError('invalid', 'Invalid shape.');
      }
      if ('icon' in op && op.icon !== null && op.icon !== undefined) {
        if (!ICON_NAMES.has(String(op.icon))) throw new ApiError('invalid', 'Invalid icon.');
      }
      break;
    }
    case 'pin': {
      needTopic();
      if (op.side !== null && op.side !== undefined && op.side !== 'left' && op.side !== 'right') throw new ApiError('invalid', 'Invalid side.');
      break;
    }
    case 'link_add': {
      if (!ID_RE.test(op.link_id ?? '')) throw new ApiError('invalid', 'Invalid link id.');
      if (!op.from || !op.to) throw new ApiError('invalid', 'Missing link end.');
      if (op.type !== 'related' && op.type !== 'depends') throw new ApiError('invalid', 'Invalid link type.');
      if (op.label !== undefined && (typeof op.label !== 'string' || [...op.label].length > 40)) throw new ApiError('invalid', 'Invalid label.');
      break;
    }
    case 'link_remove': {
      if (!ID_RE.test(op.link_id ?? '')) throw new ApiError('invalid', 'Invalid link id.');
      break;
    }
    case 'boundary_add': {
      if (!ID_RE.test(op.boundary_id ?? '')) throw new ApiError('invalid', 'Invalid boundary id.');
      if (!op.topic_id) throw new ApiError('invalid', 'Missing topic id.');
      if (op.label !== undefined && (typeof op.label !== 'string' || [...op.label].length > 40)) throw new ApiError('invalid', 'Invalid label.');
      break;
    }
    case 'boundary_remove': {
      if (!ID_RE.test(op.boundary_id ?? '')) throw new ApiError('invalid', 'Invalid boundary id.');
      break;
    }
    case 'lock': case 'unlock': needTopic(); break;
    case 'restrict': {
      needTopic();
      if (typeof op.restricted !== 'boolean') throw new ApiError('invalid', 'Invalid restriction.');
      break;
    }
    case 'layout': {
      if (op.layout !== 'map' && op.layout !== 'org' && op.layout !== 'list') throw new ApiError('invalid', 'Invalid layout.');
      break;
    }
    case 'theme': {
      if (op.theme !== 'daylight' && op.theme !== 'paper' && op.theme !== 'dusk') throw new ApiError('invalid', 'Invalid theme.');
      break;
    }
    case 'slides': {
      if (!Array.isArray(op.order)) throw new ApiError('invalid', 'Invalid slides.');
      break;
    }
    case 'custom_colour': {
      if (typeof op.colour !== 'string' || !/^#[0-9a-f]{6}$/.test(op.colour)) throw new ApiError('invalid', 'Invalid custom colour.');
      break;
    }
    default:
      throw new ApiError('invalid', 'Unknown operation kind.');
  }
}

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

function validateNoteLinks(text: string): void {
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    const url = m[2];
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new ApiError('invalid', NOTICES.linkScheme);
    }
  }
}

export interface Touch {
  topicId: string;
  fields: 'title' | 'note' | 'task' | 'other';
  user: string;
  revision: number;
}

/** Records of who touched what, used for undo skipping and notices. */
export interface TouchLog {
  entries: Touch[];
}

export function topicVisibleForRole(t: StoreTopic, role: string): boolean {
  if (!t.restricted) return true;
  return role === 'owner' || role === 'editor';
}

export function descendantsOf(topics: Map<string, StoreTopic>, id: string): string[] {
  const byParent = new Map<string, string[]>();
  for (const t of topics.values()) {
    if (t.parent_id === null) continue;
    const arr = byParent.get(t.parent_id) ?? [];
    arr.push(t.id);
    byParent.set(t.parent_id, arr);
  }
  const out: string[] = [];
  const walk = (tid: string) => {
    for (const c of byParent.get(tid) ?? []) { out.push(c); walk(c); }
  };
  walk(id);
  return out;
}

export function ancestorsOf(topics: Map<string, StoreTopic>, id: string): string[] {
  const out: string[] = [];
  let cur = topics.get(id)?.parent_id ?? null;
  while (cur !== null) {
    out.push(cur);
    cur = topics.get(cur)?.parent_id ?? null;
  }
  return out;
}

export function siblingsOf(topics: Map<string, StoreTopic>, id: string): StoreTopic[] {
  const t = topics.get(id);
  if (!t) return [];
  const arr: StoreTopic[] = [];
  for (const x of topics.values()) if (x.parent_id === t.parent_id && x.id !== id) arr.push(x);
  arr.sort((a, b) => a.rank - b.rank);
  return arr;
}

/** Insert rank after a sibling, or renumber into position. */
export function rankAfter(state: MapState, parentId: string, after: string | null): number {
  const kids = [...state.topics.values()].filter((t) => t.parent_id === parentId).sort((a, b) => a.rank - b.rank);
  if (!after) {
    for (let i = 0; i < kids.length; i += 1) kids[i].rank = i;
    return kids.length;
  }
  const idx = kids.findIndex((k) => k.id === after);
  if (idx === -1) {
    for (let i = 0; i < kids.length; i += 1) kids[i].rank = i;
    return kids.length;
  }
  const out = kids[idx].rank + 1;
  for (let i = idx + 1; i < kids.length; i += 1) kids[i].rank += 1;
  return out;
}

export interface EngineDeps {
  checkLocks(ctx: ApplyContext, ops: Operation[]): string | null; // first locked topic id or null
  computeBlockedCounts(): void;
}

/**
 * Apply one operation group. Throws ApiError for refusals that happen
 * before application; returns a GroupOutcome for applied/rejected/
 * recovered groups.
 */
export function applyGroup(
  ctx: ApplyContext,
  groupId: string,
  ops: Operation[],
): GroupOutcome {
  const { state } = ctx;
  const results: OpResult[] = ops.map((o) => ({ op_id: o.op_id, status: 'applied', reason: null }));
  const recovered: RecoveredEntry[] = [];
  let layoutChanged = false;
  let themeChanged = false;
  let firstSentenceKind: string | null = null;
  let firstTopicId: string | null = null;
  const kindCounts = new Map<string, number>();

  // --- pre-pass: cycle check, locks, dependency loops ---
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (op.kind === 'move') {
      const moving = state.topics.get(op.topic_id!);
      if (!moving) throw new ApiError('not_found', NOTICES.unknownMap);
      if (descendantsOf(state.topics, moving.id).includes(op.parent_id!)) {
        // cycle: reject whole group
        return {
          status: 'rejected',
          results: ops.map((o, j) => ({ op_id: o.op_id, status: 'rejected' as const, reason: j === i ? 'cycle' as RejectReason : null })),
          notice: NOTICES.cycleRollback(moving.title),
          sentence: null,
          recovered: [],
          focusTopicId: moving.id,
          layoutChanged: false,
          themeChanged: false,
        };
      }
    }
    if (op.kind === 'link_add' && op.type === 'depends') {
      if (wouldLoop(op.from!, op.to!, (id) => ancestorsOf(state.topics, id))) {
        return {
          status: 'rejected',
          results: ops.map((o, j) => ({ op_id: o.op_id, status: 'rejected' as const, reason: j === i ? 'dependency_loop' as RejectReason : null })),
          notice: NOTICES.dependencyLoop,
          sentence: null,
          recovered: [],
          focusTopicId: op.from ?? null,
          layoutChanged: false,
          themeChanged: false,
        };
      }
    }
    if (op.kind === 'delete') {
      const target = state.topics.get(op.topic_id!);
      if (target && target.parent_id === null && !target.floating) {
        throw new ApiError('root_protected', NOTICES.rootDelete);
      }
    }
  }

  // --- delete versus edit detection ---
  let deletedReason: number | null = null;
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (op.kind === 'delete') continue;
    const inner = (op.topic_id && insideDeleted(ctx, op.topic_id, ops))
      || (op.parent_id && insideDeleted(ctx, op.parent_id, ops))
      || false;
    if (inner) { deletedReason = i; break; }
    if (op.kind === 'move' && op.parent_id && insideDeleted(ctx, op.parent_id, ops)) { deletedReason = i; break; }
  }

  // edits against topics deleted after this group's base
  for (let i = 0; i < ops.length && deletedReason === null; i += 1) {
    const op = ops[i];
    if (op.kind === 'delete') continue;
    const touched = op.topic_id ?? op.parent_id ?? null;
    if (touched && ctx.deletedAfterBase.has(touched) && insideDeletedSet(ctx, touched, ops)) {
      deletedReason = i;
      break;
    }
  }

  if (deletedReason !== null) {
    // Build recovered entries for title/note edits and child adds.
    for (const op of ops) {
      if (op.kind === 'title' && op.topic_id) {
        const t = state.topics.get(op.topic_id);
        const before = t ? t.title : '';
        const merged = transformThroughAll({ offset: op.offset!, delete: op.delete!, insert: op.insert! }, (ctx.titleFrames.get(op.topic_id) ?? []).filter((f) => f.revision >= ctx.baseRevision).map((f) => f.edit));
        const text = applyEdit(before, merged);
        const snap = ctx.deletedSnapshots.get(op.topic_id);
        recovered.push({ id: `r-${crypto.randomUUID()}`, text, kind: 'title', from_title: before || snap?.title || '', parent_id: t?.parent_id ?? snap?.parent_id ?? '' });
      } else if (op.kind === 'note' && op.topic_id) {
        const t = state.topics.get(op.topic_id);
        const snap = ctx.deletedSnapshots.get(op.topic_id);
        recovered.push({ id: `r-${crypto.randomUUID()}`, text: op.text ?? '', kind: 'note', from_title: t?.title ?? snap?.title ?? '', parent_id: t?.parent_id ?? snap?.parent_id ?? '' });
      } else if ((op.kind === 'add') && op.topic_id) {
        recovered.push({ id: `r-${crypto.randomUUID()}`, text: op.title ?? '', kind: 'add', from_title: state.topics.get(op.parent_id ?? '')?.title ?? '', parent_id: op.parent_id ?? '' });
      }
    }
    return {
      status: 'recovered',
      results: ops.map((o, j) => ({ op_id: o.op_id, status: 'recovered' as OpStatus, reason: j === deletedReason ? 'deleted' as RejectReason : null })),
      notice: null, // filled by caller with the deleter's name
      sentence: null,
      recovered,
      focusTopicId: null,
      layoutChanged: false,
      themeChanged: false,
    };
  }

  // --- apply ---
  let anyMerged = false;
  let anchorGone = false;
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    const r = results[i];
    switch (op.kind) {
      case 'add': {
        const t: StoreTopic = {
          id: op.topic_id!, parent_id: op.parent_id!, rank: 0, floating: false, x: null, y: null,
          title: normaliseTitle(op.title ?? ''), note: '', icon: null, colour: null, shape: null, side_pin: null,
          task: null, locked_by: null, restricted: false, attachments: [],
        };
        const after = op.after ?? null;
        const anchorExists = after === null || [...state.topics.values()].some((x) => x.parent_id === op.parent_id && x.id === after);
        t.rank = rankAfter(state, op.parent_id!, after);
        if (after !== null && !anchorExists) {
          r.status = 'applied';
          r.reason = 'anchor_gone';
          anchorGone = true;
        }
        state.topics.set(t.id, t);
        countKind('add');
        break;
      }
      case 'add_floating': {
        const t: StoreTopic = {
          id: op.topic_id!, parent_id: null, rank: state.topics.size, floating: true, x: op.x!, y: op.y!,
          title: normaliseTitle(op.title ?? ''), note: '', icon: null, colour: null, shape: null, side_pin: null,
          task: null, locked_by: null, restricted: false, attachments: [],
        };
        state.topics.set(t.id, t);
        countKind('add');
        break;
      }
      case 'title': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        const frames = (ctx.titleFrames.get(op.topic_id!) ?? []).filter((f) => f.revision >= ctx.baseRevision && f.opId !== op.op_id);
        const moved = transformThroughAll({ offset: op.offset!, delete: op.delete!, insert: op.insert! }, frames.map((f) => f.edit));
        const merged = frames.length > 0;
        const text = applyEdit(t.title, moved);
        const normalised = normaliseTitle(text);
        t.title = normalised === '' ? t.title : normalised;
        if (merged) { r.status = 'merged'; anyMerged = true; }
        ctx.titleFrames.set(op.topic_id!, [...(ctx.titleFrames.get(op.topic_id!) ?? []), { opId: op.op_id, edit: moved, author: ctx.user, revision: ctx.currentRevision + 1 }]);
        countKind('rename');
        break;
      }
      case 'note': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        t.note = op.text ?? '';
        countKind('note');
        break;
      }
      case 'move': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        const oldParent = t.parent_id;
        const after = op.after ?? null;
        const anchorExists = after === null || [...state.topics.values()].some((x) => x.parent_id === op.parent_id && x.id === after);
        if (oldParent !== op.parent_id) {
          t.parent_id = op.parent_id!;
          t.rank = rankAfter(state, op.parent_id!, after);
        } else {
          t.rank = rankAfter(state, op.parent_id!, after);
        }
        if (after !== null && !anchorExists) { r.reason = 'anchor_gone'; anchorGone = true; }
        ctx.moves.set(t.id, { topicId: t.id, author: ctx.user, revision: ctx.currentRevision + 1 });
        if (op.after) ctx.anchorMovers.set(op.after, { user: ctx.user });
        countKind('move');
        break;
      }
      case 'float_move': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        t.x = op.x!;
        t.y = op.y!;
        countKind('move');
        break;
      }
      case 'delete': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        const sub = descendantsOf(state.topics, t.id);
        for (const id of [t.id, ...sub]) {
          const target = state.topics.get(id);
          if (target) ctx.deletedSnapshots.set(id, { title: target.title, parent_id: target.parent_id });
          state.topics.delete(id);
          ctx.deletedAfterBase.add(id);
          for (const l of [...state.links.values()]) {
            if (l.from === id || l.to === id) state.links.delete(l.id);
          }
          for (const b of [...state.boundaries.values()]) if (b.topic_id === id) state.boundaries.delete(b.id);
        }
        state.slides = state.slides.filter((s) => !sub.includes(s) && s !== t.id);
        for (const sib of siblingsOf(state.topics, t.id)) {
          ctx.anchorMovers.set(sib.id, { user: ctx.user });
        }
        countKind('delete');
        break;
      }
      case 'task': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        if (op.task === null) t.task = null;
        else {
          const cur = (t.task ?? {}) as Record<string, unknown>;
          const patch = op.task as Record<string, unknown>;
          const next: Record<string, unknown> = { ...cur };
          if (!('percent' in cur) && !('percent' in patch)) next.percent = 0;
          if (!('weight' in cur) && !('weight' in patch)) next.weight = 1;
          if (!('state' in cur) && !('state' in patch)) next.state = 'open';
          if (!('priority' in cur) && !('priority' in patch)) next.priority = 'normal';
          if (!('due' in cur) && !('due' in patch)) next.due = null;
          if (!('assignee' in cur) && !('assignee' in patch)) next.assignee = null;
          for (const k of Object.keys(patch)) next[k] = patch[k];
          t.task = next;
        }
        countKind('task');
        break;
      }
      case 'style': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        if ('colour' in op) t.colour = op.colour ?? null;
        if ('shape' in op) t.shape = op.shape ?? null;
        if ('icon' in op) t.icon = op.icon ?? null;
        countKind('style');
        break;
      }
      case 'pin': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        t.side_pin = (op.side as 'left' | 'right' | null) ?? null;
        countKind('move');
        break;
      }
      case 'link_add': {
        const link: StoreLink = { id: op.link_id!, from: op.from!, to: op.to!, label: op.label ?? '', type: op.type! };
        state.links.set(link.id, link);
        countKind('link');
        break;
      }
      case 'link_remove': {
        state.links.delete(op.link_id!);
        countKind('link');
        break;
      }
      case 'boundary_add': {
        state.boundaries.set(op.boundary_id!, { id: op.boundary_id!, topic_id: op.topic_id!, label: op.label ?? '' });
        countKind('boundary');
        break;
      }
      case 'boundary_remove': {
        state.boundaries.delete(op.boundary_id!);
        countKind('boundary');
        break;
      }
      case 'lock': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        t.locked_by = ctx.user;
        countKind('lock');
        break;
      }
      case 'unlock': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        t.locked_by = null;
        countKind('lock');
        break;
      }
      case 'restrict': {
        const t = state.topics.get(op.topic_id!);
        if (!t) throw new ApiError('not_found', NOTICES.unknownMap);
        t.restricted = op.restricted!;
        countKind('restrict');
        break;
      }
      case 'layout': {
        state.layout = op.layout!;
        layoutChanged = true;
        countKind('layout');
        break;
      }
      case 'theme': {
        state.theme = op.theme!;
        themeChanged = true;
        countKind('theme');
        break;
      }
      case 'slides': {
        state.slides = op.order!;
        countKind('slides');
        break;
      }
      case 'custom_colour': {
        if (!state.customColours.includes(op.colour!)) {
          if (state.customColours.length >= 8) throw new ApiError('invalid', 'Too many custom colours.');
          state.customColours.push(op.colour!);
        }
        countKind('style');
        break;
      }
    }
  }

  const status: OpStatus = anyMerged ? 'merged' : 'applied';
  let notice: string | null = null;
  if (anchorGone) notice = NOTICES.orderChanged(ctx.user);

  const outcome: GroupOutcome = {
    status,
    results,
    notice,
    sentence: null, // built by the caller with author info
    recovered: [],
    focusTopicId: firstTopicId,
    layoutChanged,
    themeChanged,
  };
  return outcome;

  function countKind(k: string): void {
    kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
    if (firstSentenceKind === null) {
      firstSentenceKind = k;
      const op = ops.find((o) => o.kind === k);
      firstTopicId = op?.topic_id ?? op?.parent_id ?? null;
    }
  }
}

function insideDeleted(ctx: ApplyContext, topicId: string, ops: Operation[]): boolean {
  const deleted = new Set<string>();
  for (const op of ops) if (op.kind === 'delete' && op.topic_id) deleted.add(op.topic_id);
  if (deleted.has(topicId)) return true;
  return insideDeletedSet(ctx, topicId, ops);
}

function insideDeletedSet(ctx: ApplyContext, topicId: string, ops: Operation[]): boolean {
  // deleted within this group
  const deletedHere = new Set<string>();
  for (const op of ops) if (op.kind === 'delete' && op.topic_id) deletedHere.add(op.topic_id);
  if (deletedHere.has(topicId)) return true;
  // deleted by an earlier group after our base
  if (ctx.deletedAfterBase.has(topicId)) {
    let cur: string | null = topicId;
    while (cur !== null) {
      if (ctx.deletedAfterBase.has(cur)) return true;
      cur = ctx.state.topics.get(cur)?.parent_id ?? null;
      if (cur === null) break;
    }
    return true;
  }
  return false;
}

export function groupResponse(groupId: string, outcome: GroupOutcome, revision: number, replayed = false): GroupResponse {
  return {
    group_id: groupId,
    status: outcome.status,
    revision,
    replayed,
    results: outcome.results,
    notice: outcome.notice,
  };
}
