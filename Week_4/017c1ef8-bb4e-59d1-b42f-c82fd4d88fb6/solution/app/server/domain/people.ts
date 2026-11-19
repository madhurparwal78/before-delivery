import { rows, type Db } from '../db.js';
import { connectionStates, type ConnectionState } from './connections.js';
import { mutualCounts } from './counts.js';
import { degreesFrom, type Degree } from './graph.js';
import { photoUrl, showsPhoto } from './media.js';
import { decodeCursor, encodeCursor, SEARCH_PAGE_SIZE, type Page } from './page.js';
import { memberVisibleTo } from './visibility.js';

export { degreesFrom } from './graph.js';
export type { Degree } from './graph.js';
export type { ConnectionState } from './connections.js';

export interface PersonCard {
  id: string;
  handle: string;
  name: string;
  headline: string;
  /** Absent for a private member, who appears only to their 1st-degree connections. */
  photo_url?: string | null;
  degree: Degree;
  connection_state: ConnectionState;
  mutual_count: number;
}

interface CardRow {
  id: string;
  handle: string;
  name: string;
  headline: string;
  visibility: string;
  photo_id: string | null;
}

async function cardsFor(db: Db, viewerId: string, members: CardRow[]): Promise<PersonCard[]> {
  const ids = members.map((member) => member.id);
  // One after another: `db` may be a transaction's single client, which runs one query at a time.
  const degrees = await degreesFrom(db, viewerId, ids);
  const states = await connectionStates(db, viewerId, ids);
  const mutuals = await mutualCounts(db, viewerId, ids);
  return members.map((member) => ({
    id: member.id,
    handle: member.handle,
    name: member.name,
    headline: member.headline,
    ...(showsPhoto(member.visibility) ? { photo_url: photoUrl(member.photo_id) } : {}),
    degree: degrees.get(member.id) as Degree,
    connection_state: member.id === viewerId ? 'none' : (states.get(member.id) as ConnectionState),
    mutual_count: mutuals.get(member.id) as number,
  }));
}

/** Person cards for members the viewer may see, in the order given; unseeable members are left out. */
export async function personCards(db: Db, viewerId: string, memberIds: string[]): Promise<PersonCard[]> {
  const visible = await rows<CardRow>(
    db,
    `SELECT m.id, m.handle, m.name, m.headline, m.visibility, m.photo_id FROM members m
      WHERE m.id = ANY($2) AND m.confirmed AND ${memberVisibleTo('$1', 'm')}`,
    [viewerId, memberIds],
  );
  const byId = new Map(visible.map((member) => [member.id, member]));
  const ordered = memberIds.flatMap((id) => {
    const member = byId.get(id);
    return member ? [member] : [];
  });
  return cardsFor(db, viewerId, ordered);
}

interface PeopleSearch {
  q: string;
  /** Degrees ticked in the filter; empty (or all three) means no degree filter. */
  degrees: Array<'1' | '2' | '3'>;
  company: string;
  location: string;
  cursor: string | null;
}

const DEGREE_RANK: Record<Degree, number> = { self: 0, '1': 1, '2': 2, '3': 3, out: 4 };

type SearchKey = [rank: number, name: string, id: string];

const after = (a: SearchKey, b: SearchKey): boolean => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);

/**
 * People search: every word of the query is a word prefix of the name or headline. Blocked members and private
 * non-connections never appear. Ordered by degree, then name ignoring case, then id.
 */
export async function searchPeople(db: Db, viewerId: string, search: PeopleSearch): Promise<Page<PersonCard>> {
  const words = search.q.toLowerCase().split(' ').filter((word) => word !== '');
  if (words.length === 0) return { total: 0, results: [], next_cursor: null };
  const params: unknown[] = [viewerId];
  const conditions = [`m.id <> $1`, `m.confirmed`, memberVisibleTo('$1', 'm')];
  for (const word of words) {
    params.push(word);
    conditions.push(`EXISTS (SELECT 1 FROM regexp_split_to_table(lower(m.name || ' ' || m.headline), '\\s+') w WHERE starts_with(w, $${params.length}))`);
  }
  if (search.company !== '') {
    params.push(search.company);
    conditions.push(`EXISTS (SELECT 1 FROM member_experience e WHERE e.member_id = m.id AND e."end" IS NULL AND lower(e.company) = lower($${params.length}))`);
  }
  if (search.location !== '') {
    params.push(search.location);
    conditions.push(`position(lower($${params.length}) in lower(m.location)) > 0`);
  }
  const candidates = await rows<CardRow>(db, `SELECT m.id, m.handle, m.name, m.headline, m.visibility, m.photo_id FROM members m WHERE ${conditions.join(' AND ')}`, params);
  const degrees = await degreesFrom(db, viewerId, candidates.map((member) => member.id));
  const filtered = search.degrees.length === 0 || search.degrees.length === 3 ? null : new Set<Degree>(search.degrees);
  const keyed = candidates
    .map((member) => ({ member, key: [DEGREE_RANK[degrees.get(member.id) ?? 'out'], member.name.toLowerCase(), member.id] as SearchKey }))
    .filter(({ member }) => filtered === null || filtered.has(degrees.get(member.id) ?? 'out'))
    .sort((a, b) => (after(a.key, b.key) ? 1 : -1));
  const start = search.cursor ? decodeCursor<SearchKey>(search.cursor) : null;
  const remaining = start ? keyed.filter(({ key }) => after(key, start)) : keyed;
  const pageItems = remaining.slice(0, SEARCH_PAGE_SIZE);
  const last = pageItems[pageItems.length - 1];
  return {
    total: keyed.length,
    results: await cardsFor(db, viewerId, pageItems.map(({ member }) => member)),
    next_cursor: remaining.length > SEARCH_PAGE_SIZE && last ? encodeCursor(last.key) : null,
  };
}
