import { copy, LAYOUT_LABEL, sentence, THEME_LABEL } from './copy.js';
import { wouldLoop } from './derive.js';
import { ApiError, firstError } from './errors.js';
import { nextFloatingSpot } from './layout.js';
import { can, canUnlock } from './permissions.js';
import { isCustomColour } from './style.js';
import { applyTitleEdit, rebaseTitleEdit, type TitleEdit } from './titlemerge.js';
import { branchIds, hiddenSet, isAncestor, lockInfo, type MapView } from './tree.js';
import {
  BRANCH_COLOURS,
  ICON_NAMES,
  type BranchSnapshot,
  type LayoutMode,
  type MapDoc,
  type Operation,
  type OperationGroup,
  type OperationKind,
  type OpReason,
  type OpResult,
  type OpStatus,
  type RecoveredEntry,
  type Role,
  type ShapeName,
  type StoredTopic,
  type Task,
  type ThemeName,
  type TouchRecord,
} from './types.js';

export const PUBLIC_KINDS: readonly OperationKind[] = [
  'add', 'add_floating', 'title', 'note', 'move', 'float_move', 'delete', 'task', 'style',
  'pin', 'link_add', 'link_remove', 'boundary_add', 'boundary_remove', 'lock', 'unlock',
  'restrict', 'layout', 'theme', 'slides', 'custom_colour',
];

/** Only the server builds this kind, to undo a delete or to restore a version. */
export const INTERNAL_KIND: OperationKind = 'restore_branch';

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
export const NEW_TOPIC_TITLE = 'New topic';
export const DEFAULT_TASK: Task = {
  percent: 0,
  weight: 1,
  state: 'open',
  priority: 'normal',
  due: null,
  assignee: null,
};

export type GroupHint =
  | 'graft'
  | 'paste'
  | 'replace'
  | 'reapply'
  | 'restore'
  | 'undo'
  | 'redo'
  | null;

export interface OpsContext {
  user: string;
  role: Role;
  revision: number;
  members: ReadonlySet<string>;
  /** Server-side groups skip the public kind list so they can restore branches. */
  internal?: boolean;
  /** How many revisions behind the current one a base may be. */
  opWindow?: number;
  hint?: GroupHint;
  /** Version number named by a restore or undo sentence. */
  versionNumber?: number;
}

export type ActivityKind =
  | 'add' | 'rename' | 'move' | 'reorder' | 'delete' | 'note' | 'task' | 'style' | 'link'
  | 'boundary' | 'lock' | 'unlock' | 'restrict' | 'unrestrict' | 'layout' | 'theme'
  | 'slides' | 'custom_colour' | 'restore_branch';

export interface OpEvent {
  kind: ActivityKind;
  topic_id: string;
  title?: string;
  old_title?: string;
  parent_title?: string;
  other_title?: string;
  subtopics?: number;
  layout?: LayoutMode;
  theme?: ThemeName;
}

export interface NoticeForOther {
  user: string;
  text: string;
}

export interface GroupOutcome {
  status: OpStatus;
  results: OpResult[];
  notice: string | null;
  revision: number;
  /** The operations as applied, with title edits already moved into place. */
  effective: Operation[];
  recovered: Omit<RecoveredEntry, 'id'>[];
  noticesToOthers: NoticeForOther[];
  inverse: Operation[] | null;
  touched: string[];
  events: OpEvent[];
  activitySentence: string;
  activityTopicId: string | null;
}

export interface GroupApplication {
  doc: MapDoc;
  outcome: GroupOutcome;
}

export function emptyDoc(rootId: string, rootTitle: string): MapDoc {
  return {
    root: rootId,
    topics: { [rootId]: newTopic(rootId, null, rootTitle) },
    floating: [],
    links: [],
    boundaries: [],
    slides: [],
    layout: 'map',
    theme: 'daylight',
    custom_colours: [],
    title_edits: {},
    tombstones: {},
    last_touch: {},
  };
}

export function newTopic(id: string, parentId: string | null, title: string): StoredTopic {
  return {
    id,
    parent_id: parentId,
    floating: false,
    x: null,
    y: null,
    title,
    note: '',
    icon: null,
    colour: null,
    shape: null,
    side_pin: null,
    task: null,
    locked_by: null,
    restricted: false,
    attachments: [],
    children: [],
  };
}

export function normaliseTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function points(value: string): number {
  return [...value].length;
}

function isInteger(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map((part) => Number(part));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const made = new Date(Date.UTC(y, m - 1, d));
  return made.getUTCFullYear() === y && made.getUTCMonth() === m - 1 && made.getUTCDate() === d;
}

function isColourValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return isCustomColour(value) || (BRANCH_COLOURS as readonly string[]).includes(value) || value === 'accent';
}

function isShape(value: unknown): value is ShapeName {
  return value === 'pill' || value === 'underline' || value === 'filled' || value === 'rounded';
}

function invalid(message = 'That request is not valid.'): ApiError {
  return new ApiError('invalid', message);
}

