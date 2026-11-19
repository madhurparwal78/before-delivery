import { deriveAll } from '../shared/derive.ts';
import { ApiError } from '../shared/errors.ts';
import type {
  ApiTopic,
  Derived,
  MapDoc,
  MapPayload,
  PresentationInfo,
  PresentationState,
  RecoveredEntry,
  Role,
} from '../shared/model.ts';
import { can } from '../shared/rules.ts';
import { lockOf, newTopics, rootOf, withoutRestricted } from '../shared/tree.ts';
import { serverDate, serverIso } from './clock.ts';
import { config } from './config.ts';
import { database, query, type Db } from './db.ts';
import type { Principal } from './http.ts';
import { ownerName, roleHolders } from './members.ts';

export interface MapRow {
  id: string;
  title: string;
  owner_id: string;
  revision: number;
  seq: number;
  doc: MapDoc;
  version_baseline: Date;
  created_at: Date;
  updated_at: Date;
}

/** A map's title is its central idea, read from the tree so a rename or a restore can never leave it stale. */
export const titleOf = (doc: MapDoc): string => rootOf(doc.topics)?.title ?? '';

export async function loadMap(db: Db, mapId: string, lock = false): Promise<MapRow | null> {
  const rows = await query<MapRow>(db, `SELECT * FROM maps WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [mapId]);
  const row = rows[0];
  if (row) {
    row.doc.topics = Object.assign(newTopics(), row.doc.topics);
    row.title = titleOf(row.doc);
  }
  return row ?? null;
}

/** The person's role on a map, or null when they have none. */
async function roleOn(db: Db, map: MapRow, principal: Principal): Promise<Role | null> {
  if (principal.guest) return principal.guestMap === map.id ? principal.guestRole : null;
  if (map.owner_id === principal.id) return 'owner';
  const rows = await query<{ role: Role }>(db, 'SELECT role FROM members WHERE map_id = $1 AND user_id = $2', [map.id, principal.id]);
  return rows[0]?.role ?? null;
}

/** Load a map and the caller's role; a map the caller has no role on does not exist for them. */
export async function accessMap(db: Db, mapId: string, principal: Principal): Promise<{ map: MapRow; role: Role }> {
  const map = await loadMap(db, mapId);
  const role = map ? await roleOn(db, map, principal) : null;
  if (!map || !role) throw new ApiError('not_found', "We couldn't find that map.");
  return { map, role };
}

export const visibleDoc = (doc: MapDoc, role: Role): MapDoc => (can(role, 'see_restricted') ? doc : withoutRestricted(doc));

interface Counts {
  comments: Map<string, number>;
  votes: Map<string, number>;
  mine: Set<string>;
}

export async function loadCounts(db: Db, mapId: string, personId: string): Promise<Counts> {
  const comments = await query<{ topic_id: string; n: string }>(
    db,
    `SELECT c.topic_id, count(*) AS n FROM comments c
     JOIN comments r ON r.id = coalesce(c.reply_to, c.id)
     WHERE c.map_id = $1 AND NOT r.resolved GROUP BY c.topic_id`,
    [mapId],
  );
  const votes = await query<{ topic_id: string; n: string; mine: boolean }>(
    db,
    'SELECT topic_id, count(*) AS n, bool_or(user_id = $2) AS mine FROM votes WHERE map_id = $1 GROUP BY topic_id',
    [mapId, personId],
  );
  return {
    comments: new Map(comments.map((r) => [r.topic_id, Number(r.n)])),
    votes: new Map(votes.map((r) => [r.topic_id, Number(r.n)])),
    mine: new Set(votes.filter((r) => r.mine).map((r) => r.topic_id)),
  };
}

function apiTopics(doc: MapDoc, counts: Counts, today: string): ApiTopic[] {
  const derived = deriveAll(doc, today);
  return Object.values(doc.topics).map((topic): ApiTopic => {
    const lock = lockOf(doc.topics, topic.id);
    return {
      ...topic,
      locked_by: topic.locked_by ?? null,
      lock_inherited: lock !== null && lock.inherited,
      comment_count: counts.comments.get(topic.id) ?? 0,
      vote_count: counts.votes.get(topic.id) ?? 0,
      voted: counts.mine.has(topic.id),
      derived: derived.get(topic.id) as Derived,
    };
  });
}

async function loadRecovered(db: Db, mapId: string, personId: string): Promise<RecoveredEntry[]> {
  return query<RecoveredEntry>(
    db,
    'SELECT id, text, kind, from_title, parent_id FROM recovered WHERE map_id = $1 AND user_id = $2 ORDER BY created_at, id',
    [mapId, personId],
  );
}

async function loadCollapsed(db: Db, mapId: string, personId: string): Promise<string[]> {
  const rows = await query<{ topic_id: string }>(db, 'SELECT topic_id FROM collapse WHERE map_id = $1 AND user_id = $2 ORDER BY topic_id', [mapId, personId]);
  return rows.map((r) => r.topic_id);
}

interface PresentationRow {
  id: string;
  code: string;
  state: PresentationState;
  slide_index: number;
}

async function activePresentation(db: Db, mapId: string): Promise<PresentationRow | null> {
  const rows = await query<PresentationRow>(db, "SELECT id, code, state, slide_index FROM presentations WHERE map_id = $1 AND state <> 'ended'", [mapId]);
  return rows[0] ?? null;
}

export async function buildPayload(
  mapId: string,
  principal: Principal,
  followers: (code: string) => number,
  db: Db = database(),
): Promise<MapPayload> {
  const { map, role } = await accessMap(db, mapId, principal);
  const doc = visibleDoc(map.doc, role);
  const [counts, collapsed, recovered, owner, active] = await Promise.all([
    loadCounts(db, map.id, principal.id),
    loadCollapsed(db, map.id, principal.id),
    loadRecovered(db, map.id, principal.id),
    ownerName(db, map.owner_id),
    role === 'owner' ? activePresentation(db, map.id) : Promise.resolve(null),
  ]);
  const presentation: PresentationInfo | null = active
    ? { id: active.id, code: active.code, state: active.state, slide_index: active.slide_index, followers: followers(active.code) }
    : null;
  return {
    map: { id: map.id, title: map.title, revision: map.revision, layout: doc.layout, theme: doc.theme, owner, role, custom_colours: doc.custom_colours },
    topics: apiTopics(doc, counts, serverDate()),
    links: doc.links,
    boundaries: doc.boundaries,
    collapsed: collapsed.filter((id) => doc.topics[id]),
    slides: role === 'owner' ? doc.slides : doc.slides.filter((id) => doc.topics[id]),
    recovered,
    server_time: serverIso(),
    server_date: serverDate(),
    settings: {
      toast_ms: config.toastMs,
      presence_timeout_ms: config.presenceTimeoutMs,
      virtual_from: config.virtualFrom,
      dom_margin_px: config.domMarginPx,
      dom_ceiling: config.domCeiling,
      attach_max_bytes: config.attachMaxBytes,
      map_quota_bytes: config.mapQuotaBytes,
      outline_max_bytes: config.outlineMaxBytes,
    },
    seq: map.seq,
    next_n: map.doc.next_n,
    presentation,
    me: { id: principal.id, name: principal.name, guest: principal.guest },
    roster: [...(await roleHolders(db, map))].sort(),
  };
}
