import { now, openJobSql, postedSince } from '../clock.js';
import { oneRow, rows, type Db } from '../db.js';
import { jobCards, type JobCard, type Workplace } from './jobs.js';
import { decodeCursor, encodeCursor, SEARCH_PAGE_SIZE, type Page } from './page.js';
import { escapeRegex } from './text.js';

interface JobSearch {
  q: string;
  location: string;
  workplace: Workplace | null;
  posted: 'day' | 'week' | 'month' | null;
  cursor: string | null;
}

/** Open jobs whose title or company name has every query word as a word prefix, newest posted first. */
export async function searchJobs(db: Db, viewerId: string, search: JobSearch): Promise<Page<JobCard>> {
  const at = now();
  const conditions = [openJobSql('j', '$1')];
  const params: unknown[] = [at];
  const add = (sql: (placeholder: string) => string, value: unknown): void => {
    params.push(value);
    conditions.push(sql(`$${params.length}`));
  };
  for (const word of search.q.toLowerCase().split(' ').filter((part) => part !== '')) {
    add((p) => `lower(j.title || ' ' || c.name) ~ ${p}`, `(^|\\s)${escapeRegex(word)}`);
  }
  if (search.location !== '') add((p) => `position(lower(${p}) in lower(j.location)) > 0`, search.location);
  if (search.workplace) add((p) => `j.workplace = ${p}`, search.workplace);
  if (search.posted) add((p) => `j.posted_at >= ${p}`, postedSince(at, search.posted));
  const from = 'FROM jobs j JOIN companies c ON c.id = j.company_id';
  const count = await oneRow<{ total: number }>(db, `SELECT count(*)::int AS total ${from} WHERE ${conditions.join(' AND ')}`, params);
  if (search.cursor) {
    const [postedAt, id] = decodeCursor<[string, string]>(search.cursor);
    params.push(new Date(postedAt), id);
    conditions.push(`(j.posted_at < $${params.length - 1} OR (j.posted_at = $${params.length - 1} AND j.id > $${params.length}))`);
  }
  const page = await rows<{ id: string; posted_at: Date }>(
    db,
    `SELECT j.id, j.posted_at ${from} WHERE ${conditions.join(' AND ')} ORDER BY j.posted_at DESC, j.id LIMIT ${SEARCH_PAGE_SIZE + 1}`,
    params,
  );
  const shown = page.slice(0, SEARCH_PAGE_SIZE);
  const last = shown[shown.length - 1];
  return {
    total: count.total,
    results: await jobCards(db, viewerId, shown.map((job) => job.id)),
    next_cursor: page.length > SEARCH_PAGE_SIZE && last ? encodeCursor([last.posted_at.toISOString(), last.id]) : null,
  };
}