/** Field checks for one operation, independent of the map state. */
function validateShape(op: Operation, ctx: OpsContext): ApiError | null {
  if (typeof op.op_id !== 'string' || !ID_PATTERN.test(op.op_id)) return invalid();
  const kinds: readonly string[] = ctx.internal
    ? [...PUBLIC_KINDS, INTERNAL_KIND]
    : PUBLIC_KINDS;
  if (!kinds.includes(op.kind)) return invalid();
  const idOk = (value: unknown): boolean => typeof value === 'string' && ID_PATTERN.test(value);
  switch (op.kind) {
    case 'add':
      if (!idOk(op.topic_id) || !idOk(op.parent_id)) return invalid();
      if (op.after !== null && !idOk(op.after)) return invalid();
      if (typeof op.title !== 'string') return invalid();
      if (points(normaliseTitle(op.title)) < 1 || points(normaliseTitle(op.title)) > 200) return invalid();
      return null;
    case 'add_floating':
      if (!idOk(op.topic_id)) return invalid();
      if (typeof op.title !== 'string') return invalid();
      if (points(normaliseTitle(op.title)) < 1 || points(normaliseTitle(op.title)) > 200) return invalid();
      if (op.x !== undefined && typeof op.x !== 'number') return invalid();
      if (op.y !== undefined && typeof op.y !== 'number') return invalid();
      return null;
    case 'title':
      if (!idOk(op.topic_id)) return invalid();
      if (!isInteger(op.offset, 0, 100000) || !isInteger(op.delete, 0, 100000)) return invalid();
      if (typeof op.insert !== 'string') return invalid();
      return null;
    case 'note':
      if (!idOk(op.topic_id) || typeof op.text !== 'string') return invalid();
      if (points(op.text) > 5000) return invalid();
      return null;
    case 'move':
      if (!idOk(op.topic_id) || !idOk(op.parent_id)) return invalid();
      if (op.after !== null && !idOk(op.after)) return invalid();
      return null;
    case 'float_move':
      if (!idOk(op.topic_id) || typeof op.x !== 'number' || typeof op.y !== 'number') return invalid();
      return null;
    case 'delete':
    case 'lock':
    case 'unlock':
      return idOk(op.topic_id) ? null : invalid();
    case 'task': {
      if (!idOk(op.topic_id)) return invalid();
      if (op.task === null || op.task === undefined) return op.task === null ? null : invalid();
      const task = op.task;
      if (typeof task !== 'object') return invalid();
      if (task.percent !== undefined && !isInteger(task.percent, 0, 100)) return invalid();
      if (task.weight !== undefined && !isInteger(task.weight, 0, 10)) return invalid();
      if (task.state !== undefined && task.state !== 'open' && task.state !== 'cancelled') return invalid();
      if (
        task.priority !== undefined &&
        task.priority !== 'low' &&
        task.priority !== 'normal' &&
        task.priority !== 'high'
      ) {
        return invalid();
      }
      if (task.due !== undefined && task.due !== null && !isDate(task.due)) return invalid();
      if (task.assignee !== undefined && task.assignee !== null) {
        if (typeof task.assignee !== 'string' || !ctx.members.has(task.assignee)) return invalid();
      }
      return null;
    }
    case 'style':
      if (!idOk(op.topic_id)) return invalid();
      if (op.colour !== undefined && op.colour !== null && !isColourValue(op.colour)) return invalid();
      if (op.shape !== undefined && op.shape !== null && !isShape(op.shape)) return invalid();
      if (
        op.icon !== undefined &&
        op.icon !== null &&
        !(ICON_NAMES as readonly string[]).includes(op.icon)
      ) {
        return invalid();
      }
      return null;
    case 'pin':
      if (!idOk(op.topic_id)) return invalid();
      if (op.side !== null && op.side !== 'left' && op.side !== 'right') return invalid();
      return null;
    case 'link_add':
      if (!idOk(op.link_id) || !idOk(op.from) || !idOk(op.to)) return invalid();
      if (typeof op.label !== 'string' || points(op.label) > 40) return invalid();
      if (op.type !== 'related' && op.type !== 'depends') return invalid();
      if (op.from === op.to) return invalid();
      return null;
    case 'link_remove':
      return idOk(op.link_id) ? null : invalid();
    case 'boundary_add':
      if (!idOk(op.boundary_id) || !idOk(op.topic_id)) return invalid();
      if (typeof op.label !== 'string' || points(op.label) > 40) return invalid();
      return null;
    case 'boundary_remove':
      return idOk(op.boundary_id) ? null : invalid();
    case 'restrict':
      if (!idOk(op.topic_id) || typeof op.restricted !== 'boolean') return invalid();
      return null;
    case 'layout':
      return op.layout === 'map' || op.layout === 'org' || op.layout === 'list' ? null : invalid();
    case 'theme':
      return op.theme === 'daylight' || op.theme === 'paper' || op.theme === 'dusk'
        ? null
        : invalid();
    case 'slides':
      if (!Array.isArray(op.order) || op.order.some((id) => !idOk(id))) return invalid();
      return null;
    case 'custom_colour':
      return typeof op.colour === 'string' && isCustomColour(op.colour) ? null : invalid();
    default:
      return null;
  }
}

