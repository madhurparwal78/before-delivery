import { one, pool, text } from '../db';
import { issueFileLink, readFileLink } from '../data/file-links';
import { apiError } from '../http/errors';
import { requireActor, type Route } from '../http/router';
import { getObject, photoExtension, type PhotoContentType } from '../services/storage';

export function photoFileName(photoId: string, contentType: PhotoContentType): string {
  return `${photoId}.${photoExtension(contentType)}`;
}

export const fileRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/photos/:id',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireActor(ctx);
      const row = await one(
        pool,
        `select p.id, p.object_key, p.content_type, d.beekeeper_id, orc.grower_id
           from photos p
           join samples s on s.id = p.sample_id
           join drops d on d.id = s.drop_id
           join orders o on o.id = p.order_id
           join orchards orc on orc.id = o.orchard_id
          where p.id = $1`,
        [ctx.params.id as string],
      );
      if (row === null) throw apiError.notFound();
      const allowed =
        actor.role === 'broker' ||
        (actor.role === 'grower' && text(row.grower_id) === actor.id) ||
        (actor.role === 'beekeeper' && text(row.beekeeper_id) === actor.id);
      if (!allowed) throw apiError.notFound();
      const objectKey = text(row.object_key);
      const contentType = text(row.content_type) as PhotoContentType;
      const location = await issueFileLink(pool, {
        objectKey,
        contentType,
        filename: photoFileName(text(row.id), contentType),
      });
      return { status: 302, headers: { Location: location, 'Cache-Control': 'private, no-store' } };
    },
  },
  {
    method: 'GET',
    path: '/files/:token',
    body: 'none',
    auth: 'public',
    handle: async (ctx) => {
      const link = await readFileLink(pool, ctx.params.token as string);
      if (link === null) throw apiError.notFound();
      if (link.expired) throw apiError.fileLinkExpired();
      const bytes = await getObject(link.objectKey);
      if (bytes === null) throw apiError.notFound();
      return {
        status: 200,
        bytes,
        headers: {
          'Content-Type': link.contentType,
          'Content-Security-Policy': "sandbox; default-src 'none'",
          'Content-Disposition': `inline; filename="${link.filename}"`,
          'Cache-Control': 'private, no-store',
        },
      };
    },
  },
];
