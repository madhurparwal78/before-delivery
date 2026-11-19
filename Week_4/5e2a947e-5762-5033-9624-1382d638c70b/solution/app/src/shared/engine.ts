import { dependsLoop } from './derive.ts';
import type { BranchSnapshot, DocTopic, MapDoc, Op, OpReason, Side } from './model.ts';
import { LIMITS } from './rules.ts';
import { applyTitleEdit, normaliseTitle } from './titleMerge.ts';
import { branchOf, childrenIndex, childrenOf, isWithin, newTopics, placeAmong, rootOf, type Topics } from './tree.ts';

type Refusal = OpReason | 'missing' | 'root_protected' | 'invalid_title';

interface Applied {
  /** Operations that undo this one, in the order they must run. */
  inverse: Op[];
  /** Topics whose title, note, task fields or place this operation changed. */
  touched: string[];
  anchorGone: boolean;
  /** The topic a person should land on after this operation. */
  focus: string | null;
  /** True for operations undo and redo cover. */
  undoable: boolean;
}

interface Refused {
  refused: Refusal;
  topic: string | null;
}

export const isRefused = (result: Applied | Refused): result is Refused => 'refused' in result;

const refuse = (refused: Refusal, topic: string | null = null): Refused => ({ refused, topic });

export function emptyDoc(): MapDoc {
  return { topics: newTopics(), links: [], boundaries: [], slides: [], layout: 'map', theme: 'daylight', custom_colours: [], next_n: 0 };
}

export function cloneDoc(doc: MapDoc): MapDoc {
  const copy = structuredClone(doc);
  copy.topics = Object.assign(newTopics(), copy.topics);
  return copy;
}

export function newTopic(doc: MapDoc, id: string, parentId: string | null, title: string): DocTopic {
  const topic: DocTopic = {
    id,
    parent_id: parentId,
    rank: 0,
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
    n: doc.next_n,
  };
  doc.next_n += 1;
  return topic;
}

const DEFAULT_TASK = { percent: 0, weight: 1, state: 'open', priority: 'normal', due: null, assignee: null } as const;

const done = (inverse: Op[], touched: string[], focus: string | null, extra: Partial<Applied> = {}): Applied => ({
  inverse,
  touched,
  anchorGone: false,
  focus,
  undoable: true,
  ...extra,
});

const siblingBefore = (topics: Topics, topic: DocTopic): string | null => {
  const siblings = childrenOf(topics, topic.parent_id ?? '').filter((t) => t.id !== topic.id);
  const at = siblings.findIndex((t) => t.rank > topic.rank);
  const before = at === -1 ? siblings[siblings.length - 1] : siblings[at - 1];
  return before?.id ?? null;
};

const renumber = (topics: Topics, parentId: string | null): void => {
  if (parentId === null) return;
  childrenOf(topics, parentId).forEach((t, at) => {
    t.rank = at;
  });
};

function branchSnapshot(doc: MapDoc, id: string): BranchSnapshot {
  const members = branchOf(doc.topics, id, childrenIndex(doc.topics));
  const ids = new Set(members.map((t) => t.id));
  const ancestors: string[] = [];
  for (let cursor = doc.topics[id]?.parent_id ?? null; cursor !== null; cursor = doc.topics[cursor]?.parent_id ?? null) {
    ancestors.push(cursor);
  }
  return {
    topics: structuredClone(members),
    links: doc.links.filter((l) => ids.has(l.from) || ids.has(l.to)),
    boundaries: doc.boundaries.filter((b) => ids.has(b.topic_id)),
    ancestors,
  };
}