function capabilityFor(op: Operation, doc: MapDoc, ctx: OpsContext): ApiError | null {
  if (op.kind === 'restrict') {
    return can(ctx.role, 'manage') ? null : new ApiError('forbidden', copy.readOnly);
  }
  if (op.kind === 'lock') {
    return can(ctx.role, 'lock') ? null : new ApiError('forbidden', copy.readOnly);
  }
  if (op.kind === 'unlock') {
    const locker = doc.topics[op.topic_id as string]?.locked_by ?? null;
    return canUnlock(ctx.role, ctx.user, locker)
      ? null
      : new ApiError('forbidden', copy.readOnly);
  }
  return can(ctx.role, 'edit') ? null : new ApiError('forbidden', copy.readOnly);
}

/** Topic ids an operation reads or writes, with whether the reference must exist. */
function referencedTopics(op: Operation): string[] {
  switch (op.kind) {
    case 'add':
      return [op.parent_id as string];
    case 'move':
      return [op.topic_id as string, op.parent_id as string];
    case 'link_add':
      return [op.from as string, op.to as string];
    case 'boundary_add':
      return [op.topic_id as string];
    case 'title':
    case 'note':
    case 'float_move':
    case 'delete':
    case 'task':
    case 'style':
    case 'pin':
    case 'lock':
    case 'unlock':
    case 'restrict':
      return [op.topic_id as string];
    case 'slides':
      return op.order ?? [];
    default:
      return [];
  }
}

/** Ops the delete-versus-edit rule sets aside rather than refuses. */
function isRecoverableKind(kind: string): boolean {
  return kind === 'title' || kind === 'note' || kind === 'task' || kind === 'style' || kind === 'add' || kind === 'move';
}

function locksTouched(op: Operation): string[] {
  if (op.kind === 'lock' || op.kind === 'unlock' || op.kind === 'restrict') return [];
  if (op.kind === 'move') return [op.topic_id as string, op.parent_id as string];
  return referencedTopics(op);
}

function nearestSurvivingParent(doc: MapDoc, deletedId: string): string {
  let current: string | null = doc.tombstones[deletedId]?.parent_id ?? null;
  const guard = new Set<string>();
  while (current !== null && !guard.has(current)) {
    guard.add(current);
    if (doc.topics[current]) return current;
    current = doc.tombstones[current]?.parent_id ?? null;
  }
  return doc.root;
}

function insertChild(doc: MapDoc, parentId: string, childId: string, after: string | null): OpReason {
  const parent = doc.topics[parentId];
  if (!parent) return null;
  if (after === null) {
    parent.children.unshift(childId);
    return null;
  }
  const index = parent.children.indexOf(after);
  if (index < 0) {
    parent.children.push(childId);
    return 'anchor_gone';
  }
  parent.children.splice(index + 1, 0, childId);
  return null;
}

function detach(doc: MapDoc, id: string): void {
  const t = doc.topics[id];
  if (!t) return;
  if (t.floating) {
    doc.floating = doc.floating.filter((other) => other !== id);
    return;
  }
  if (t.parent_id !== null) {
    const parent = doc.topics[t.parent_id];
    if (parent) parent.children = parent.children.filter((other) => other !== id);
  }
}

function titleOf(doc: MapDoc, id: string): string {
  return doc.topics[id]?.title ?? doc.tombstones[id]?.title ?? '';
}

export function snapshotBranch(doc: MapDoc, id: string): BranchSnapshot {
  const ids = branchIds(doc, id);
  const set = new Set(ids);
  const t = doc.topics[id];
  const siblings = t?.floating
    ? doc.floating
    : t?.parent_id !== null && t?.parent_id !== undefined
      ? (doc.topics[t.parent_id]?.children ?? [])
      : [];
  return {
    topics: ids.map((each) => structuredClone(doc.topics[each])),
    links: doc.links.filter((link) => set.has(link.from) || set.has(link.to)).map((l) => ({ ...l })),
    boundaries: doc.boundaries.filter((b) => set.has(b.topic_id)).map((b) => ({ ...b })),
    parent_id: t?.parent_id ?? null,
    index: siblings.indexOf(id),
    floating_index: t?.floating ? doc.floating.indexOf(id) : null,
  };
}

function restoreBranch(doc: MapDoc, snapshot: BranchSnapshot): string | null {
  const first = snapshot.topics[0];
  if (!first) return null;
  for (const t of snapshot.topics) {
    doc.topics[t.id] = structuredClone(t);
    delete doc.tombstones[t.id];
  }
  for (const link of snapshot.links) {
    if (!doc.links.some((other) => other.id === link.id)) doc.links.push({ ...link });
  }
  for (const boundary of snapshot.boundaries) {
    if (!doc.boundaries.some((other) => other.id === boundary.id)) {
      doc.boundaries.push({ ...boundary });
    }
  }
  if (first.floating) {
    const at = Math.min(snapshot.floating_index ?? doc.floating.length, doc.floating.length);
    doc.floating.splice(at, 0, first.id);
    return first.id;
  }
  const parentId =
    snapshot.parent_id !== null && doc.topics[snapshot.parent_id]
      ? snapshot.parent_id
      : nearestSurvivingParent(doc, first.id);
  doc.topics[first.id].parent_id = parentId;
  const parent = doc.topics[parentId];
  const at = Math.min(Math.max(snapshot.index, 0), parent.children.length);
  parent.children.splice(at, 0, first.id);
  return first.id;
}

