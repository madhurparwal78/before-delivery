import { maybeRow, oneRow, rows, type Db } from '../db.js';
import { notFound } from '../errors.js';
import { connectionStates, type ConnectionState } from './connections.js';
import { mutualsBetween } from './counts.js';
import { degreesFrom, type Degree } from './graph.js';
import { photoUrl } from './media.js';
import { skillsFor } from './skills.js';
import { memberVisibleTo } from './visibility.js';

interface ProfileRow {
  id: string;
  handle: string;
  name: string;
  headline: string;
  location: string;
  about: string;
  visibility: 'public' | 'connections' | 'private';
  photo_id: string | null;
  email: string;
  version_intro: number;
  version_about: number;
  version_experience: number;
  version_education: number;
  version_skills: number;
}

const PROFILE_COLUMNS = `m.id, m.handle, m.name, m.headline, m.location, m.about, m.visibility, m.photo_id, m.email,
  m.version_intro, m.version_about, m.version_experience, m.version_education, m.version_skills`;

/** The member behind a handle, or 404 when missing, blocked either way, or private to the viewer. */
export async function visibleMemberByHandle(db: Db, viewerId: string, handle: string): Promise<ProfileRow> {
  const member = await maybeRow<ProfileRow>(db, `SELECT ${PROFILE_COLUMNS} FROM members m WHERE m.handle = $2 AND m.confirmed AND ${memberVisibleTo('$1', 'm')}`, [viewerId, handle]);
  if (!member) throw notFound();
  return member;
}

interface PositionEntry {
  title: string;
  company: string;
  start: string;
  end: string | null;
}

interface EducationEntry {
  school: string;
  degree: string;
  start: string;
  end: string | null;
}

export const experienceOf = (db: Db, memberId: string): Promise<PositionEntry[]> =>
  rows<PositionEntry>(db, 'SELECT title, company, start, "end" FROM member_experience WHERE member_id = $1 ORDER BY position', [memberId]);

export const educationOf = (db: Db, memberId: string): Promise<EducationEntry[]> =>
  rows<EducationEntry>(db, 'SELECT school, degree, start, "end" FROM member_education WHERE member_id = $1 ORDER BY position', [memberId]);

/** The owner's own profile: every field, their email and the section versions. */
export async function ownerProjection(db: Db, memberId: string): Promise<Record<string, unknown>> {
  const member = await oneRow<ProfileRow>(db, `SELECT ${PROFILE_COLUMNS} FROM members m WHERE m.id = $1`, [memberId]);
  return {
    id: member.id,
    handle: member.handle,
    name: member.name,
    headline: member.headline,
    location: member.location,
    photo_url: photoUrl(member.photo_id),
    visibility: member.visibility,
    degree: 'self',
    email: member.email,
    versions: {
      intro: member.version_intro,
      about: member.version_about,
      experience: member.version_experience,
      education: member.version_education,
      skills: member.version_skills,
    },
    about: member.about,
    experience: await experienceOf(db, memberId),
    education: await educationOf(db, memberId),
    skills: await skillsFor(db, memberId, memberId),
  };
}

/**
 * The one visibility projection: exactly the keys the owner's setting and the viewer's degree allow. A hidden key is
 * absent, never null. A profile the viewer may not see is a 404.
 */
export async function profileProjection(db: Db, viewerId: string, handle: string): Promise<Record<string, unknown>> {
  const member = await visibleMemberByHandle(db, viewerId, handle);
  if (member.id === viewerId) return ownerProjection(db, viewerId);
  const degree: Degree = (await degreesFrom(db, viewerId, [member.id])).get(member.id) as Degree;
  const connectionState = (await connectionStates(db, viewerId, [member.id])).get(member.id) as ConnectionState;
  const identity = { id: member.id, handle: member.handle, name: member.name, headline: member.headline };
  if (member.visibility === 'private') {
    return { ...identity, visibility: member.visibility, degree, connection_state: connectionState };
  }
  const mutuals = await mutualsBetween(db, viewerId, member.id);
  const named = mutuals.members[0];
  const followed = await maybeRow(db, 'SELECT 1 FROM follows WHERE follower_id = $1 AND target_id = $2', [viewerId, member.id]);
  const limited = {
    ...identity,
    location: member.location,
    photo_url: photoUrl(member.photo_id),
    visibility: member.visibility,
    degree,
    connection_state: connectionState,
    following: followed !== undefined,
    mutual: { count: mutuals.count, ...(named ? { named } : {}) },
  };
  if (member.visibility === 'connections' && degree !== '1') return limited;
  return {
    ...limited,
    about: member.about,
    experience: await experienceOf(db, member.id),
    education: await educationOf(db, member.id),
    skills: await skillsFor(db, viewerId, member.id),
  };
}
