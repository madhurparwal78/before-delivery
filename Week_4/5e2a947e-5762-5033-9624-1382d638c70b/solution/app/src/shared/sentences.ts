import type { LayoutMode, MapDoc, Op, ThemeName } from './model.ts';
import { branchOf, childrenIndex } from './tree.ts';

const LAYOUT_NAMES: Record<LayoutMode, string> = { map: 'Mind map', org: 'Org chart', list: 'List' };
const THEME_NAMES: Record<ThemeName, string> = { daylight: 'Daylight', paper: 'Paper', dusk: 'Dusk' };

const themeName = (theme: ThemeName): string => THEME_NAMES[theme];

interface Described {
  sentence: string;
  topic_id: string | null;
}

/** The sentence that Activity and live announcements use for a group, decided by its operations. */
export function describeOps(user: string, ops: readonly Op[], before: MapDoc, after: MapDoc): Described {
  const first = ops[0];
  if (!first) return { sentence: `${user} changed the map`, topic_id: null };
  const title = (id: string): string => after.topics[id]?.title ?? before.topics[id]?.title ?? '';
  const titleOld = (id: string): string => before.topics[id]?.title ?? after.topics[id]?.title ?? '';
  const parentTitle = (id: string): string => {
    const parent = after.topics[id]?.parent_id;
    return parent ? title(parent) : '';
  };
  const same = ops.length > 1 && ops.every((o) => o.kind === first.kind);
  const texted = ops.filter((o): o is Extract<Op, { kind: 'title' | 'note' }> => o.kind === 'title' || o.kind === 'note');
  const replaced = new Set(texted.map((o) => o.topic_id));
  if (texted.length === ops.length && replaced.size > 1) return { sentence: `${user} replaced text in ${replaced.size} topics`, topic_id: first.kind === 'title' || first.kind === 'note' ? first.topic_id : null };
  switch (first.kind) {
    case 'add':
    case 'add_floating':
      return { sentence: `${user} added ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'title':
      return { sentence: `${user} renamed ${titleOld(first.topic_id)} to ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'note':
      return { sentence: `${user} edited the note on ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'move': {
      const moved = before.topics[first.topic_id];
      if (same) return { sentence: `${user} moved ${ops.length} topics under ${parentTitle(first.topic_id)}`, topic_id: first.topic_id };
      if (moved && moved.parent_id === first.parent_id) return { sentence: `${user} reordered ${title(first.topic_id)}`, topic_id: first.topic_id };
      return { sentence: `${user} moved ${title(first.topic_id)} under ${parentTitle(first.topic_id)}`, topic_id: first.topic_id };
    }
    case 'float_move':
      return { sentence: `${user} moved ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'delete': {
      if (same) return { sentence: `${user} deleted ${ops.length} topics`, topic_id: first.topic_id };
      const gone = branchOf(before.topics, first.topic_id, childrenIndex(before.topics)).length - 1;
      const extra = gone > 0 ? ` and ${gone} ${gone === 1 ? 'subtopic' : 'subtopics'}` : '';
      return { sentence: `${user} deleted ${titleOld(first.topic_id)}${extra}`, topic_id: first.topic_id };
    }
    case 'task':
      return { sentence: `${user} changed the task on ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'style':
    case 'pin':
      return { sentence: `${user} styled ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'link_add':
      return { sentence: `${user} linked ${title(first.from)} to ${title(first.to)}`, topic_id: first.from };
    case 'link_remove': {
      const link = before.links.find((l) => l.id === first.link_id);
      return { sentence: `${user} removed the link from ${title(link?.from ?? '')} to ${title(link?.to ?? '')}`, topic_id: link?.from ?? null };
    }
    case 'boundary_add':
      return { sentence: `${user} added a boundary around ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'boundary_remove': {
      const boundary = before.boundaries.find((b) => b.id === first.boundary_id);
      return { sentence: `${user} removed the boundary around ${title(boundary?.topic_id ?? '')}`, topic_id: boundary?.topic_id ?? null };
    }
    case 'lock':
      return { sentence: `${user} locked ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'unlock':
      return { sentence: `${user} unlocked ${title(first.topic_id)}`, topic_id: first.topic_id };
    case 'restrict':
      return {
        sentence: first.restricted ? `${user} restricted ${title(first.topic_id)}` : `${user} lifted the restriction on ${title(first.topic_id)}`,
        topic_id: first.topic_id,
      };
    case 'layout':
      return { sentence: `${user} switched to ${LAYOUT_NAMES[first.layout]}`, topic_id: null };
    case 'theme':
      return { sentence: `${user} chose the ${themeName(first.theme)} theme`, topic_id: null };
    case 'slides':
      return { sentence: `${user} reordered the slides`, topic_id: null };
    case 'custom_colour':
      return { sentence: `${user} saved a custom colour`, topic_id: null };
    case 'put_branch':
    case 'drop_links': {
      const root = first.kind === 'put_branch' ? first.branch.topics[0] : undefined;
      return { sentence: `${user} restored ${root ? title(root.id) : 'a change'}`, topic_id: root?.id ?? null };
    }
  }
}
