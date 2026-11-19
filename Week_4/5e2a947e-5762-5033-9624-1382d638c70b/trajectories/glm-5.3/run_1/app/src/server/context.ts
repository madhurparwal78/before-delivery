import type { PoolClient } from 'pg';
import type { Db } from './db.js';
import type { MapState, StoreTopic } from './engine.js';
import type { CrossLink, Boundary } from '../shared/types.js';
import { ApiError, NOTICES } from './errors.js';


export interface MapRow {
  id: string;
  title: string;
  layout: 'map' | 'org' | 'list';
  theme: 'daylight' | 'paper' | 'dusk';
  owner_id: string;
  revision: string | number;
  custom_colours: string[];
  created_at: Date;
  updated_at: Date;
}

export interface LoadedMap {
  meta: MapRow;
  state: MapState;
}

export function topicFromRow(r: Record<string, unknown>): StoreTopic {
  return {
    id: String(r.id),
    parent_id: r.parent_id === null ? null : String(r.parent_id),
    rank: Number(r.rank),
    floating: Boolean(r.floating),
    x: r.x === null ? null : Number(r.x),
    y: r.y === null ? null : Number(r.y),
    title: String(r.title),
    note: String(r.note ?? ''),
    icon: r.icon === null ? null : String(r.icon),
    colour: r.colour === null ? null : String(r.colour),
    shape: r.shape === null ? null : String(r.shape),
    side_pin: r.side_pin === null ? null : String(r.side_pin),
    task: (r.task ?? null) as Record<string, unknown> | null,
    locked_by: r.locked_by === null ? null : String(r.locked_by),
    restricted: Boolean(r.restricted),
    attachments: (r.attachments ?? []) as StoreTopic['attachments'],
  };
}

export async function loadMapState(db: Db, mapId: string): Promise<LoadedMap> {
  const meta = await db.one<MapRow & { revision: string }>(
    'SELECT id, title, layout, theme, owner_id, revision, custom_colours, created_at, updated_at FROM maps WHERE id = $1',
    [mapId],
  );
  if (!meta) throw new ApiError('not_found', NOTICES.unknownMap);
  const topics = await db.query<Record<string, unknown>>(
    `SELECT t.*, COALESCE(
       (SELECT json_agg(a ORDER BY a.created_at) FROM attachments a WHERE a.map_id = t.map_id AND a.topic_id = t.id AND a.state = 'stored'), '[]') AS attachments
     FROM topics t WHERE t.map_id = $1`,
    [mapId],
  );
  const links = await db.query<Record<string, unknown>>(
    'SELECT id, "from", "to", label, type FROM cross_links WHERE map_id = $1',
    [mapId],
  );
  const boundaries = await db.query<Record<string, unknown>>(
    'SELECT id, topic_id, label FROM boundaries WHERE map_id = $1',
    [mapId],
  );
  const slides = await db.query<{ topic_id: string }>(
    'SELECT topic_id FROM slides WHERE map_id = $1 ORDER BY position',
    [mapId],
  );
  const state: MapState = {
    mapId,
    title: meta.title,
    layout: meta.layout,
    theme: meta.theme,
    revision: Number(meta.revision),
    customColours: meta.custom_colours,
    topics: new Map<string, StoreTopic>(),
    links: new Map<string, CrossLink>(),
    boundaries: new Map<string, Boundary>(),
    slides: slides.rows.map((r) => r.topic_id),
  };
  for (const r of topics.rows) state.topics.set(String(r.id), topicFromRow(r));
  for (const r of links.rows) {
    const l: CrossLink = { id: String(r.id), from: String(r.from), to: String(r.to), label: String(r.label ?? ''), type: r.type as 'related' | 'depends' };
    state.links.set(l.id, l);
  }
  for (const r of boundaries.rows) {
    const b: Boundary = { id: String(r.id), topic_id: String(r.topic_id), label: String(r.label ?? '') };
    state.boundaries.set(b.id, b);
  }
  return { meta: { ...meta, revision: Number(meta.revision) }, state };
}

/** Persist the in-memory state back to PostgreSQL inside a transaction. */
export async function saveMapState(c: PoolClient, state: MapState, meta: { revision: number; layout?: string; theme?: string; customColours?: string[] }): Promise<void> {
  const layout = meta.layout ?? state.layout;
  const theme = meta.theme ?? state.theme;
  await c.query('UPDATE maps SET revision = $2, layout = $3, theme = $4, custom_colours = $5, updated_at = now() WHERE id = $1', [
    state.mapId, meta.revision, layout, theme, JSON.stringify(meta.customColours ?? state.customColours),
  ]);
  // Rewrite topics wholesale: the tree is the source of truth.
  await c.query('DELETE FROM topics WHERE map_id = $1', [state.mapId]);
  const rows: unknown[][] = [];
  for (const t of state.topics.values()) {
    rows.push([state.mapId, t.id, t.parent_id, t.rank, t.floating, t.x, t.y, t.title, t.note, t.icon, t.colour, t.shape, t.side_pin, JSON.stringify(t.task), t.locked_by, t.restricted, JSON.stringify(t.attachments)]);
  }
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((_, j) => {
      const b = i + j * 17;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14}::jsonb,$${b + 15},$${b + 16},$${b + 17}::jsonb)`;
    }).join(',');
    await c.query(`INSERT INTO topics (map_id, id, parent_id, rank, floating, x, y, title, note, icon, colour, shape, side_pin, task, locked_by, restricted, attachments) VALUES ${values} ON CONFLICT DO NOTHING`, chunk.flat());
  }
  await c.query('DELETE FROM cross_links WHERE map_id = $1', [state.mapId]);
  const linkRows: unknown[][] = [];
  for (const l of state.links.values()) linkRows.push([state.mapId, l.id, l.from, l.to, l.label, l.type]);
  for (let i = 0; i < linkRows.length; i += CHUNK) {
    const chunk = linkRows.slice(i, i + CHUNK);
    const values = chunk.map((_, j) => {
      const b = i + j * 6;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
    }).join(',');
    await c.query(`INSERT INTO cross_links (map_id, id, "from", "to", label, type) VALUES ${values} ON CONFLICT DO NOTHING`, chunk.flat());
  }
  await c.query('DELETE FROM boundaries WHERE map_id = $1', [state.mapId]);
  const bRows: unknown[][] = [];
  for (const b of state.boundaries.values()) bRows.push([state.mapId, b.id, b.topic_id, b.label]);
  for (let i = 0; i < bRows.length; i += CHUNK) {
    const chunk = bRows.slice(i, i + CHUNK);
    const values = chunk.map((_, j) => {
      const b = i + j * 4;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4})`;
    }).join(',');
    await c.query(`INSERT INTO boundaries (map_id, id, topic_id, label) VALUES ${values} ON CONFLICT DO NOTHING`, chunk.flat());
  }
  await c.query('DELETE FROM slides WHERE map_id = $1', [state.mapId]);
  for (let p = 0; p < state.slides.length; p += 1) {
    await c.query('INSERT INTO slides (map_id, position, topic_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [state.mapId, p, state.slides[p]]);
  }
}
