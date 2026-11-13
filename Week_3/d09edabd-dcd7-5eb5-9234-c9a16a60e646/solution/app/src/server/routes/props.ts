import { createHash, randomUUID } from 'node:crypto';
import { Fields, fail, notFound, tooLarge } from '../errors.js';
import { empty, json, route } from '../http.js';
import { store } from '../s3.js';
import { downloadReply, extensionOf, findProp, gltfType, parseMultipart, toProp, type PropRow } from '../domain/props.js';

const FILE_LIMIT = 5_000_000;
const SIZE_FIELDS = ['widthMm', 'depthMm', 'heightMm'] as const;

interface Upload {
  name: string;
  size: Record<(typeof SIZE_FIELDS)[number], number>;
  data: Buffer;
  contentType: string;
}

export function propRoutes(): void {
  route('POST', '/api/props', {
    auth: 'member',
    limit: 'multipart',
    validate: (ctx): Upload => {
      const { fields: text, file } = parseMultipart(ctx.header('content-type'), ctx.raw);
      if (file && file.data.length > FILE_LIMIT) throw tooLarge();
      const problems = new Fields();
      const name = (text.name ?? '').trim();
      if (name.length < 1 || name.length > 60) problems.add('name', 'must be 1 to 60 characters');
      const size = { widthMm: 0, depthMm: 0, heightMm: 0 };
      for (const key of SIZE_FIELDS) {
        const value = Number(text[key]);
        if (text[key] === undefined || !Number.isInteger(value) || value < 10 || value > 30_000) problems.add(key, 'must be a whole number from 10 to 30000');
        else size[key] = value;
      }
      const contentType = file ? gltfType(file.data) : null;
      if (!file || !contentType) problems.add('file', 'not a glTF 2.0 file');
      problems.check();
      return { name, size, data: file!.data, contentType: contentType! };
    },
    needs: ['storage'],
    transaction: true,
    run: async (ctx, _l, upload) => {
      const id = randomUUID();
      const inserted = await ctx.db.query<PropRow>(
        `INSERT INTO props (id, workspace_id, name, width_mm, depth_mm, height_mm, content_type, bytes, sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, ctx.actor.workspaceId, upload.name, upload.size.widthMm, upload.size.depthMm, upload.size.heightMm, upload.contentType, upload.data.length,
          createHash('sha256').update(upload.data).digest('hex')],
      );
      await store.put(`props/${id}.${extensionOf(upload.contentType)}`, upload.data, upload.contentType);
      return json(201, { prop: toProp(inserted.rows[0]!) });
    },
  });

  route('GET', '/api/props', {
    auth: 'member',
    run: async (ctx) => {
      const found = await ctx.db.query<PropRow>(`SELECT * FROM props WHERE workspace_id = $1 ORDER BY created_at DESC, id`, [ctx.actor.workspaceId]);
      return json(200, { props: found.rows.map(toProp) });
    },
  });

  route('GET', '/api/props/:propId/file', {
    auth: 'member',
    load: (ctx) => findProp(ctx.db, ctx.actor.workspaceId, ctx.params.propId!),
    needs: ['storage'],
    run: async (ctx, row) => {
      const file = await store.get(`props/${row.id}.${extensionOf(row.content_type)}`);
      if (!file) throw notFound();
      return downloadReply(file, row, ctx.header('if-none-match'));
    },
  });

  route('DELETE', '/api/props/:propId', {
    auth: 'member',
    transaction: true,
    load: (ctx) => findProp(ctx.db, ctx.actor.workspaceId, ctx.params.propId!, true),
    conflict: async (ctx, row) => {
      const used = await ctx.db.query(`SELECT 1 FROM placements WHERE prop_id = $1 AND deleted_at IS NULL LIMIT 1`, [row.id]);
      if (used.rows.length > 0) throw fail(409, 'prop_in_use');
    },
    needs: ['storage'],
    run: async (ctx, row) => {
      await ctx.db.query(`DELETE FROM props WHERE id = $1`, [row.id]);
      await store.remove(`props/${row.id}.${extensionOf(row.content_type)}`);
      return empty(204);
    },
  });
}
