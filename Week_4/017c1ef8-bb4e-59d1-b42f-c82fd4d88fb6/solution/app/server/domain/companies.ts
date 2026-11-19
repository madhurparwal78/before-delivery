import { now, openJobSql } from '../clock.js';
import { maybeRow, oneRow, rows, type Db } from '../db.js';
import { forbidden, notFound, validation } from '../errors.js';
import { isCompanyAdmin } from './company-admins.js';
import { jobCards } from './jobs.js';
import { personCards, type PersonCard } from './people.js';
import { notBlockedWith } from './visibility.js';
import { lengthOutside } from './text.js';

interface CompanyRow {
  id: string;
  handle: string;
  name: string;
  location: string;
  about: string;
}

async function requireCompany(db: Db, handle: string): Promise<CompanyRow> {
  const company = await maybeRow<CompanyRow>(db, 'SELECT id, handle, name, location, about FROM companies WHERE handle = $1', [handle]);
  if (!company) throw notFound();
  return company;
}

export async function companyPage(db: Db, viewerId: string, handle: string): Promise<Record<string, unknown>> {
  const company = await requireCompany(db, handle);
  const followers = await oneRow<{ followers: number }>(
    db,
    `SELECT count(*)::int AS followers FROM follows f JOIN members m ON m.id = f.follower_id
      WHERE f.target_id = $2 AND ${notBlockedWith('$1', 'm.id')}`,
    [viewerId, company.id],
  );
  const following = await maybeRow(db, 'SELECT 1 FROM follows WHERE follower_id = $1 AND target_id = $2', [viewerId, company.id]);
  const open = await rows<{ id: string }>(
    db,
    `SELECT j.id FROM jobs j WHERE j.company_id = $1 AND ${openJobSql('j', '$2')} ORDER BY j.posted_at DESC, j.id`,
    [company.id, now()],
  );
  return {
    ...company,
    follower_count: followers.followers,
    following: following !== undefined,
    is_admin: await isCompanyAdmin(db, viewerId, company.id),
    open_jobs: await jobCards(db, viewerId, open.map((job) => job.id)),
  };
}

const LIMITS = {
  name: { min: 1, max: 100, message: 'Enter a name of 1 to 100 characters.' },
  location: { min: 0, max: 100, message: 'Enter a location of up to 100 characters.' },
  about: { min: 0, max: 2000, message: 'About can be up to 2,000 characters.' },
} as const;

export async function updateCompany(db: Db, viewerId: string, handle: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const company = await requireCompany(db, handle);
  if (!(await isCompanyAdmin(db, viewerId, company.id))) throw forbidden('not_admin');
  const fields: Record<string, string> = {};
  const next: Record<'name' | 'location' | 'about', string | null> = { name: null, location: null, about: null };
  for (const key of ['name', 'location', 'about'] as const) {
    if (input[key] === undefined) continue;
    const value = typeof input[key] === 'string' ? (input[key] as string).trim() : '';
    const { min, max, message } = LIMITS[key];
    if (lengthOutside(value, min, max)) fields[key] = message;
    next[key] = value;
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  // One statement keeps only the fields sent, so two admins saving different fields never overwrite each other.
  await db.query('UPDATE companies SET name = coalesce($2, name), location = coalesce($3, location), about = coalesce($4, about) WHERE id = $1', [company.id, next.name, next.location, next.about]);
  return companyPage(db, viewerId, handle);
}

/** The admins' follower list: the members following the company that the viewer may see. */
export async function companyFollowers(db: Db, viewerId: string, handle: string): Promise<PersonCard[]> {
  const company = await requireCompany(db, handle);
  if (!(await isCompanyAdmin(db, viewerId, company.id))) throw forbidden('not_admin');
  const followers = await rows<{ id: string }>(
    db,
    'SELECT follower_id AS id FROM follows WHERE target_id = $1 ORDER BY created_at DESC, follower_id',
    [company.id],
  );
  return personCards(db, viewerId, followers.map((follower) => follower.id));
}
