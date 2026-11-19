import { query } from './db.js';
import { errors } from './errors.js';
import { blockedWith, connectionEdges, adjacencyFor, degree, degreeLabel, mutuals } from './graph.js';
import { stateBetween, findPair, ConnectionState } from './connections.js';

export type Member = {
  id: string; email: string; handle: string; name: string; headline: string;
  location: string; visibility: string; photo_id: string | null; confirmed: boolean;
};

export const photoUrl = (photoId: string | null): string | null =>
  photoId ? `/media/photos/${photoId}` : null;

export const firstName = (name: string): string => name.split(' ')[0] ?? name;

export const getMember = async (handle: string): Promise<Member | undefined> => {
  const result = await query<Member>(
    `SELECT id, email, handle, name, headline, location, visibility, photo_id, confirmed
     FROM members WHERE lower(handle) = lower($1)`, [handle]);
  return result.rows[0];
};

export const getMemberById = async (id: string): Promise<Member | undefined> => {
  const result = await query<Member>(
    `SELECT id, email, handle, name, headline, location, visibility, photo_id, confirmed
     FROM members WHERE id = $1`, [id]);
  return result.rows[0];
};

export type SkillRow = { name: string; endorsements: number; endorsed_by_me: boolean; featured_position: number | null; endorser_line: string | null };

export type Profile = Record<string, unknown>;

/** The one visibility projection: exactly the published keys for owner's setting and viewer's degree. */
export const projectProfile = async (viewerId: string, member: Member): Promise<Profile | null> => {
  if (viewerId === member.id) return ownerProjection(member);
  const blocked = await blockedWith(viewerId);
  if (blocked.has(member.id)) return null;
  const state = await connectionStateFor(viewerId, member.id);
  const deg = await degreeTo(viewerId, member.id, blocked);
  const base = {
    id: member.id, handle: member.handle, name: member.name,
    headline: member.headline, location: member.location,
    photo_url: photoUrl(member.photo_id), visibility: member.visibility,
    degree: degreeLabel(deg).data,
    connection_state: state,
    following: await isFollowing(viewerId, member.id),
  };
  if (member.visibility === 'private') {
    if (state === 'connected') {
      return { ...base, mutual: await mutualFor(viewerId, member.id, blocked) };
    }
    return null;
  }
  if (member.visibility === 'connections' && state !== 'connected') {
    return { ...base, mutual: await mutualFor(viewerId, member.id, blocked) };
  }
  return {
    ...base,
    mutual: await mutualFor(viewerId, member.id, blocked),
    about: await aboutFor(member.id),
    experience: await experienceFor(member.id),
    education: await educationFor(member.id),
    skills: await skillsFor(member.id, viewerId),
  };
};

export const ownerProjection = async (member: Member): Promise<Profile> => ({
  id: member.id, handle: member.handle, name: member.name,
  headline: member.headline, location: member.location,
  photo_url: photoUrl(member.photo_id), visibility: member.visibility,
  degree: 'self',
  email: member.email,
  versions: await sectionVersions(member.id),
  about: await aboutFor(member.id),
  experience: await experienceFor(member.id),
  education: await educationFor(member.id),
  skills: await skillsFor(member.id, member.id),
});

export const sectionVersions = async (memberId: string): Promise<Record<string, number>> => {
  const result = await query(
    `SELECT intro_version, about_version, experience_version, education_version, skills_version
     FROM profile_sections WHERE member_id = $1`, [memberId]);
  const row = result.rows[0];
  return {
    intro: Number(row?.intro_version ?? 1),
    about: Number(row?.about_version ?? 1),
    experience: Number(row?.experience_version ?? 1),
    education: Number(row?.education_version ?? 1),
    skills: Number(row?.skills_version ?? 1),
  };
};

export const connectionStateFor = async (viewerId: string, otherId: string): Promise<ConnectionState> => {
  const row = await findPair(viewerId, otherId);
  return stateBetween(viewerId, row, false);
};

export const degreeTo = async (viewerId: string, targetId: string, blocked: Set<string>): Promise<number | null> => {
  const edges = await connectionEdges();
  const adj = adjacencyFor(edges, blocked);
  return degree(viewerId, targetId, adj);
};

export const isFollowing = async (viewerId: string, targetId: string): Promise<boolean> => {
  const result = await query(`SELECT 1 FROM follows WHERE follower_id = $1 AND target_id = $2`,
    [viewerId, targetId]);
  return result.rows.length > 0;
};

export const mutualFor = async (
  viewerId: string, targetId: string, blocked: Set<string>,
): Promise<{ count: number; named?: { id: string; name: string; handle: string } }> => {
  const list = await mutuals(viewerId, targetId, blocked);
  const named = list[0] ? { id: list[0].id, name: list[0].name, handle: list[0].handle } : undefined;
  return named ? { count: list.length, named } : { count: list.length };
};

