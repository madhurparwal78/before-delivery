import { config } from '../config.js';
import { maybeRow, rows, type Db, type Tx, publishAfterCommit } from '../db.js';
import { notFound, unprocessable, validation } from '../errors.js';
import { notBlockedWith, connectedWith } from './visibility.js';
import { lengthOutside, others } from './text.js';


interface SkillRow {
  name: string;
  endorsements: number;
  endorsed_by_me: boolean;
  featured_position: number | null;
  endorser_line: string | null;
}

interface StoredSkill {
  name: string;
  skill_key: string;
  featured_position: number | null;
}

interface Endorser {
  skill_key: string;
  endorser_id: string;
  name: string;
  created_at: Date;
  is_connection: boolean;
}

/** The viewer's endorser line for one skill, or null when no endorser is the viewer or one of their connections. */
function endorserLine(endorsers: Endorser[], viewerId: string, ownerViewing: boolean): string | null {
  const total = endorsers.length;
  if (endorsers.some((endorser) => endorser.endorser_id === viewerId)) {
    return total === 1 ? 'Endorsed by you' : `Endorsed by you and ${others(total - 1)}`;
  }
  const known = endorsers
    .filter((endorser) => ownerViewing || endorser.is_connection)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const named = known[0];
  if (!named) return null;
  return total === 1 ? `Endorsed by ${named.name}` : `Endorsed by ${named.name} and ${others(total - 1)}`;
}

/**
 * The owner's skills in display order (featured first, then endorsement count and name), each with the
 * viewer's endorser line. Endorsements from members blocked with the viewer are left out of every count.
 */
export async function skillsFor(db: Db, viewerId: string, ownerId: string): Promise<SkillRow[]> {
  const skills = await rows<StoredSkill>(db, 'SELECT name, skill_key, featured_position FROM skills WHERE member_id = $1', [ownerId]);
  const endorsers = await rows<Endorser>(
    db,
    `SELECT e.skill_key, e.endorser_id, m.name, e.created_at, ${connectedWith('$1', 'e.endorser_id')} AS is_connection
       FROM endorsements e JOIN members m ON m.id = e.endorser_id
      WHERE e.owner_id = $2 AND ${notBlockedWith('$1', 'e.endorser_id')}`,
    [viewerId, ownerId],
  );
  const bySkill = new Map<string, Endorser[]>();
  for (const endorser of endorsers) bySkill.set(endorser.skill_key, [...(bySkill.get(endorser.skill_key) ?? []), endorser]);
  return skills
    .map((skill) => {
      const forSkill = bySkill.get(skill.skill_key) ?? [];
      return {
        name: skill.name,
        endorsements: forSkill.length,
        endorsed_by_me: forSkill.some((endorser) => endorser.endorser_id === viewerId),
        featured_position: skill.featured_position,
        endorser_line: endorserLine(forSkill, viewerId, viewerId === ownerId),
      };
    })
    .sort((a, b) => {
      if (a.featured_position !== null || b.featured_position !== null) {
        if (a.featured_position === null) return 1;
        if (b.featured_position === null) return -1;
        return a.featured_position - b.featured_position;
      }
      return b.endorsements - a.endorsements || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name);
    });
}

/** The skills section as saved: names in stored order and the featured names in order. */
export async function skillsSectionOf(db: Db, memberId: string): Promise<{ skills: string[]; featured: string[] }> {
  const stored = await rows<{ name: string; featured_position: number | null }>(db, 'SELECT name, featured_position FROM skills WHERE member_id = $1 ORDER BY position', [memberId]);
  return {
    skills: stored.map((skill) => skill.name),
    featured: stored.filter((skill) => skill.featured_position !== null).sort((a, b) => (a.featured_position ?? 0) - (b.featured_position ?? 0)).map((skill) => skill.name),
  };
}

function checkedNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string')) throw validation({ skills: 'Send the skills as a list of names.' });
  const names = (value as string[]).map((name) => name.trim());
  if (names.length > config.maxSkills) throw unprocessable('skill_limit', { limit: config.maxSkills });
  if (names.some((name) => lengthOutside(name, 1, config.skillNameMax))) throw validation({ skills: 'Each skill is 1 to 40 characters.' });
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw validation({ skills: 'Each skill can be listed once.' });
  return names;
}

function checkedFeatured(value: unknown, names: string[]): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string')) throw validation({ featured: 'Send the featured skills as a list of names.' });
  const featured = (value as string[]).map((name) => name.trim().toLowerCase());
  if (featured.length > config.featuredLimit) throw unprocessable('featured_limit', { limit: config.featuredLimit });
  const listed = new Set(names.map((name) => name.toLowerCase()));
  if (featured.some((name) => !listed.has(name)) || new Set(featured).size !== featured.length) {
    throw validation({ featured: 'Feature only skills you list, once each.' });
  }
  return featured;
}

/**
 * Replaces the member's skills. Skills that stay keep their endorsements; removed skills lose theirs. Without
 * `featured`, the featured skills that remain keep their order.
 */
export async function saveSkills(tx: Tx, memberId: string, namesInput: unknown, featuredInput: unknown): Promise<void> {
  const names = checkedNames(namesInput);
  const keys = names.map((name) => name.toLowerCase());
  const featured = featuredInput === undefined ? await keptFeatured(tx, memberId, keys) : checkedFeatured(featuredInput, names);
  await tx.query('DELETE FROM skills WHERE member_id = $1 AND NOT (skill_key = ANY($2::text[]))', [memberId, keys]);
  await tx.query('DELETE FROM endorsements WHERE owner_id = $1 AND NOT (skill_key = ANY($2::text[]))', [memberId, keys]);
  for (const [position, name] of names.entries()) {
    const place = featured.indexOf(name.toLowerCase());
    await tx.query(
      `INSERT INTO skills (member_id, name, skill_key, position, featured_position) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (member_id, skill_key) DO UPDATE SET name = $2, position = $4, featured_position = $5`,
      [memberId, name, name.toLowerCase(), position, place >= 0 ? place + 1 : null],
    );
  }
  publishAfterCommit(tx, 'all', { type: 'skills', member_id: memberId });
}

async function keptFeatured(tx: Tx, memberId: string, keys: string[]): Promise<string[]> {
  const current = await rows<{ skill_key: string }>(tx, 'SELECT skill_key FROM skills WHERE member_id = $1 AND featured_position IS NOT NULL ORDER BY featured_position', [memberId]);
  return current.map((skill) => skill.skill_key).filter((key) => keys.includes(key));
}

/** The stored skill of a member, matched ignoring case and locked against its removal; 404 when the member does not list it. */
export async function listedSkill(db: Db, ownerId: string, name: string): Promise<{ name: string; skill_key: string }> {
  const skill = await maybeRow<{ name: string; skill_key: string }>(db, 'SELECT name, skill_key FROM skills WHERE member_id = $1 AND skill_key = $2 FOR SHARE', [ownerId, name.toLowerCase()]);
  if (!skill) throw notFound();
  return skill;
}
