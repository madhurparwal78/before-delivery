import type { Operation } from '../shared/types.js';
import type { MapState } from './engine.js';

/**
 * The published remote and activity sentence grammar. The group's
 * first operation decides the sentence unless every operation is of
 * one kind on several topics.
 */

function layoutName(l: string): string {
  if (l === 'map') return 'Mind map';
  if (l === 'org') return 'Org chart';
  return 'List';
}

export interface SentenceInput {
  user: string;
  ops: Operation[];
  before: MapState;
  after: MapState;
  kind?: string; // override kind for restore/undo/redo/graft/paste/re-apply/replace
  extra?: { oldTitle?: string; otherTitle?: string; versionNumber?: number; count?: number; subtopics?: number };
}

/** Build the group's activity sentence. */
export function buildSentence(input: SentenceInput): string | null {
  const { user, ops, after } = input;
  if (input.kind) {
    const extra = input.extra ?? {};
    switch (input.kind) {
      case 'restore': return `${user} restored version ${extra.versionNumber}`;
      case 'undo': return `${user} undid a change to ${extra.otherTitle ?? ''}`;
      case 'redo': return `${user} redid a change to ${extra.otherTitle ?? ''}`;
      case 'graft': return `${user} imported ${extra.count} topics under ${extra.otherTitle ?? ''}`;
      case 'paste': return `${user} pasted ${extra.count} topics under ${extra.otherTitle ?? ''}`;
      case 'replace': return `${user} replaced text in ${extra.count} topics`;
      case 're-apply': return `${user} re-applied an edit under ${extra.otherTitle ?? ''}`;
      case 'layout': return `${user} switched to ${layoutName(extra.otherTitle ?? 'map')}`;
      case 'theme': return `${user} chose the ${extra.otherTitle ?? 'Daylight'} theme`;
      case 'restrict': return `${user} restricted ${extra.otherTitle ?? ''}`;
      case 'unrestrict': return `${user} lifted the restriction on ${extra.otherTitle ?? ''}`;
      default: break;
    }
  }
  const first = ops[0];
  if (!first) return null;
  const titleOf = (id: string | undefined | null): string => after.topics.get(id ?? '')?.title ?? input.before.topics.get(id ?? '')?.title ?? '';
  switch (first.kind) {
    case 'add': case 'add_floating': {
      const adds = ops.filter((o) => o.kind === 'add' || o.kind === 'add_floating');
      if (adds.length > 1) return `${user} added ${adds.length} topics`;
      return `${user} added ${titleOf(adds[0].topic_id)}`;
    }
    case 'title': return `${user} renamed ${input.extra?.oldTitle ?? titleOf(first.topic_id)} to ${titleOf(first.topic_id)}`;
    case 'move': case 'float_move': {
      const moves = ops.filter((o) => o.kind === 'move' || o.kind === 'float_move');
      const parentTitle = titleOf(first.parent_id ?? first.topic_id);
      if (moves.length > 1) return `${user} moved ${moves.length} topics under ${parentTitle}`;
      return `${user} moved ${titleOf(first.topic_id)} under ${parentTitle}`;
    }
    case 'pin': {
      const pins = ops.filter((o) => o.kind === 'pin');
      if (pins.length > 1) return `${user} moved ${pins.length} topics under ${titleOf(first.topic_id)}`;
      return `${user} moved ${titleOf(first.topic_id)} under ${titleOf(first.topic_id)}`;
    }
    case 'delete': {
      const dels = ops.filter((o) => o.kind === 'delete');
      if (dels.length > 1) return `${user} deleted ${dels.length} topics`;
      const sub = countDescendants(input.before, first.topic_id!);
      if (sub > 0) return `${user} deleted ${titleOf(first.topic_id)} and ${sub === 1 ? '1 subtopic' : `${sub} subtopics`}`;
      return `${user} deleted ${titleOf(first.topic_id)}`;
    }
    case 'note': return `${user} edited the note on ${titleOf(first.topic_id)}`;
    case 'task': return `${user} changed the task on ${titleOf(first.topic_id)}`;
    case 'style': return `${user} styled ${titleOf(first.topic_id)}`;
    case 'link_add': {
      return `${user} linked ${titleOf(first.from)} to ${titleOf(first.to)}`;
    }
    case 'link_remove': return `${user} unlinked ${titleOf(first.link_id)}`;
    case 'boundary_add': return `${user} added a boundary around ${titleOf(first.topic_id)}`;
    case 'boundary_remove': return `${user} removed a boundary around ${titleOf(first.topic_id)}`;
    case 'lock': return `${user} locked ${titleOf(first.topic_id)}`;
    case 'unlock': return `${user} unlocked ${titleOf(first.topic_id)}`;
    case 'restrict': return first.restricted ? `${user} restricted ${titleOf(first.topic_id)}` : `${user} lifted the restriction on ${titleOf(first.topic_id)}`;
    case 'layout': return `${user} switched to ${layoutName(first.layout ?? 'map')}`;
    case 'theme': return `${user} chose the ${cap(first.theme ?? 'daylight')} theme`;
    case 'slides': return `${user} reordered the slides`;
    case 'custom_colour': return `${user} styled ${titleOf(first.topic_id ?? '')}`;
    default: return null;
  }
}

function cap(s: string): string {
  return s === 'daylight' ? 'Daylight' : s === 'paper' ? 'Paper' : 'Dusk';
}

function countDescendants(state: MapState, id: string): number {
  const byParent = new Map<string, string[]>();
  for (const t of state.topics.values()) {
    if (t.parent_id === null) continue;
    const arr = byParent.get(t.parent_id) ?? [];
    arr.push(t.id);
    byParent.set(t.parent_id, arr);
  }
  let n = 0;
  const walk = (tid: string) => {
    for (const c of byParent.get(tid) ?? []) { n += 1; walk(c); }
  };
  walk(id);
  return n;
}