export const aboutFor = async (memberId: string): Promise<string> => {
  const result = await query<{ about: string }>(`SELECT about FROM profile_sections WHERE member_id = $1`, [memberId]);
  return result.rows[0]?.about ?? '';
};

export type ExperienceEntry = { title: string; company: string; start: string; end: string | null };
export type EducationEntry = { school: string; degree: string; start: string; end: string | null };

export const experienceFor = async (memberId: string): Promise<ExperienceEntry[]> => {
  const result = await query(
    `SELECT title, company, start_month, end_month FROM experience WHERE member_id = $1 ORDER BY position`, [memberId]);
  return result.rows.map((row) => ({
    title: row.title as string, company: row.company as string,
    start: row.start_month as string, end: (row.end_month as string | null) ?? null,
  }));
};

export const educationFor = async (memberId: string): Promise<EducationEntry[]> => {
  const result = await query(
    `SELECT school, degree, start_month, end_month FROM education WHERE member_id = $1 ORDER BY position`, [memberId]);
  return result.rows.map((row) => ({
    school: row.school as string, degree: row.degree as string,
    start: row.start_month as string, end: (row.end_month as string | null) ?? null,
  }));
};

export const skillsFor = async (ownerId: string, viewerId: string): Promise<SkillRow[]> => {
  const blocked = await blockedWith(viewerId);
  const result = await query<{ id: string; name: string; featured: number | null; endorsements: string; recent: string | null; recent_name: string | null; by_me: boolean }>(
    `SELECT s.id, s.name,
       (SELECT position FROM featured_skills fs WHERE fs.member_id = s.member_id AND fs.skill_id = s.id) AS featured,
       (SELECT count(*) FROM endorsements e WHERE e.skill_id = s.id) AS endorsements,
       (SELECT m.name FROM endorsements e JOIN members m ON m.id = e.endorser_id
         WHERE e.skill_id = s.id AND e.endorser_id = (
           SELECT e2.endorser_id FROM endorsements e2 WHERE e2.skill_id = s.id
           ORDER BY e2.at DESC LIMIT 1)) AS recent_name,
       EXISTS (SELECT 1 FROM endorsements e WHERE e.skill_id = s.id AND e.endorser_id = $2) AS by_me
     FROM skills s WHERE s.member_id = $1`,
    [ownerId, viewerId],
  );
  const rows = result.rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      endorsements: Number(row.endorsements),
      featured: row.featured === null ? null : Number(row.featured),
      byMe: row.by_me,
      recentName: row.recent_name,
    }))
    .sort((a, b) => b.endorsements - a.endorsements || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const featuredRows = rows.filter((r) => r.featured !== null).sort((a, b) => (a.featured ?? 0) - (b.featured ?? 0));
  const rest = rows.filter((r) => r.featured === null);
  return [...featuredRows, ...rest].map((row) => ({
    name: row.name,
    endorsements: row.endorsements,
    endorsed_by_me: row.byMe,
    featured_position: row.featured,
    endorser_line: endorserLine(row, blocked),
  }));
};

const endorserLine = (
  row: { endorsements: number; byMe: boolean; recentName: string | null },
  blocked: Set<string>,
): string | null => {
  const n = row.endorsements;
  if (row.byMe) {
    if (n === 1) return 'Endorsed by you';
    if (n === 2) return 'Endorsed by you and 1 other';
    return `Endorsed by you and ${n - 1} others`;
  }
  const named = row.recentName;
  if (named && !blocked.has(named)) {
    if (n === 1) return `Endorsed by ${named}`;
    if (n === 2) return `Endorsed by ${named} and 1 other`;
    return `Endorsed by ${named} and ${n - 1} others`;
  }
  return null;
};

/** Person card for lists. */
export type PersonCard = {
  id: string; handle: string; name: string; headline: string;
  photo_url: string | null; degree: string; connection_state: ConnectionState;
  mutual_count: number;
};

export const personCard = async (viewerId: string, member: Member, extras?: Partial<PersonCard>): Promise<PersonCard> => {
  const blocked = await blockedWith(viewerId);
  const deg = await degreeTo(viewerId, member.id, blocked);
  const state = await connectionStateFor(viewerId, member.id);
  const mutual = await mutualFor(viewerId, member.id, blocked);
  const card: PersonCard = {
    id: member.id, handle: member.handle, name: member.name, headline: member.headline,
    photo_url: member.visibility === 'private' ? null : photoUrl(member.photo_id),
    degree: degreeLabel(deg).data,
    connection_state: state,
    mutual_count: mutual.count,
  };
  return { ...card, ...extras };
};

export const notFoundOrThrow = (): never => { throw errors.notFound(); };
