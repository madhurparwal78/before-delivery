import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { pool } from '../db.js';
import { searchJobs } from '../domain/job-search.js';
import { searchPeople } from '../domain/people.js';
import { searchPosts } from '../domain/search-posts.js';
import { codePointLength } from '../domain/text.js';
import { validation } from '../errors.js';

const SEARCH_TEXT_MAX = 100;
const TYPES = ['people', 'posts', 'jobs'] as const;
const WORKPLACES = ['on-site', 'hybrid', 'remote'] as const;
const POSTED = ['day', 'week', 'month'] as const;

type Query = Record<string, unknown>;

const text = (query: Query, name: string): string => (typeof query[name] === 'string' ? (query[name] as string) : '');
const oneOf = <Value extends string>(options: readonly Value[], value: string): Value | null => options.find((option) => option === value) ?? null;

/** Ticked degrees; none ticked or all three ticked is no degree filter. */
function degreesOf(value: string): Array<'1' | '2' | '3'> {
  const ticked = (['1', '2', '3'] as const).filter((degree) => value.split(',').includes(degree));
  return ticked.length === 3 ? [] : ticked;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/search', async (request) => {
    const query = request.query as Query;
    const type = oneOf(TYPES, text(query, 'type'));
    if (!type) throw validation({ type: 'Choose people, posts or jobs.' });
    const q = text(query, 'q');
    if (codePointLength(q) > SEARCH_TEXT_MAX) throw validation({ q: 'Search text can be up to 100 characters.' });
    const cursor = text(query, 'cursor') || null;
    const viewer = memberOf(request);
    const page =
      type === 'people'
        ? await searchPeople(pool, viewer.id, { q, degrees: degreesOf(text(query, 'degree')), company: text(query, 'company'), location: text(query, 'location'), cursor })
        : type === 'posts'
          ? await searchPosts(pool, viewer.id, q, cursor)
          : await searchJobs(pool, viewer.id, { q, location: text(query, 'location'), workplace: oneOf(WORKPLACES, text(query, 'workplace')), posted: oneOf(POSTED, text(query, 'posted')), cursor });
    return { type, q, ...page };
  });
}
