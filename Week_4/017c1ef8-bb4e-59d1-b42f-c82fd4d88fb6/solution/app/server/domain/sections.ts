import { oneRow, rows, type Db, type Tx, publishAfterCommit } from '../db.js';
import { conflict, notFound, validation } from '../errors.js';
import { newId } from '../ids.js';
import { educationOf, experienceOf } from './profile-projection.js';
import { saveSkills, skillsSectionOf } from './skills.js';
import { lengthOutside } from './text.js';

type Section = 'intro' | 'about' | 'experience' | 'education' | 'skills';

const VERSION_COLUMN: Record<Section, string> = {
  intro: 'version_intro',
  about: 'version_about',
  experience: 'version_experience',
  education: 'version_education',
  skills: 'version_skills',
};

const isSection = (value: string): value is Section => Object.hasOwn(VERSION_COLUMN, value);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function checkLength(fields: Record<string, string>, field: string, value: string, min: number, max: number, message: string): void {
  if (lengthOutside(value, min, max)) fields[field] = message;
}

interface Period {
  start: string;
  end: string | null;
}

/** The shared date fields of an experience or education entry. */
function checkPeriod(fields: Record<string, string>, prefix: string, raw: Record<string, unknown>): Period {
  const start = text(raw.start);
  const end = raw.end === null || raw.end === undefined || raw.end === '' ? null : text(raw.end);
  if (!MONTH.test(start)) fields[`${prefix}.start`] = 'Use YYYY-MM.';
  if (end !== null && !MONTH.test(end)) fields[`${prefix}.end`] = 'Use YYYY-MM or leave it empty.';
  else if (end !== null && MONTH.test(start) && end < start) fields[`${prefix}.end`] = 'End must be after start.';
  return { start, end };
}

function entriesOf(value: unknown, field: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'object' || entry === null)) throw validation({ [field]: 'Send a list.' });
  return value as Array<Record<string, unknown>>;
}

async function currentOf(db: Db, memberId: string, section: Section): Promise<Record<string, unknown>> {
  switch (section) {
    case 'intro':
      return (await rows<Record<string, unknown>>(db, 'SELECT name, headline, location FROM members WHERE id = $1', [memberId]))[0] ?? {};
    case 'about':
      return (await rows<Record<string, unknown>>(db, 'SELECT about FROM members WHERE id = $1', [memberId]))[0] ?? {};
    case 'experience':
      return { experience: await experienceOf(db, memberId) };
    case 'education':
      return { education: await educationOf(db, memberId) };
    case 'skills':
      return skillsSectionOf(db, memberId);
  }
}

async function apply(tx: Tx, memberId: string, section: Section, body: Record<string, unknown>): Promise<void> {
  const db = tx;
  const fields: Record<string, string> = {};
  switch (section) {
    case 'intro': {
      const name = text(body.name).trim();
      const headline = text(body.headline);
      const location = text(body.location);
      checkLength(fields, 'name', name, 1, 80, 'Enter a name of 1 to 80 characters.');
      checkLength(fields, 'headline', headline, 0, 120, 'Use up to 120 characters.');
      checkLength(fields, 'location', location, 0, 80, 'Use up to 80 characters.');
      if (Object.keys(fields).length > 0) throw validation(fields);
      await db.query('UPDATE members SET name = $2, headline = $3, location = $4 WHERE id = $1', [memberId, name, headline, location]);
      return;
    }
    case 'about': {
      const about = text(body.about);
      checkLength(fields, 'about', about, 0, 2000, 'Use up to 2,000 characters.');
      if (Object.keys(fields).length > 0) throw validation(fields);
      await db.query('UPDATE members SET about = $2 WHERE id = $1', [memberId, about]);
      return;
    }
    case 'experience': {
      const entries = entriesOf(body.experience, 'experience');
      const checked = entries.map((raw, index) => {
        const prefix = `experience.${index}`;
        const title = text(raw.title).trim();
        const company = text(raw.company).trim();
        checkLength(fields, `${prefix}.title`, title, 1, 100, 'Enter 1 to 100 characters.');
        checkLength(fields, `${prefix}.company`, company, 1, 100, 'Enter 1 to 100 characters.');
        return { title, company, ...checkPeriod(fields, prefix, raw) };
      });
      if (Object.keys(fields).length > 0) throw validation(fields);
      await db.query('DELETE FROM member_experience WHERE member_id = $1', [memberId]);
      for (const [position, entry] of checked.entries()) {
        await db.query('INSERT INTO member_experience (id, member_id, position, title, company, start, "end") VALUES ($1, $2, $3, $4, $5, $6, $7)', [newId(), memberId, position, entry.title, entry.company, entry.start, entry.end]);
      }
      return;
    }
    case 'education': {
      const entries = entriesOf(body.education, 'education');
      const checked = entries.map((raw, index) => {
        const prefix = `education.${index}`;
        const school = text(raw.school).trim();
        const degree = text(raw.degree).trim();
        checkLength(fields, `${prefix}.school`, school, 1, 100, 'Enter 1 to 100 characters.');
        checkLength(fields, `${prefix}.degree`, degree, 1, 100, 'Enter 1 to 100 characters.');
        return { school, degree, ...checkPeriod(fields, prefix, raw) };
      });
      if (Object.keys(fields).length > 0) throw validation(fields);
      await db.query('DELETE FROM member_education WHERE member_id = $1', [memberId]);
      for (const [position, entry] of checked.entries()) {
        await db.query('INSERT INTO member_education (id, member_id, position, school, degree, start, "end") VALUES ($1, $2, $3, $4, $5, $6, $7)', [newId(), memberId, position, entry.school, entry.degree, entry.start, entry.end]);
      }
      return;
    }
    case 'skills':
      await saveSkills(tx, memberId, body.skills, body.featured);
  }
}

interface SavedSection {
  section: Section;
  version: number;
  current: Record<string, unknown>;
}

/**
 * Saves one profile section against the version the member read. A stale version is the 409 carrying the current
 * values; otherwise the section is replaced and its version rises by one.
 */
export async function saveSection(tx: Tx, memberId: string, section: string, body: Record<string, unknown>): Promise<SavedSection> {
  if (!isSection(section)) throw notFound();
  const column = VERSION_COLUMN[section];
  const stored = await oneRow<{ version: number }>(tx, `SELECT ${column} AS version FROM members WHERE id = $1 FOR UPDATE`, [memberId]);
  if (!Number.isInteger(body.version)) throw validation({ version: 'Send the version you read.' });
  if (body.version !== stored.version) {
    throw conflict('version_conflict', { section, current_version: stored.version, current: await currentOf(tx, memberId, section) });
  }
  await apply(tx, memberId, section, body);
  const version = stored.version + 1;
  await tx.query(`UPDATE members SET ${column} = $2 WHERE id = $1`, [memberId, version]);
  return { section, version, current: await currentOf(tx, memberId, section) };
}

const VISIBILITIES = ['public', 'connections', 'private'];

/** The owner's visibility setting. Others' views (paths, placeholders) change with it, so every open page refreshes. */
export async function saveVisibility(tx: Tx, memberId: string, visibility: unknown): Promise<string> {
  if (typeof visibility !== 'string' || !VISIBILITIES.includes(visibility)) throw validation({ visibility: 'Choose Public, Connections only or Private.' });
  await tx.query('UPDATE members SET visibility = $2 WHERE id = $1', [memberId, visibility]);
  publishAfterCommit(tx, 'all', { type: 'graph', members: [memberId] });
  return visibility;
}
