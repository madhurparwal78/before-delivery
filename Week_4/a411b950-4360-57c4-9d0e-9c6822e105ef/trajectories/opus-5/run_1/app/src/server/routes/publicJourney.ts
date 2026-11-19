import { query } from '../db/pool.ts';
import { businessMonth, monthLabel } from '../../shared/dates.ts';
import { notFound, storageUnavailable, validation } from '../errors.ts';
import { PUBLICLY_VISIBLE_SQL } from '../../shared/projectStatus.ts';
import { sendBytes, sendJson } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import {
  groupStems,
  PROJECT_COLUMNS,
  readStems,
  toStation,
  type ProjectRow,
  type Station,
} from '../repo/projects.ts';
import { readMonthsFrom } from '../repo/months.ts';
import { readSettings } from '../repo/settings.ts';
import { getObject } from '../services/storage.ts';

const CONTENT_TYPES = { wav: 'audio/wav', ogg: 'audio/ogg' } as const;

async function publicProjects(): Promise<ProjectRow[]> {
  const result = await query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects p
      WHERE ${PUBLICLY_VISIBLE_SQL}
      ORDER BY p.position ASC, p.title ASC`,
  );
  return result.rows;
}

export const publicJourneyRoutes: readonly Route[] = [
  {
    path: '/api/health',
    method: 'GET',
    handler: async ({ response }) => {
      sendJson(response, 200, { status: 'ok' });
    },
  },
  {
    path: '/api/journey',
    method: 'GET',
    handler: async ({ response }) => {
      const projects = await publicProjects();
      const stems = groupStems(await readStems(projects.map((project) => project.id)));
      const stations: Station[] = [];
      for (const project of projects) {
        stations.push(
          await toStation(project, stems.get(project.id) ?? [], (stemId) => `/api/stems/${stemId}`),
        );
      }
      sendJson(response, 200, { stations });
    },
  },
  {
    path: '/api/search',
    method: 'GET',
    handler: async ({ response, search }) => {
      const term = search.get('q');
      if (term === null || term === '' || term.length > 100) {
        throw validation({ q: 'Search for 1 to 100 characters.' });
      }
      const result = await query<{ slug: string; title: string; credit_type: 'shipped' | 'jam' | 'redesign' }>(
        `SELECT p.slug, p.title, p.credit_type FROM projects p
          WHERE ${PUBLICLY_VISIBLE_SQL}
            AND (p.title ILIKE $1 OR p.credit_line ILIKE $1 OR p.blurb ILIKE $1
                 OR EXISTS (SELECT 1 FROM unnest(p.tags) AS tag WHERE tag ILIKE $1))
          ORDER BY p.position ASC, p.title ASC`,
        [`%${term.replace(/[%_\\]/g, (character) => `\\${character}`)}%`],
      );
      const labels = { shipped: 'Shipped title', jam: 'Game jam', redesign: 'Redesign' } as const;
      sendJson(response, 200, {
        results: result.rows.map((row) => ({
          slug: row.slug,
          title: row.title,
          credit_label: labels[row.credit_type],
        })),
      });
    },
  },
  {
    path: '/api/stems/:id',
    method: 'GET',
    handler: async ({ response, params }) => {
      const id = params.id as string;
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('That stem does not exist.');
      const result = await query<{ object_key: string; format: 'wav' | 'ogg' }>(
        `SELECT s.object_key, s.format FROM stems s
           JOIN projects p ON p.id = s.project_id
          WHERE s.id = $1 AND ${PUBLICLY_VISIBLE_SQL}`,
        [id],
      );
      const stem = result.rows[0];
      if (stem === undefined) throw notFound('That stem does not exist.');
      const bytes = await getObject(stem.object_key);
      if (bytes === null) throw storageUnavailable();
      sendBytes(response, 200, bytes, { 'content-type': CONTENT_TYPES[stem.format], 'cache-control': 'no-store' });
    },
  },
  {
    path: '/api/months',
    method: 'GET',
    handler: async ({ response, now }) => {
      const settings = await readSettings();
      const months = await readMonthsFrom(businessMonth(now, settings.time_zone));
      sendJson(response, 200, {
        months: months
          .filter((month) => month.open)
          .map((month) => ({ month: month.month, label: monthLabel(month.month) })),
      });
    },
  },
];
