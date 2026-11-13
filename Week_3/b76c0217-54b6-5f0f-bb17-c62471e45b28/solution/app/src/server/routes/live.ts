import { copy } from '../../shared/copy';
import { db, one } from '../db';
import { fail } from '../errors';
import { openEditorStream } from '../events';
import { endpoint, reply } from '../http';
import { newId } from '../ids';
import { loadAnalytics } from '../domain/analytics';
import { siteScope, versionScope } from '../domain/scopes';
import { putObject, StorageUnavailableError } from '../storage';

export function liveRoutes(): void {
  endpoint('POST', '/api/sites/:siteId/assets', {
    access: 'editor',
    body: 'image',
    prepare: (ctx) => siteScope(ctx.principal, ctx.params.siteId ?? ''),
    handle: async (ctx, site) => {
      if (ctx.raw.length === 0) {
        throw fail.validation({ body: 'Send the image as the request body.' });
      }
      const id = newId('img');
      const contentType = ctx.req.headers['content-type']?.split(';')[0] ?? '';
      try {
        await putObject(`sites/${site.id}/assets/${id}`, ctx.raw, contentType);
      } catch (error) {
        throw error instanceof StorageUnavailableError ? fail.storageUnavailable(copy.imageOutage) : error;
      }
      await db.query('insert into assets (id, site_id, content_type) values ($1, $2, $3)', [id, site.id, contentType]);
      return reply.json(201, { id, url: `/assets/${site.slug}/${id}` });
    },
  });

  endpoint('GET', '/api/sites/:siteId/analytics', {
    access: 'member',
    prepare: (ctx) => siteScope(ctx.principal, ctx.params.siteId ?? ''),
    handle: async (_ctx, site) => reply.json(200, await loadAnalytics(site.id)),
  });

  endpoint('GET', '/api/events', {
    access: 'member',
    prepare: async (ctx) => {
      const versionId = ctx.url.searchParams.get('versionId');
      const pageId = ctx.url.searchParams.get('pageId');
      if (versionId !== null) {
        await versionScope(ctx.principal, versionId);
      }
      if (pageId !== null && (await one(db, 'select 1 as x from pages p join versions v on v.id = p.version_id join sites s on s.id = v.site_id where p.id = $1 and s.team_id = $2', [pageId, ctx.principal.teamId])) === null) {
        throw fail.notFound();
      }
      return { versionId, pageId };
    },
    handle: async (ctx, scope) =>
      reply.stream((sink) =>
        openEditorStream(sink, { teamId: ctx.principal.teamId, user: { id: ctx.principal.user.id, name: ctx.principal.user.name }, role: ctx.principal.role, ...scope }),
      ),
  });
}