function removeBranch(doc: MapDoc, id: string, by: string, revision: number): number {
  const ids = branchIds(doc, id);
  const set = new Set(ids);
  detach(doc, id);
  for (const each of ids) {
    const t = doc.topics[each];
    doc.tombstones[each] = {
      rev: revision,
      by,
      title: t?.title ?? '',
      parent_id: t?.parent_id ?? null,
    };
    delete doc.topics[each];
    delete doc.title_edits[each];
  }
  doc.links = doc.links.filter((link) => !set.has(link.from) && !set.has(link.to));
  doc.boundaries = doc.boundaries.filter((b) => !set.has(b.topic_id));
  // Slides keep their place: a slide whose topic has gone is skipped, not dropped.
  return ids.length - 1;
}

interface PendingTitleEdit {
  topic_id: string;
  edit: TitleEdit;
}

/**
 * Applies one group of operations to a copy of the document. The document is
 * replaced only when the group is applied; otherwise the original is returned.
 */
export function applyGroup(doc: MapDoc, group: OperationGroup, ctx: OpsContext): GroupApplication {
  const revision = ctx.revision + 1;
  const hidden = hiddenSet(doc, can(ctx.role, 'see_restricted'));
  const results: OpResult[] = group.ops.map((op) => ({
    op_id: op.op_id,
    status: 'applied' as OpStatus,
    reason: null as OpReason,
  }));

  // Every refusal this group earns is collected, then the one published
  // precedence order picks which one the API answers.
  const candidates: ApiError[] = [];
  const refuse = (error: ApiError): void => {
    candidates.push(error);
  };

  const deletedAfterBase = new Map<string, Operation[]>();
  const madeInGroup = new Set<string>();
  for (const op of group.ops) {
    if (op.kind === 'add' || op.kind === 'add_floating') madeInGroup.add(op.topic_id as string);
    if (op.kind === INTERNAL_KIND) {
      for (const each of op.branch?.topics ?? []) madeInGroup.add(each.id);
    }
    for (const id of referencedTopics(op)) {
      if (madeInGroup.has(id)) continue;
      if (doc.topics[id]) {
        if (hidden.has(id)) refuse(new ApiError('not_found', copy.missingTopic));
        continue;
      }
      const tomb = doc.tombstones[id];
      if (tomb && tomb.rev > group.base_revision && isRecoverableKind(op.kind)) {
        const list = deletedAfterBase.get(id) ?? [];
        list.push(op);
        deletedAfterBase.set(id, list);
        continue;
      }
      refuse(new ApiError('not_found', copy.missingTopic));
    }
  }

  for (const op of group.ops) {
    const denied = capabilityFor(op, doc, ctx);
    if (denied) refuse(denied);
  }

  if (ctx.role !== 'owner') {
    for (const op of group.ops) {
      for (const id of locksTouched(op)) {
        const lock = lockInfo(doc, id);
        if (lock.by !== null && lock.by !== ctx.user) {
          const isMove = group.ops.some((other) => other.kind === 'move');
          const title = titleOf(doc, id);
          refuse(
            new ApiError(
              'branch_locked',
              isMove ? copy.lockedMove(title) : copy.lockedEdit(title, lock.by),
            ),
          );
        }
      }
    }
  }

  for (const op of group.ops) {
    if (op.kind === 'delete' && op.topic_id === doc.root) {
      refuse(new ApiError('root_protected', copy.rootDelete));
    }
    if (op.kind === 'move' && op.topic_id === doc.root) {
      refuse(new ApiError('root_protected', copy.rootDelete));
    }
    const bad = validateShape(op, ctx);
    if (bad) refuse(bad);
    if (op.kind === 'custom_colour' && doc.custom_colours.length >= 8) {
      if (!doc.custom_colours.includes(op.colour as string)) refuse(invalid());
    }
  }

  if (ctx.opWindow !== undefined && group.base_revision < ctx.revision - ctx.opWindow) {
    refuse(new ApiError('stale_base', 'Your copy of this map is too old.'));
  }

  const refusal = firstError(candidates);
  if (refusal !== null) throw refusal;

  const recovered: Omit<RecoveredEntry, 'id'>[] = [];
  if (deletedAfterBase.size > 0) {
    const cycling = group.ops.find(
      (op) =>
        op.kind === 'move' &&
        doc.topics[op.topic_id as string] !== undefined &&
        doc.topics[op.parent_id as string] !== undefined &&
        (op.parent_id === op.topic_id || isAncestor(doc, op.topic_id as string, op.parent_id as string)),
    );
    if (cycling) {
      return {
        doc,
        outcome: {
          status: 'rejected',
          results: results.map((result) => ({
            op_id: result.op_id,
            status: 'rejected' as OpStatus,
            reason: result.op_id === cycling.op_id ? ('cycle' as OpReason) : null,
          })),
          notice: copy.cycleRollback(titleOf(doc, cycling.topic_id as string)),
          revision: ctx.revision,
          effective: [],
          recovered: [],
          noticesToOthers: [],
          inverse: null,
          touched: [],
          events: [],
          activitySentence: '',
          activityTopicId: null,
        },
      };
    }
    let by = ctx.user;
    for (const [id, ops] of deletedAfterBase) {
      const tomb = doc.tombstones[id] as { by: string; title: string } | undefined;
      if (tomb) by = tomb.by;
      const parentId = nearestSurvivingParent(doc, id);
      for (const op of ops) {
        const index = group.ops.indexOf(op);
        if (index >= 0) results[index] = { op_id: op.op_id, status: 'recovered', reason: 'deleted' };
        if (op.kind === 'title') {
          const base = tomb?.title ?? '';
          recovered.push({
            text: applyTitleEdit(base, {
              offset: op.offset as number,
              delete: op.delete as number,
              insert: op.insert as string,
            }),
            kind: 'title',
            from_title: base,
            parent_id: parentId,
          });
        } else if (op.kind === 'note') {
          recovered.push({
            text: op.text as string,
            kind: 'note',
            from_title: tomb?.title ?? '',
            parent_id: parentId,
          });
        } else if (op.kind === 'add') {
          recovered.push({
            text: normaliseTitle(op.title as string),
            kind: 'add',
            from_title: tomb?.title ?? '',
            parent_id: parentId,
          });
        }
      }
    }
    for (let i = 0; i < results.length; i += 1) {
      if (results[i].status !== 'recovered') {
        results[i] = { op_id: results[i].op_id, status: 'recovered', reason: null };
      }
    }
    return {
      doc,
      outcome: {
        status: 'recovered',
        results,
        notice: copy.deletedUnderYou(by),
        revision: ctx.revision,
        effective: [],
        recovered,
        noticesToOthers: [],
        inverse: null,
        touched: [],
        events: [],
        activitySentence: '',
        activityTopicId: null,
      },
    };
  }

  const next = structuredClone(doc);
  const inverse: Operation[] = [];
  const events: OpEvent[] = [];
  const touched = new Set<string>();
  const noticesToOthers: NoticeForOther[] = [];
  const pendingTitles: PendingTitleEdit[] = [];
  const effectiveTitles = new Map<string, TitleEdit>();
  let merged = false;
  let rejection: { reason: Exclude<OpReason, null>; opId: string; title: string } | null = null;
  let anchorGone: { by: string } | null = null;
  let inverseId = 0;
  const inv = (op: Omit<Operation, 'op_id'>): void => {
    inverseId += 1;
    inverse.unshift({ ...op, op_id: `inv-${group.group_id}-${inverseId}`.slice(0, 40) } as Operation);
  };

  for (let index = 0; index < group.ops.length && rejection === null; index += 1) {
    const op = group.ops[index];
    switch (op.kind) {
      case 'add': {
        const id = op.topic_id as string;
        const parentId = op.parent_id as string;
        const title = normaliseTitle(op.title as string);
        next.topics[id] = newTopic(id, parentId, title);
        const reason = insertChild(next, parentId, id, op.after ?? null);
        if (reason === 'anchor_gone') {
          results[index] = { op_id: op.op_id, status: 'applied', reason: 'anchor_gone' };
          anchorGone = { by: lastTouchedBy(doc, op.after as string, ctx.user) };
        }
        inv({ kind: 'delete', topic_id: id });
        touched.add(id);
        events.push({ kind: 'add', topic_id: id, title });
        break;
      }
      case 'add_floating': {
        const id = op.topic_id as string;
        const title = normaliseTitle(op.title as string);
        const view: MapView = { doc: next, collapsed: new Set(), hidden: new Set() };
        const spot = op.x !== undefined && op.y !== undefined
          ? { x: op.x, y: op.y }
          : nextFloatingSpot(view);
        const t = newTopic(id, null, title);
        t.floating = true;
        t.x = Math.round(spot.x);
        t.y = Math.round(spot.y);
        next.topics[id] = t;
        next.floating.push(id);
        inv({ kind: 'delete', topic_id: id });
        touched.add(id);
        events.push({ kind: 'add', topic_id: id, title });
        break;
      }
      case 'title': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        const applied = next.title_edits[id] ?? [];
        const earlier = applied.filter((edit) => edit.rev > group.base_revision);
        const incoming: TitleEdit = {
          offset: op.offset as number,
          delete: op.delete as number,
          insert: op.insert as string,
        };
        const moved = earlier.length > 0 ? rebaseTitleEdit(incoming, earlier) : incoming;
        if (earlier.length > 0) {
          merged = true;
          results[index] = { op_id: op.op_id, status: 'merged', reason: null };
        }
        const oldTitle = target.title;
        const newTitle = applyTitleEdit(oldTitle, moved);
        if (points(newTitle) < 1 || points(newTitle) > 200) throw invalid();
        target.title = newTitle;
        pendingTitles.push({ topic_id: id, edit: moved });
        effectiveTitles.set(op.op_id, moved);
        inv({ kind: 'title', topic_id: id, offset: 0, delete: points(newTitle), insert: oldTitle });
        touched.add(id);
        events.push({ kind: 'rename', topic_id: id, old_title: oldTitle, title: newTitle });
        break;
      }
      case 'note': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        inv({ kind: 'note', topic_id: id, text: target.note });
        target.note = op.text as string;
        touched.add(id);
        events.push({ kind: 'note', topic_id: id, title: target.title });
        break;
      }
      case 'move': {
        const id = op.topic_id as string;
        const parentId = op.parent_id as string;
        const target = next.topics[id];
        if (parentId === id || isAncestor(next, id, parentId)) {
          rejection = { reason: 'cycle', opId: op.op_id, title: target.title };
          break;
        }
        const oldParent = target.parent_id;
        const oldSiblings = target.floating
          ? next.floating
          : (next.topics[oldParent as string]?.children ?? []);
        const oldIndex = oldSiblings.indexOf(id);
        const oldAfter = oldIndex > 0 ? oldSiblings[oldIndex - 1] : null;
        detach(next, id);
        target.floating = false;
        target.parent_id = parentId;
        target.x = null;
        target.y = null;
        const reason = insertChild(next, parentId, id, op.after ?? null);
        if (reason === 'anchor_gone') {
          results[index] = { op_id: op.op_id, status: 'applied', reason: 'anchor_gone' };
          anchorGone = { by: lastTouchedBy(doc, op.after as string, ctx.user) };
        }
        inv({ kind: 'move', topic_id: id, parent_id: oldParent, after: oldAfter });
        touched.add(id);
        const last = lastMove(doc, id);
        if (last && last.by !== ctx.user && group.base_revision < last.rev) {
          noticesToOthers.push({ user: last.by, text: copy.movedAfterYou(ctx.user, target.title) });
        }
        events.push({
          kind: oldParent === parentId ? 'reorder' : 'move',
          topic_id: id,
          title: target.title,
          parent_title: next.topics[parentId]?.title ?? '',
        });
        break;
      }
      case 'float_move': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        inv({ kind: 'float_move', topic_id: id, x: target.x ?? 0, y: target.y ?? 0 });
        target.x = Math.round(op.x as number);
        target.y = Math.round(op.y as number);
        touched.add(id);
        events.push({ kind: 'move', topic_id: id, title: target.title, parent_title: target.title });
        break;
      }
      case 'delete': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        const title = target.title;
        const snapshot = snapshotBranch(next, id);
        const subtopics = removeBranch(next, id, ctx.user, revision);
        inv({ kind: INTERNAL_KIND, branch: snapshot });
        touched.add(id);
        events.push({ kind: 'delete', topic_id: id, title, subtopics });
        break;
      }
      case 'task': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        inv({ kind: 'task', topic_id: id, task: target.task ? { ...target.task } : null });
        if (op.task === null) target.task = null;
        else target.task = { ...(target.task ?? DEFAULT_TASK), ...op.task };
        touched.add(id);
        events.push({ kind: 'task', topic_id: id, title: target.title });
        break;
      }
      case 'style': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        inv({
          kind: 'style',
          topic_id: id,
          colour: target.colour,
          shape: target.shape,
          icon: target.icon,
        });
        if (op.colour !== undefined) target.colour = op.colour;
        if (op.shape !== undefined) target.shape = op.shape;
        if (op.icon !== undefined) target.icon = op.icon;
        touched.add(id);
        events.push({ kind: 'style', topic_id: id, title: target.title });
        break;
      }
      case 'pin': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        inv({ kind: 'pin', topic_id: id, side: target.side_pin });
        target.side_pin = op.side ?? null;
        touched.add(id);
        events.push({ kind: 'style', topic_id: id, title: target.title });
        break;
      }
      case 'link_add': {
        const from = op.from as string;
        const to = op.to as string;
        if (op.type === 'depends' && wouldLoop(next, from, to)) {
          rejection = { reason: 'dependency_loop', opId: op.op_id, title: next.topics[from].title };
          break;
        }
        next.links = next.links.filter((link) => link.id !== op.link_id);
        next.links.push({
          id: op.link_id as string,
          from,
          to,
          label: op.label as string,
          type: op.type as 'related' | 'depends',
        });
        inv({ kind: 'link_remove', link_id: op.link_id });
        touched.add(from);
        events.push({
          kind: 'link',
          topic_id: from,
          title: next.topics[from].title,
          other_title: next.topics[to].title,
        });
        break;
      }
      case 'link_remove': {
        const existing = next.links.find((link) => link.id === op.link_id);
        if (existing) {
          inv({
            kind: 'link_add',
            link_id: existing.id,
            from: existing.from,
            to: existing.to,
            label: existing.label,
            type: existing.type,
          });
          next.links = next.links.filter((link) => link.id !== op.link_id);
          touched.add(existing.from);
          events.push({
            kind: 'link',
            topic_id: existing.from,
            title: titleOf(next, existing.from),
            other_title: titleOf(next, existing.to),
          });
        }
        break;
      }
      case 'boundary_add': {
        const id = op.topic_id as string;
        next.boundaries = next.boundaries.filter((b) => b.id !== op.boundary_id);
        next.boundaries.push({
          id: op.boundary_id as string,
          topic_id: id,
          label: op.label as string,
        });
        inv({ kind: 'boundary_remove', boundary_id: op.boundary_id });
        touched.add(id);
        events.push({ kind: 'boundary', topic_id: id, title: next.topics[id].title });
        break;
      }
      case 'boundary_remove': {
        const existing = next.boundaries.find((b) => b.id === op.boundary_id);
        if (existing) {
          inv({
            kind: 'boundary_add',
            boundary_id: existing.id,
            topic_id: existing.topic_id,
            label: existing.label,
          });
          next.boundaries = next.boundaries.filter((b) => b.id !== op.boundary_id);
          touched.add(existing.topic_id);
          events.push({ kind: 'boundary', topic_id: existing.topic_id, title: titleOf(next, existing.topic_id) });
        }
        break;
      }
      case 'lock': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        const existing = lockInfo(next, id).by;
        if (existing !== null) throw new ApiError('branch_locked', copy.lockedEdit(target.title, existing));
        target.locked_by = ctx.user;
        events.push({ kind: 'lock', topic_id: id, title: target.title });
        break;
      }
      case 'unlock': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        target.locked_by = null;
        events.push({ kind: 'unlock', topic_id: id, title: target.title });
        break;
      }
      case 'restrict': {
        const id = op.topic_id as string;
        const target = next.topics[id];
        target.restricted = op.restricted as boolean;
        events.push({
          kind: op.restricted ? 'restrict' : 'unrestrict',
          topic_id: id,
          title: target.title,
        });
        break;
      }
      case 'layout': {
        inv({ kind: 'layout', layout: next.layout });
        next.layout = op.layout as LayoutMode;
        events.push({ kind: 'layout', topic_id: next.root, layout: next.layout });
        break;
      }
      case 'theme': {
        inv({ kind: 'theme', theme: next.theme });
        next.theme = op.theme as ThemeName;
        events.push({ kind: 'theme', topic_id: next.root, theme: next.theme });
        break;
      }
      case 'slides': {
        inv({ kind: 'slides', order: [...next.slides] });
        next.slides = (op.order ?? []).filter((id) => next.topics[id]);
        events.push({ kind: 'slides', topic_id: next.root, title: titleOf(next, next.root) });
        break;
      }
      case 'custom_colour': {
        const colour = op.colour as string;
        if (!next.custom_colours.includes(colour)) next.custom_colours.push(colour);
        events.push({ kind: 'custom_colour', topic_id: next.root, title: titleOf(next, next.root) });
        break;
      }
      default: {
        if (op.kind === INTERNAL_KIND && op.branch) {
          const restoredId = restoreBranch(next, op.branch);
          if (restoredId !== null) {
            touched.add(restoredId);
            events.push({
              kind: 'restore_branch',
              topic_id: restoredId,
              title: titleOf(next, restoredId),
            });
            inv({ kind: 'delete', topic_id: restoredId });
          }
        }
        break;
      }
    }
  }

  if (rejection !== null) {
    const stamped = results.map((result) => ({
      op_id: result.op_id,
      status: 'rejected' as OpStatus,
      reason: result.op_id === rejection.opId ? rejection.reason : null,
    }));
    return {
      doc,
      outcome: {
        status: 'rejected',
        results: stamped,
        notice:
          rejection.reason === 'cycle'
            ? copy.cycleRollback(rejection.title)
            : copy.dependencyLoop,
        revision: ctx.revision,
        effective: [],
        recovered: [],
        noticesToOthers: [],
        inverse: null,
        touched: [],
        events: [],
        activitySentence: '',
        activityTopicId: null,
      },
    };
  }

  for (const pending of pendingTitles) {
    const list = next.title_edits[pending.topic_id] ?? [];
    list.push({ rev: revision, ...pending.edit });
    next.title_edits[pending.topic_id] = list.slice(-200);
  }
  for (const op of group.ops) {
    if (op.kind === 'move' || op.kind === 'delete') {
      next.last_touch[op.topic_id as string] = { by: ctx.user, rev: revision };
    }
  }

  const undoable = group.ops.every(
    (op) => op.kind !== 'lock' && op.kind !== 'unlock' && op.kind !== 'restrict' && op.kind !== 'custom_colour',
  );
  const activity = buildSentence(ctx, events, group.ops, next);
  const effective = group.ops.map((op) => {
    if (op.kind !== 'title') return op;
    const moved = effectiveTitles.get(op.op_id);
    return moved ? { ...op, ...moved } : op;
  });
  return {
    doc: next,
    outcome: {
      status: merged ? 'merged' : 'applied',
      results,
      notice: anchorGone ? copy.orderChanged(anchorGone.by) : null,
      revision,
      effective,
      recovered: [],
      noticesToOthers,
      inverse: undoable && inverse.length > 0 ? inverse : null,
      touched: [...touched],
      events,
      activitySentence: activity.text,
      activityTopicId: activity.topicId,
    },
  };
}

