import { query } from '../server/db';
import {
  blockedWith,
  blockExists,
  connectionState,
  degreeBetween,
  mutualConnections,
  type ConnectionState,
  type Degree,
} from './graph';

export type MemberRow = {
  id: string;
  email: string;
  handle: string;
  name: string;
  headline: string;
  location: string;
  about: string;
  visibility: string;
  photo_id: string | null;
  versions: Record<string, number>;
};

const MEMBER_COLUMNS =
  'id, email, handle, name, headline, location, about, visibility, photo_id, versions';

export async function memberById(id: string): Promise<MemberRow | null> {
  const rows = await query<MemberRow>(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function memberByHandle(handle: string): Promise<MemberRow | null> {
  const rows = await query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM members WHERE lower(handle) = lower($1)`,
    [handle],
  );
  return rows[0] ?? null;
}

export async function firstDegreeSet(memberId: string): Promise<Set<string>> {
  const rows = await query<{ other: string }>(
    `SELECT CASE WHEN member_a = $1 THEN member_b ELSE member_a END AS other
     FROM connections WHERE member_a = $1 OR member_b = $1`,
    [memberId],
  );
  return new Set(rows.map((row) => row.other));
}

export function photoUrl(photoId: string | null): string | null {
  return photoId ? `/media/photos/${photoId}` : null;
}

export type PersonCard = {
  id: string;
  handle: string;
  name: string;
  headline: string;
  photo_url?: string | null;
  degree: Degree;
  connection_state: ConnectionState;
  mutual_count: number;
  requested_at?: string;
  connected_at?: string;
};

export async function personCard(viewerId: string, owner: MemberRow): Promise<PersonCard> {
  const degree = await degreeBetween(viewerId, owner.id);
  const state = await connectionState(viewerId, owner.id);
  const mutual = await mutualConnections(viewerId, owner.id);
  const card: PersonCard = {
    id: owner.id,
    handle: owner.handle,
    name: owner.name,
    headline: owner.headline,
    degree,
    connection_state: state,
    mutual_count: mutual.length,
  };
  if (owner.visibility !== 'private') card.photo_url = photoUrl(owner.photo_id);
  return card;
}

export type SkillView = {
  name: string;
  endorsements: number;
  endorsed_by_me: boolean;
  featured_position: number | null;
  endorser_line: string | null;
};

type SkillRow = {
  id: string;
  name: string;
  featured_position: number | null;
};

/** Skills in display order: featured first, then endorsement count, then name. */
export async function skillsFor(viewerId: string, ownerId: string): Promise<SkillView[]> {
  const skills = await query<SkillRow>(
    'SELECT id, name, featured_position FROM skills WHERE member_id = $1',
    [ownerId],
  );
  if (skills.length === 0) return [];
  const endorsements = await query<{ skill_id: string; endorser_id: string; created_at: Date }>(
    `SELECT e.skill_id, e.endorser_id, e.created_at
     FROM endorsements e JOIN skills s ON s.id = e.skill_id
     WHERE s.member_id = $1`,
    [ownerId],
  );
  const excluded = await blockedWith(viewerId);
  const connections = ownerId === viewerId ? null : await firstDegreeSet(viewerId);
  const actorIds = [...new Set(endorsements.map((row) => row.endorser_id))];
  const actors = actorIds.length
    ? await query<{ id: string; name: string }>('SELECT id, name FROM members WHERE id = ANY($1)', [
        actorIds,
      ])
    : [];
  const names = new Map(actors.map((row) => [row.id, row.name]));

  const views: SkillView[] = skills.map((skill) => {
    const mine = endorsements.filter(
      (row) => row.skill_id === skill.id && !excluded.has(row.endorser_id),
    );
    const total = mine.length;
    const byMe = mine.some((row) => row.endorser_id === viewerId);
    return {
      name: skill.name,
      endorsements: total,
      endorsed_by_me: byMe,
      featured_position: skill.featured_position,
      endorser_line: endorserLine(mine, total, byMe, connections, names),
    };
  });

  views.sort((a, b) => {
    if (a.featured_position && b.featured_position) return a.featured_position - b.featured_position;
    if (a.featured_position) return -1;
    if (b.featured_position) return 1;
    if (a.endorsements !== b.endorsements) return b.endorsements - a.endorsements;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return views;
}

function endorserLine(
  rows: { endorser_id: string; created_at: Date }[],
  total: number,
  byMe: boolean,
  connections: Set<string> | null,
  names: Map<string, string>,
): string | null {
  if (total === 0) return null;
  const suffix = (n: number): string =>
    n === 1 ? '' : n === 2 ? ' and 1 other' : ` and ${n - 1} others`;
  if (byMe) return `Endorsed by you${suffix(total)}`;
  const eligible = rows.filter((row) => connections === null || connections.has(row.endorser_id));
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const byTime = b.created_at.getTime() - a.created_at.getTime();
    if (byTime !== 0) return byTime;
    return (names.get(a.endorser_id) ?? '')
      .toLowerCase()
      .localeCompare((names.get(b.endorser_id) ?? '').toLowerCase());
  });
  const named = names.get(eligible[0].endorser_id) ?? '';
  return `Endorsed by ${named}${suffix(total)}`;
}

export type ExperienceEntry = {
  title: string;
  company: string;
  start: string;
  end: string | null;
};

export type EducationEntry = {
  school: string;
  degree: string;
  start: string;
  end: string | null;
};

export async function experienceOf(memberId: string): Promise<ExperienceEntry[]> {
  const rows = await query<{ title: string; company: string; start_ym: string; end_ym: string | null }>(
    'SELECT title, company, start_ym, end_ym FROM experience WHERE member_id = $1 ORDER BY position',
    [memberId],
  );
  return rows.map((row) => ({
    title: row.title,
    company: row.company,
    start: row.start_ym,
    end: row.end_ym,
  }));
}

export async function educationOf(memberId: string): Promise<EducationEntry[]> {
  const rows = await query<{ school: string; degree: string; start_ym: string; end_ym: string | null }>(
    'SELECT school, degree, start_ym, end_ym FROM education WHERE member_id = $1 ORDER BY position',
    [memberId],
  );
  return rows.map((row) => ({
    school: row.school,
    degree: row.degree,
    start: row.start_ym,
    end: row.end_ym,
  }));
}

export async function isFollowing(followerId: string, targetId: string): Promise<boolean> {
  const rows = await query<{ one: number }>(
    'SELECT 1 AS one FROM follows WHERE follower_id = $1 AND target_id = $2',
    [followerId, targetId],
  );
  return rows.length > 0;
}

/**
 * The profile projection: exactly the published keys for the owner's visibility
 * setting and the viewer's degree. A hidden key is absent, never null.
 */
export async function profileProjection(
  viewerId: string,
  owner: MemberRow,
): Promise<Record<string, unknown> | null> {
  if (viewerId === owner.id) {
    return {
      id: owner.id,
      handle: owner.handle,
      name: owner.name,
      headline: owner.headline,
      location: owner.location,
      photo_url: photoUrl(owner.photo_id),
      visibility: owner.visibility,
      degree: 'self',
      email: owner.email,
      versions: owner.versions,
      about: owner.about,
      experience: await experienceOf(owner.id),
      education: await educationOf(owner.id),
      skills: await skillsFor(viewerId, owner.id),
    };
  }
  if (await blockExists(viewerId, owner.id)) return null;
  const degree = await degreeBetween(viewerId, owner.id);
  const state = await connectionState(viewerId, owner.id);

  if (owner.visibility === 'private') {
    if (degree !== '1') return null;
    return {
      id: owner.id,
      handle: owner.handle,
      name: owner.name,
      headline: owner.headline,
      visibility: owner.visibility,
      degree,
      connection_state: state,
    };
  }

  const mutual = await mutualConnections(viewerId, owner.id);
  const mutualValue: Record<string, unknown> = { count: mutual.length };
  if (mutual.length > 0) {
    mutualValue.named = { id: mutual[0].id, name: mutual[0].name, handle: mutual[0].handle };
  }
  const base: Record<string, unknown> = {
    id: owner.id,
    handle: owner.handle,
    name: owner.name,
    headline: owner.headline,
    location: owner.location,
    photo_url: photoUrl(owner.photo_id),
    visibility: owner.visibility,
    degree,
    connection_state: state,
    following: await isFollowing(viewerId, owner.id),
    mutual: mutualValue,
  };
  if (owner.visibility === 'public' || degree === '1') {
    base.about = owner.about;
    base.experience = await experienceOf(owner.id);
    base.education = await educationOf(owner.id);
    base.skills = await skillsFor(viewerId, owner.id);
  }
  return base;
}