function putBranch(doc: MapDoc, branch: BranchSnapshot, opId: string): Applied {
  const ids = new Set(branch.topics.map((t) => t.id));
  const before = branch.topics.filter((t) => doc.topics[t.id]).map((t) => structuredClone(doc.topics[t.id] as DocTopic));
  const created = branch.topics.filter((t) => !doc.topics[t.id]);
  const roots = branch.topics.filter((t) => t.parent_id === null || !ids.has(t.parent_id));
  const keys = new Map<string, number>();
  for (const topic of branch.topics) {
    const copy = structuredClone(topic);
    if (!doc.topics[topic.id] && copy.n < 0) {
      copy.n = doc.next_n;
      doc.next_n += 1;
    }
    doc.topics[copy.id] = copy;
  }
  for (const root of roots) {
    const stored = doc.topics[root.id] as DocTopic;
    if (stored.floating || root.parent_id === null) continue;
    const wanted = [root.parent_id, ...branch.ancestors].find((p) => p !== null && doc.topics[p] && !ids.has(p));
    stored.parent_id = wanted ?? rootOf(doc.topics)?.id ?? null;
    keys.set(root.id, root.rank);
  }
  const parents = new Set(roots.map((r) => doc.topics[r.id]?.parent_id ?? null));
  for (const parent of parents) {
    if (parent === null) continue;
    const siblings = childrenOf(doc.topics, parent);
    const ordered = siblings
      .map((t) => ({ t, key: keys.has(t.id) ? (keys.get(t.id) as number) - 0.5 : t.rank }))
      .sort((a, b) => a.key - b.key);
    ordered.forEach(({ t }, at) => {
      t.rank = at;
    });
  }
  const linkIds = new Set(doc.links.map((l) => l.id));
  const boundaryIds = new Set(doc.boundaries.map((b) => b.id));
  const newLinks = branch.links.filter((l) => !linkIds.has(l.id) && doc.topics[l.from] && doc.topics[l.to]);
  const newBoundaries = branch.boundaries.filter((b) => !boundaryIds.has(b.id) && doc.topics[b.topic_id]);
  doc.links.push(...structuredClone(newLinks));
  doc.boundaries.push(...structuredClone(newBoundaries));
  const newRoots = created.filter((t) => t.parent_id === null || !ids.has(t.parent_id));
  const inverse: Op[] = [];
  if (before.length > 0) inverse.push({ op_id: `${opId}~put`, kind: 'put_branch', branch: { topics: before, links: [], boundaries: [], ancestors: [] } });
  for (const root of newRoots) inverse.push({ op_id: `${opId}~del-${root.id}`, kind: 'delete', topic_id: root.id });
  if (newLinks.length > 0 || newBoundaries.length > 0) {
    inverse.push({ op_id: `${opId}~drop`, kind: 'drop_links', link_ids: newLinks.map((l) => l.id), boundary_ids: newBoundaries.map((b) => b.id) });
  }
  const first = roots[0]?.id ?? null;
  return done(inverse, roots.map((r) => r.id), first);
}

