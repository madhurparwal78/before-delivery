import { accessPost } from '../context';
import { pool } from '../db';
import { notFound, serviceUnavailable } from '../errors';
import type { Ctx, Router } from '../http';
import { markService } from '../services';
import { getObject } from '../storage';
import { isImageType } from '../uploads';

const serveAttachment = async (ctx: Ctx): Promise<void> => {
  const result = await pool.query<{ post_id: string; file_name: string; content_type: string; object_key: string }>(
    'select post_id, file_name, content_type, object_key from attachments where id::text = $1',
    [ctx.params.id],
  );
  const attachment = result.rows[0];
  if (attachment === undefined) throw notFound();
  await accessPost(pool, ctx, attachment.post_id);

  let bytes: Buffer;
  try {
    bytes = await getObject(attachment.object_key);
    markService('storage', true);
  } catch {
    markService('storage', false);
    throw serviceUnavailable('storage');
  }
  const disposition = isImageType(attachment.content_type) ? 'inline' : 'attachment';
  ctx.send(
    200,
    {
      'Content-Type': attachment.content_type,
      'Content-Disposition': `${disposition}; filename="${attachment.file_name.replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
    bytes,
  );
};

export const registerAttachmentRoutes = (router: Router): void => {
  router.add('GET', '/api/attachments/:id', serveAttachment);
};
