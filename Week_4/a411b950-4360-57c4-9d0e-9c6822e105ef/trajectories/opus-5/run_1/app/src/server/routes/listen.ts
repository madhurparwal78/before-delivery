import { query } from '../db/pool.ts';
import { linkStatus } from '../domain/linkStatus.ts';
import { isLinkableStatus } from '../../shared/projectStatus.ts';
import { gone, notFound, storageUnavailable } from '../errors.ts';
import { sendBytes, sendError, sendJson } from '../http/respond.ts';
import type { Handler, Route } from '../http/router.ts';
import { groupStems, PROJECT_COLUMNS, readStems, toStation, type ProjectRow } from '../repo/projects.ts';
import { getObject } from '../services/storage.ts';

const NO_STORE = { 'cache-control': 'no-store' } as const;
const CONTENT_TYPES = { wav: 'audio/wav', ogg: 'audio/ogg' } as const;

type LinkedProject = ProjectRow & { expires_at: Date; revoked_at: Date | null };

async function resolveLink(token: string, now: Date): Promise<LinkedProject> {
  const result = await query<LinkedProject>(
    `SELECT ${PROJECT_COLUMNS}, l.expires_at, l.revoked_at
       FROM listening_links l JOIN projects p ON p.id = l.project_id
      WHERE l.token = $1`,
    [token],
  );
  const link = result.rows[0];
  if (link === undefined) throw notFound('That listening link is not available.');
  const status = linkStatus(link, now);
  if (status === 'revoked' || !isLinkableStatus(link.status)) {
    throw notFound('That listening link is not available.');
  }
  if (status === 'expired') throw gone('link_expired', 'That listening link has expired.');
  return link;
}

function noStore(handler: Handler): Handler {
  return async (context) => {
    try {
      await handler(context);
    } catch (error) {
      sendError(context.response, error, NO_STORE);
    }
  };
}

export const listenRoutes: readonly Route[] = [
  {
    path: '/api/listen/:token',
    method: 'GET',
    handler: noStore(async ({ response, params, now }) => {
      const token = params.token as string;
      const link = await resolveLink(token, now);
      const stems = groupStems(await readStems([link.id]));
      const station = await toStation(
        link,
        stems.get(link.id) ?? [],
        (stemId) => `/api/listen/${token}/stems/${stemId}`,
      );
      sendJson(
        response,
        200,
        { station, expires_at: link.expires_at.toISOString(), nda: link.visibility === 'nda' },
        NO_STORE,
      );
    }),
  },
  {
    path: '/api/listen/:token/stems/:id',
    method: 'GET',
    handler: noStore(async ({ response, params, now }) => {
      const link = await resolveLink(params.token as string, now);
      const result = await query<{ object_key: string; format: 'wav' | 'ogg' }>(
        `SELECT object_key, format FROM stems WHERE id = $1 AND project_id = $2`,
        [params.id as string, link.id],
      );
      const stem = result.rows[0];
      if (stem === undefined) throw notFound('That stem does not exist.');
      const bytes = await getObject(stem.object_key);
      if (bytes === null) throw storageUnavailable();
      sendBytes(response, 200, bytes, { 'content-type': CONTENT_TYPES[stem.format], ...NO_STORE });
    }),
  },
];