/** Apply one operation to a document in place. The caller clones the document first when it may need to roll back. */
export function applyOp(doc: MapDoc, op: Op, who: string): Applied | Refused {
  const topics = doc.topics;
  switch (op.kind) {
    case 'add': {
      const parent = topics[op.parent_id];
      if (!parent) return refuse('missing', op.parent_id);
      const topic = newTopic(doc, op.topic_id, op.parent_id, normaliseTitle(op.title));
      topics[topic.id] = topic;
      const anchored = op.after === null || topics[op.after]?.parent_id === op.parent_id;
      placeAmong(topics, op.parent_id, topic, anchored ? op.after : 'last');
      return done([{ op_id: `${op.op_id}~inv`, kind: 'delete', topic_id: topic.id }], [topic.id], topic.id, { anchorGone: !anchored });
    }
    case 'add_floating': {
      const topic = newTopic(doc, op.topic_id, null, normaliseTitle(op.title));
      topic.floating = true;
      topic.x = Math.round(op.x);
      topic.y = Math.round(op.y);
      topics[topic.id] = topic;
      return done([{ op_id: `${op.op_id}~inv`, kind: 'delete', topic_id: topic.id }], [topic.id], topic.id);
    }
    case 'title': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      const next = normaliseTitle(applyTitleEdit(topic.title, op));
      if (next.length === 0 || Array.from(next).length > LIMITS.title_chars) return refuse('invalid_title', topic.id);
      const old = topic.title;
      topic.title = next;
      return done([{ op_id: `${op.op_id}~inv`, kind: 'title', topic_id: topic.id, offset: 0, delete: Array.from(next).length, insert: old }], [topic.id], topic.id);
    }
    case 'note': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      const old = topic.note;
      topic.note = op.text;
      return done([{ op_id: `${op.op_id}~inv`, kind: 'note', topic_id: topic.id, text: old }], [topic.id], topic.id);
    }
    case 'move': {
      const topic = topics[op.topic_id];
      const parent = topics[op.parent_id];
      if (!topic) return refuse('missing', op.topic_id);
      if (!parent) return refuse('missing', op.parent_id);
      if (topic.parent_id === null && !topic.floating) return refuse('root_protected', topic.id);
      if (isWithin(topics, op.parent_id, topic.id)) return refuse('cycle', topic.id);
      const wasFloating = topic.floating;
      const old = structuredClone(topic);
      const oldParent = topic.parent_id;
      const previous = wasFloating ? null : siblingBefore(topics, topic);
      topic.parent_id = op.parent_id;
      topic.floating = false;
      topic.x = null;
      topic.y = null;
      const anchored = op.after === null || (topics[op.after]?.parent_id === op.parent_id && op.after !== topic.id);
      placeAmong(topics, op.parent_id, topic, anchored ? op.after : 'last');
      renumber(topics, oldParent);
      const inverse: Op = wasFloating
        ? { op_id: `${op.op_id}~inv`, kind: 'put_branch', branch: { topics: [old], links: [], boundaries: [], ancestors: [] } }
        : { op_id: `${op.op_id}~inv`, kind: 'move', topic_id: topic.id, parent_id: oldParent ?? op.parent_id, after: previous };
      return done([inverse], [topic.id], topic.id, { anchorGone: !anchored });
    }
    case 'float_move': {
      const topic = topics[op.topic_id];
      if (!topic?.floating) return refuse('missing', op.topic_id);
      const inverse: Op = { op_id: `${op.op_id}~inv`, kind: 'float_move', topic_id: topic.id, x: topic.x ?? 0, y: topic.y ?? 0 };
      topic.x = Math.round(op.x);
      topic.y = Math.round(op.y);
      return done([inverse], [topic.id], topic.id);
    }
    case 'delete': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      if (topic.parent_id === null && !topic.floating) return refuse('root_protected', topic.id);
      const snapshot = branchSnapshot(doc, topic.id);
      const ids = new Set(snapshot.topics.map((t) => t.id));
      for (const id of ids) delete topics[id];
      doc.links = doc.links.filter((l) => !ids.has(l.from) && !ids.has(l.to));
      doc.boundaries = doc.boundaries.filter((b) => !ids.has(b.topic_id));
      renumber(topics, snapshot.topics[0]?.parent_id ?? null);
      const survivor = snapshot.topics[0]?.parent_id ?? null;
      return done([{ op_id: `${op.op_id}~inv`, kind: 'put_branch', branch: snapshot }], [topic.id], survivor);
    }
    case 'task': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      const old = topic.task ? { ...topic.task } : null;
      topic.task = op.task === null ? null : { ...DEFAULT_TASK, ...(topic.task ?? {}), ...op.task };
      return done([{ op_id: `${op.op_id}~inv`, kind: 'task', topic_id: topic.id, task: old }], [topic.id], topic.id);
    }
    case 'style': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      const inverse: Op = { op_id: `${op.op_id}~inv`, kind: 'style', topic_id: topic.id };
      if (op.colour !== undefined) {
        inverse.colour = topic.colour;
        topic.colour = op.colour;
      }
      if (op.shape !== undefined) {
        inverse.shape = topic.shape;
        topic.shape = op.shape;
      }
      if (op.icon !== undefined) {
        inverse.icon = topic.icon;
        topic.icon = op.icon;
      }
      return done([inverse], [topic.id], topic.id);
    }
    case 'pin': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      const old: Side | null = topic.side_pin;
      topic.side_pin = op.side;
      return done([{ op_id: `${op.op_id}~inv`, kind: 'pin', topic_id: topic.id, side: old }], [topic.id], topic.id);
    }
    case 'link_add': {
      if (!topics[op.from]) return refuse('missing', op.from);
      if (!topics[op.to]) return refuse('missing', op.to);
      if (op.type === 'depends' && dependsLoop(doc, op.from, op.to)) return refuse('dependency_loop', op.from);
      doc.links.push({ id: op.link_id, from: op.from, to: op.to, label: op.label, type: op.type });
      return done([{ op_id: `${op.op_id}~inv`, kind: 'link_remove', link_id: op.link_id }], [], op.from);
    }
    case 'link_remove': {
      const link = doc.links.find((l) => l.id === op.link_id);
      if (!link) return refuse('missing', null);
      doc.links = doc.links.filter((l) => l.id !== op.link_id);
      const inverse: Op = { op_id: `${op.op_id}~inv`, kind: 'link_add', link_id: link.id, from: link.from, to: link.to, label: link.label, type: link.type };
      return done([inverse], [], link.from);
    }
    case 'boundary_add': {
      if (!topics[op.topic_id]) return refuse('missing', op.topic_id);
      doc.boundaries.push({ id: op.boundary_id, topic_id: op.topic_id, label: op.label });
      return done([{ op_id: `${op.op_id}~inv`, kind: 'boundary_remove', boundary_id: op.boundary_id }], [], op.topic_id);
    }
    case 'boundary_remove': {
      const boundary = doc.boundaries.find((b) => b.id === op.boundary_id);
      if (!boundary) return refuse('missing', null);
      doc.boundaries = doc.boundaries.filter((b) => b.id !== op.boundary_id);
      const inverse: Op = { op_id: `${op.op_id}~inv`, kind: 'boundary_add', boundary_id: boundary.id, topic_id: boundary.topic_id, label: boundary.label };
      return done([inverse], [], boundary.topic_id);
    }
    case 'lock': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      topic.locked_by = who;
      return done([], [], topic.id, { undoable: false });
    }
    case 'unlock': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      topic.locked_by = null;
      return done([], [], topic.id, { undoable: false });
    }
    case 'restrict': {
      const topic = topics[op.topic_id];
      if (!topic) return refuse('missing', op.topic_id);
      topic.restricted = op.restricted;
      return done([], [], topic.id, { undoable: false });
    }
    case 'layout': {
      const old = doc.layout;
      doc.layout = op.layout;
      return done([{ op_id: `${op.op_id}~inv`, kind: 'layout', layout: old }], [], null);
    }
    case 'theme': {
      const old = doc.theme;
      doc.theme = op.theme;
      return done([{ op_id: `${op.op_id}~inv`, kind: 'theme', theme: old }], [], null);
    }
    case 'slides': {
      const old = doc.slides;
      doc.slides = [...op.order];
      return done([{ op_id: `${op.op_id}~inv`, kind: 'slides', order: old }], [], null);
    }
    case 'custom_colour': {
      if (!doc.custom_colours.includes(op.colour)) doc.custom_colours.push(op.colour);
      return done([], [], null, { undoable: false });
    }
    case 'put_branch':
      return putBranch(doc, op.branch, op.op_id);
    case 'drop_links': {
      const links = doc.links.filter((l) => op.link_ids.includes(l.id));
      const boundaries = doc.boundaries.filter((b) => op.boundary_ids.includes(b.id));
      doc.links = doc.links.filter((l) => !op.link_ids.includes(l.id));
      doc.boundaries = doc.boundaries.filter((b) => !op.boundary_ids.includes(b.id));
      const inverse: Op = { op_id: `${op.op_id}~inv`, kind: 'put_branch', branch: { topics: [], links, boundaries, ancestors: [] } };
      return done([inverse], [], null);
    }
  }
}

interface GroupApplied {
  doc: MapDoc;
  inverse: Op[];
  touched: string[];
  focus: string | null;
  undoable: boolean;
}

/** Apply a whole group to a copy of the document; null when any operation cannot apply. */
export function applyGroup(doc: MapDoc, ops: readonly Op[], who: string): GroupApplied | null {
  const next = cloneDoc(doc);
  const inverse: Op[][] = [];
  const touched: string[] = [];
  let focus: string | null = null;
  let undoable = false;
  for (const op of ops) {
    const result = applyOp(next, op, who);
    if (isRefused(result)) return null;
    inverse.unshift(result.inverse);
    touched.push(...result.touched);
    focus = result.focus ?? focus;
    undoable = undoable || (result.undoable && result.inverse.length > 0);
  }
  return { doc: next, inverse: inverse.flat(), touched: [...new Set(touched)], focus, undoable };
}