function lastMove(doc: MapDoc, id: string): TouchRecord | null {
  return doc.last_touch[id] ?? null;
}

function lastTouchedBy(doc: MapDoc, id: string, fallback: string): string {
  return doc.last_touch[id]?.by ?? doc.tombstones[id]?.by ?? fallback;
}

function buildSentence(
  ctx: OpsContext,
  events: OpEvent[],
  ops: Operation[],
  doc: MapDoc,
): { text: string; topicId: string | null } {
  const user = ctx.user;
  const first = events[0];
  const topicId = first?.topic_id ?? null;
  switch (ctx.hint) {
    case 'graft':
      return {
        text: sentence.graft(user, events.filter((e) => e.kind === 'add').length, parentTitleOf(doc, ops)),
        topicId,
      };
    case 'paste':
      return {
        text: sentence.paste(user, events.filter((e) => e.kind === 'add').length, parentTitleOf(doc, ops)),
        topicId,
      };
    case 'replace':
      return { text: sentence.replace(user, countDistinct(events)), topicId };
    case 'reapply':
      return { text: sentence.reapply(user, parentTitleOf(doc, ops)), topicId };
    case 'restore':
      return { text: sentence.restore(user, ctx.versionNumber ?? 0), topicId: doc.root };
    case 'undo':
      return { text: sentence.undo(user, first?.title ?? ''), topicId };
    case 'redo':
      return { text: sentence.redo(user, first?.title ?? ''), topicId };
    default:
      break;
  }
  if (!first) return { text: '', topicId: null };
  const kinds = new Set(events.map((event) => event.kind));
  const textKindsOnly = [...kinds].every((kind) => kind === 'rename' || kind === 'note');
  if (textKindsOnly && countDistinct(events) > 1) {
    return { text: sentence.replace(user, countDistinct(events)), topicId };
  }
  if (kinds.size === 1 && events.length > 1) {
    const kind = first.kind;
    if (kind === 'move') {
      return { text: sentence.moveMany(user, events.length, first.parent_title ?? ''), topicId };
    }
    if (kind === 'delete') return { text: sentence.deleteMany(user, events.length), topicId };
  }
  switch (first.kind) {
    case 'add':
      return { text: sentence.add(user, first.title ?? ''), topicId };
    case 'rename':
      return {
        text: sentence.rename(user, first.old_title ?? '', first.title ?? ''),
        topicId,
      };
    case 'move':
      return { text: sentence.move(user, first.title ?? '', first.parent_title ?? ''), topicId };
    case 'reorder':
      return { text: sentence.reorder(user, first.title ?? ''), topicId };
    case 'delete':
      return {
        text:
          (first.subtopics ?? 0) > 0
            ? sentence.deleteWithSubtopics(user, first.title ?? '', first.subtopics ?? 0)
            : sentence.deleteOne(user, first.title ?? ''),
        topicId,
      };
    case 'note':
      return { text: sentence.note(user, first.title ?? ''), topicId };
    case 'task':
      return { text: sentence.task(user, first.title ?? ''), topicId };
    case 'style':
    case 'slides':
    case 'custom_colour':
      return { text: sentence.style(user, first.title ?? ''), topicId };
    case 'link':
      return { text: sentence.link(user, first.title ?? '', first.other_title ?? ''), topicId };
    case 'boundary':
      return { text: sentence.boundary(user, first.title ?? ''), topicId };
    case 'lock':
      return { text: sentence.lock(user, first.title ?? ''), topicId };
    case 'unlock':
      return { text: sentence.unlock(user, first.title ?? ''), topicId };
    case 'restrict':
      return { text: sentence.restrict(user, first.title ?? ''), topicId };
    case 'unrestrict':
      return { text: sentence.unrestrict(user, first.title ?? ''), topicId };
    case 'layout':
      return { text: sentence.layout(user, first.layout ?? 'map'), topicId };
    case 'theme':
      return { text: sentence.theme(user, first.theme ?? 'daylight'), topicId };
    case 'restore_branch':
      return { text: sentence.add(user, first.title ?? ''), topicId };
    default:
      return { text: '', topicId };
  }
}

function parentTitleOf(doc: MapDoc, ops: Operation[]): string {
  for (const op of ops) {
    if (op.kind === 'add' && op.parent_id) return titleOf(doc, op.parent_id);
    if (op.kind === INTERNAL_KIND && op.branch?.parent_id) {
      return titleOf(doc, op.branch.parent_id);
    }
  }
  return titleOf(doc, doc.root);
}

function countDistinct(events: OpEvent[]): number {
  return new Set(events.map((event) => event.topic_id)).size;
}

export { LAYOUT_LABEL, THEME_LABEL };
