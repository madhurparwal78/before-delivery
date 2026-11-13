import { db, one } from '../db';
import { config } from '../config';
import { fail } from '../errors';
import { endpoint, reply } from '../http';
import { newId, newToken } from '../ids';
import { checkVersion, latestReport, publishVersion } from '../domain/publish';
import { versionOfPage, versionScope } from '../domain/scopes';
import type { PreviewLinkJson } from '../../shared/types';

export function publishingRoutes(): void {
  endpoint('POST', '/api/versions/:versionId/check', {
    access: 'editor',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (_ctx, version) => reply.json(200, await checkVersion(version)),
  });

  endpoint('POST', '/api/versions/:versionId/publish', {
    access: 'editor',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (ctx, version) => {
      const key = ctx.req.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 1 || key.length > 100) {
        throw fail.keyRequired();
      }
      const outcome = await publishVersion(version, key);
      return reply.json(outcome.status, outcome.body);
    },
  });

  endpoint('GET', '/api/versions/:versionId/publish-report', {
    access: 'member',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (_ctx, version) => reply.json(200, await latestReport(db, version.id)),
  });

  endpoint('POST', '/api/pages/:pageId/preview-links', {
    access: 'editor',
    prepare: (ctx) => versionOfPage(ctx.principal, ctx.params.pageId ?? ''),
    handle: async (ctx) => {
      const id = newId('lnk');
      const token = newToken();
      const rows = await db.query<{ expiresAt: Date }>(
        `insert into preview_links (id, page_id, token, expires_at)
         select $1, $2, $3, now() + ($4 || ' milliseconds')::interval where exists (select 1 from pages where id = $2 and not removed)
         returning expires_at`,
        [id, ctx.params.pageId, token, String(config.previewLinkTtlMs)],
      );
      const [created] = rows;
      if (created === undefined) {
        throw fail.pageRemoved();
      }
      const link: PreviewLinkJson = { id, url: `/preview/${token}`, expiresAt: created.expiresAt.toISOString() };
      return reply.json(201, link);
    },
  });

  endpoint('GET', '/api/pages/:pageId/preview-links', {
    access: 'member',
    prepare: (ctx) => versionOfPage(ctx.principal, ctx.params.pageId ?? ''),
    handle: async (ctx) => {
      const rows = await db.query<{ id: string; token: string; expiresAt: Date; revoked: boolean }>(
        'select id, token, expires_at, revoked from preview_links where page_id = $1 order by created_at desc, id',
        [ctx.params.pageId],
      );
      const links: PreviewLinkJson[] = rows.map((row) => ({ id: row.id, url: `/preview/${row.token}`, expiresAt: row.expiresAt.toISOString(), revoked: row.revoked }));
      return reply.json(200, links);
    },
  });

  endpoint('DELETE', '/api/preview-links/:linkId', {
    access: 'editor',
    prepare: async (ctx) => {
      const link = await one<{ id: string }>(
        db,
        `select l.id from preview_links l join pages p on p.id = l.page_id join versions v on v.id = p.version_id join sites s on s.id = v.site_id
          where l.id = $1 and s.team_id = $2`,
        [ctx.params.linkId, ctx.principal.teamId],
      );
      if (link === null) {
        throw fail.notFound();
      }
      return link;
    },
    handle: async (_ctx, link) => {
      await db.query('update preview_links set revoked = true where id = $1', [link.id]);
      return reply.empty(204);
    },
  });
}
