import { Router, type RequestContext, validationError } from '../http/types.js';
import { ApiError } from '../errors.js';
import { bodyOf, readMultipart, MULTIPART_BODY_LIMIT } from '../http/body.js';
import { sendJson, sendRaw } from '../http/respond.js';
import { requireRole } from './session.js';
import { getModelBySlug, type ModelRow } from '../domain/models.js';
import { applyTransition } from '../domain/models.js';
import { uploadStatus, getUpload } from '../queue/runner.js';
import { getObject, putObject, originalKey, textureSetKey } from '../providers/storage.js';
import { sha256Hex, randomToken, charCount } from '../domain/ids.js';
import { query, one } from '../db/db.js';
import { isPng, isJpeg, isZip, pathEscapes } from '../geometry/zip.js';

/** Contributor routes see only the caller's own models; anything else answers 404. */
async function ownModel(ctx: RequestContext, slug: string): Promise<ModelRow> {
  const user = await requireRole(ctx, ['contributor']);
  const model = await getModelBySlug(slug);
  if (model === null || model.owner_id !== user.id) throw new ApiError(404, 'not_found');
  return model;
}

export function registerContribRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/contrib/models',
    allowedParams: [],
    handler: async ctx => {
      const user = await requireRole(ctx, ['contributor']);
      const rows = await query<ModelRow>(
        'SELECT * FROM models WHERE owner_id = $1 ORDER BY created_at DESC, id DESC',
        [user.id],
      );
      sendJson(ctx, 200, {
        items: rows.rows.map(model => ({
          slug: model.slug,
          title: model.title,
          state: model.state,
          category: model.category,
          created_at: model.created_at,
        })),
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/contrib/models/:slug',
    allowedParams: [],
    handler: async ctx => {
      const model = await ownModel(ctx, ctx.params['slug'] ?? '');
      const upload = await one<{ ref: string }>(
        `SELECT u.ref FROM uploads u JOIN model_revisions r ON r.id = u.revision_id
         WHERE r.model_id = $1 AND r.revision_no = $2 ORDER BY u.created_at DESC LIMIT 1`,
        [model.id, model.revision_count],
      );
      sendJson(ctx, 200, {
        slug: model.slug,
        title: model.title,
        state: model.state,
        category: model.category,
        description: model.description,
        latest_upload: upload?.ref ?? null,
        created_at: model.created_at,
      });
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/contrib/models',
    allowedParams: [],
    multipart: true,
    handler: async ctx => {
      await requireRole(ctx, ['contributor']);
      const { ingestUpload } = await import('../uploads/ingest.js');
      await ingestUpload(ctx, 'contrib');
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/contrib/uploads/:ref',
    allowedParams: [],
    handler: async ctx => {
      const user = await requireRole(ctx, ['contributor']);
      const data = await getUpload(ctx.params['ref'] ?? '');
      if (data === null || data.model.owner_id !== user.id) throw new ApiError(404, 'not_found');
      const status = await uploadStatus(data.upload.ref);
      sendJson(ctx, 200, status);
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/contrib/models/:slug/submit',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      const user = await requireRole(ctx, ['contributor']);
      const body = bodyOf(ctx);
      for (const key of Object.keys(body)) {
        if (key !== 'to') throw validationError({ [key]: 'Unknown field.' });
      }
      const slug = ctx.params['slug'] ?? '';
      const model = await getModelBySlug(slug);
      if (model === null || model.owner_id !== user.id) throw new ApiError(404, 'not_found');
      const result = await applyTransition(slug, 'in_review', {
        role: 'contributor',
        userId: user.id,
        isOwner: true,
      });
      sendJson(ctx, 200, result);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/contrib/models/:slug/original',
    allowedParams: [],
    handler: async ctx => {
      const model = await ownModel(ctx, ctx.params['slug'] ?? '');
      const revision = await one<{ source_checksum: string; source_name: string }>(
        'SELECT source_checksum, source_name FROM model_revisions WHERE model_id = $1 AND revision_no = $2',
        [model.id, model.revision_count],
      );
      if (revision === null) throw new ApiError(404, 'not_found');
      const buffer = await getObject(originalKey(revision.source_checksum));
      sendRaw(ctx, 200, buffer, 'application/octet-stream', {
        'Content-Disposition': `attachment; filename="${revision.source_name}"`,
        'X-Checksum-SHA256': revision.source_checksum,
      });
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/contrib/texture-sets',
    allowedParams: [],
    multipart: true,
    handler: async ctx => {
      const user = await requireRole(ctx, ['contributor']);
      const contentType = ctx.req.headers['content-type'] ?? '';
      const { fields, files } = await readMultipart(ctx.req, contentType, MULTIPART_BODY_LIMIT);
      const slug = fields.get('model') ?? '';
      const name = fields.get('name') ?? '';
      const file = files.get('file');
      const model = await getModelBySlug(slug);
      if (model === null || model.owner_id !== user.id) throw new ApiError(404, 'not_found');
      if (file === undefined) throw validationError({ file: 'Choose a file to upload.' });
      if (charCount(name) < 1 || charCount(name) > 60) {
        throw validationError({ name: `Use 1 to 60 characters that no other collection or key uses.` });
      }
      if (!isZip(file.data)) throw new ApiError(415, 'unsupported_type');
      const { readZip } = await import('../geometry/zip.js');
      const entries = readZip(file.data);
      for (const entry of entries) {
        if (pathEscapes(entry.name)) {
          throw validationError({ file: 'The package contains a path outside its folder.' });
        }
        if (!isPng(entry.data) && !isJpeg(entry.data)) {
          throw validationError({ file: 'Every file in a texture set must be a PNG or JPEG image.' });
        }
      }
      const checksum = sha256Hex(file.data);
      await putObject(textureSetKey(checksum), file.data, 'application/zip');
      const ref = `ts_${randomToken(12).replace(/[^A-Za-z0-9]/g, 'a')}`;
      await query(
        'INSERT INTO texture_sets (ref, model_id, name, checksum, images) VALUES ($1, $2, $3, $4, $5)',
        [ref, model.id, name, checksum, entries.length],
      );
      sendJson(ctx, 201, {
        texture_set: ref,
        model: model.slug,
        images: entries.length,
        checksum,
      });
    },
  });
}
