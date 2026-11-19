import { one } from '../db.js';
import { notFound, storageUnavailable } from '../errors.js';
import { numericParam, requireViewer, route } from '../http.js';
import { extensionFor, contentTypeFor, type ImageFormat } from '../images.js';
import { StorageError, getObject } from '../storage.js';
import { findBoard, boardVisible } from '../domain/visibility.js';
import { pool } from '../db.js';

interface MediaRow {
  image_id: number;
  board_id: number;
  state: string;
  format: ImageFormat;
  variants: number[];
}

route('GET', '/media/:pin/:size', async (ctx) => {
  const viewer = requireViewer(ctx);
  const pinId = numericParam(ctx, 'pin');
  const row = await one<MediaRow>(
    `select p.image_id, p.board_id, p.state, i.format, i.variants
       from pins p join images i on i.id = p.image_id
      where p.id = $1`,
    [pinId],
  );
  if (!row || row.state !== 'live') throw notFound();
  const board = await findBoard(pool, row.board_id, viewer.id);
  if (!board || !boardVisible(board, viewer.id)) throw notFound();

  const size = ctx.params.size;
  let name: string;
  if (size === 'original') {
    name = 'original';
  } else {
    const width = Number(size);
    if (!row.variants.includes(width)) throw notFound();
    name = `w${width}`;
  }
  const key = `images/${row.image_id}/${name}.${extensionFor(row.format)}`;
  let object: { body: Buffer; contentType: string | null } | null;
  try {
    object = await getObject(key);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
  if (!object) throw notFound();
  ctx.res.writeHead(200, {
    'content-type': object.contentType ?? contentTypeFor(row.format),
    'content-length': String(object.body.length),
    'cache-control': 'private, max-age=60',
  });
  ctx.res.end(object.body);
});
