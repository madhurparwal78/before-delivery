import { emptyDoc } from './ops.js';
import type { ApiTopic, MapDoc, MapPayload, StoredTopic } from './types.js';

/** Rebuilds the working document from a map payload, for the browser. */
export function docFromPayload(payload: MapPayload): MapDoc {
  const rootTopic = payload.topics.find((t) => t.parent_id === null && !t.floating);
  const doc = emptyDoc(rootTopic?.id ?? 'root', rootTopic?.title ?? '');
  doc.topics = {};
  doc.floating = [];
  for (const api of payload.topics) {
    const stored: StoredTopic = {
      id: api.id,
      parent_id: api.parent_id,
      floating: api.floating,
      x: api.x,
      y: api.y,
      title: api.title,
      note: api.note,
      icon: api.icon,
      colour: api.colour,
      shape: api.shape,
      side_pin: api.side_pin,
      task: api.task,
      locked_by: api.locked_by,
      restricted: api.restricted,
      attachments: api.attachments,
      children: [],
    };
    doc.topics[api.id] = stored;
    if (api.floating) doc.floating.push(api.id);
  }
  const ranked = [...payload.topics].sort((a, b) => a.rank - b.rank);
  for (const api of ranked) {
    if (api.parent_id === null) continue;
    doc.topics[api.parent_id]?.children.push(api.id);
  }
  doc.links = payload.links.map((link) => ({ ...link }));
  doc.boundaries = payload.boundaries.map((boundary) => ({ ...boundary }));
  doc.slides = [...payload.slides];
  doc.layout = payload.map.layout;
  doc.theme = payload.map.theme;
  doc.custom_colours = [...payload.map.custom_colours];
  return doc;
}

export interface TopicCountsById {
  comments: Map<string, number>;
  votes: Map<string, number>;
  voted: Set<string>;
}

export function emptyCounts(): TopicCountsById {
  return { comments: new Map(), votes: new Map(), voted: new Set() };
}

export function apiTopicFrom(
  stored: StoredTopic,
  rank: number,
  lockInherited: boolean,
  counts: TopicCountsById,
  derived: ApiTopic['derived'],
): ApiTopic {
  return {
    id: stored.id,
    parent_id: stored.parent_id,
    rank,
    floating: stored.floating,
    x: stored.x,
    y: stored.y,
    title: stored.title,
    note: stored.note,
    icon: stored.icon,
    colour: stored.colour,
    shape: stored.shape,
    side_pin: stored.side_pin,
    task: stored.task,
    locked_by: stored.locked_by,
    lock_inherited: lockInherited,
    restricted: stored.restricted,
    attachments: stored.attachments,
    comment_count: counts.comments.get(stored.id) ?? 0,
    vote_count: counts.votes.get(stored.id) ?? 0,
    voted: counts.voted.has(stored.id),
    derived,
  };
}
