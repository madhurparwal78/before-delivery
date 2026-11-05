import { Router, type RequestContext, validationError } from '../http/types.js';
import { ApiError } from '../errors.js';
import { bodyOf, readMultipart, MULTIPART_BODY_LIMIT } from '../http/body.js';
import { sendJson, sendRaw } from '../http/respond.js';
import { requireRole, type User } from './session.js';
import {
  applyTransition,
  getModelBySlug,
  studioSummary,
  type ModelRow,
  searchDocOf,
} from '../domain/models.js';
import { planOf } from '../domain/plans.js';
import { planState, quotaInfo, changePlan } from '../domain/plan-service.js';
import type { PlanId } from '../domain/plans.js';
import { charCount, hashPassword, randomToken, slugFromTitle } from '../domain/ids.js';
import { createUpload, uploadStatus, requeueUpload, getUpload } from '../queue/runner.js';
import { getObject, originalKey } from '../providers/storage.js';
import { query, one, withTransaction } from '../db/db.js';
import { deleteDoc } from '../providers/search.js';
import { idempotent } from '../domain/idempotency.js';
import { idempotencyKeyOf } from './checkout.js';
import { allIndexed } from '../providers/search.js';
import { hasPendingRemovals } from '../domain/models.js';
import { hashKey } from '../domain/api-keys.js';
import { validCamera, type Camera } from '../domain/viewer.js';
import { editionRemaining } from '../domain/commerce.js';
import { modelDetailOf } from './public.js';
import { centsFromEurosText } from '../domain/money.js';

const VISIBILITIES = ['public', 'unlisted', 'private', 'password'];
const CATEGORIES = ['hard-surface', 'miniature', 'scan'];
const UNITS = ['mm', 'cm', 'm', 'in'];

export function registerStudioRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/studio/summary',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const summary = await withTransaction(async client => studioSummary(client));
      sendJson(ctx, 200, summary);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/studio/models',
    allowedParams: ['state'],
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const state = ctx.query.get('state');
      if (state !== null && !['draft', 'in_review', 'published', 'withdrawn'].includes(state)) {
        throw validationError({ state: 'Choose one of the listed values.' });
      }
      const rows = await query<ModelRow>(
        state === null
          ? 'SELECT * FROM models ORDER BY created_at DESC, id DESC'
          : 'SELECT * FROM models WHERE state = $1 ORDER BY created_at DESC, id DESC',
        state === null ? [] : [state],
      );
      const items = [];
      for (const model of rows.rows) {
        const upload = await one<{ status: string }>(
          `SELECT u.status FROM uploads u JOIN model_revisions r ON r.id = u.revision_id
           WHERE r.model_id = $1 AND r.revision_no = $2`,
          [model.id, model.revision_count],
        );
        items.push({
          slug: model.slug,
          title: model.title,
          state: model.state,
          visibility: model.visibility,
          read_only: model.read_only,
          price_from_cents: searchDocOf(model).price_from_cents,
          queue_status: upload?.status === 'in_progress' ? 'in_progress' : upload?.status === 'failed' ? 'failed' : upload?.status === 'completed' ? 'completed' : 'none',
        });
      }
      sendJson(ctx, 200, { items });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/studio/models/:slug',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const detail = await studioDetail(ctx.params['slug'] ?? '');
      sendJson(ctx, 200, detail);
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/studio/models/:slug',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const slug = ctx.params['slug'] ?? '';
      const body = bodyOf(ctx);
      const fields: Record<string, string> = {};
      for (const key of Object.keys(body)) {
        if (!['title', 'description', 'category', 'visibility', 'password', 'prices', 'discount_percent', 'edition_total', 'edition_price_cents'].includes(key)) {
          throw validationError({ [key]: 'Unknown field.' });
        }
      }
      const model = await getModelBySlug(slug);
      if (model === null) throw new ApiError(404, 'not_found');
      if (model.read_only) throw new ApiError(409, 'read_only');

      const state = await planState();
      const plan = planOf(state.plan);
      const updates: Record<string, unknown> = {};
      let visibilityChange = false;
      let passwordChange = false;

      if (body['title'] !== undefined) {
        const title = typeof body['title'] === 'string' ? body['title'] : '';
        if (charCount(title) < 1 || charCount(title) > 120) fields['title'] = 'Enter a title of 1 to 120 characters.';
        else updates['title'] = title;
      }
      if (body['description'] !== undefined) {
        const description = typeof body['description'] === 'string' ? body['description'] : '';
        if (charCount(description) > 2000) fields['description'] = 'Keep the description to 2000 characters.';
        else updates['description'] = description;
      }
      if (body['category'] !== undefined) {
        if (!CATEGORIES.includes(String(body['category']))) fields['category'] = 'Choose one of the listed values.';
        else updates['category'] = body['category'];
      }
      if (body['visibility'] !== undefined) {
        const visibility = String(body['visibility']);
        if (!VISIBILITIES.includes(visibility)) fields['visibility'] = 'Choose one of the listed values.';
        else {
          updates['visibility'] = visibility;
          visibilityChange = visibility !== model.visibility;
          if (visibility === 'password') {
            const password = typeof body['password'] === 'string' ? body['password'] : '';
            if (charCount(password) < 8 || charCount(password) > 64) fields['password'] = 'Use 8 to 64 characters.';
            else {
              updates['password_hash'] = hashPassword(password);
              passwordChange = true;
            }
          }
        }
      }
      if (body['password'] !== undefined && String(body['visibility'] ?? model.visibility) !== 'password') {
        fields['password'] = 'Use 8 to 64 characters.';
      }
      if (body['prices'] !== undefined) {
        const prices = body['prices'];
        if (typeof prices !== 'object' || prices === null || Array.isArray(prices)) {
          fields['price'] = 'Enter a price from 1.00 to 1000.00 euros.';
        } else {
          for (const key of Object.keys(prices)) {
            if (!['personal_cents', 'commercial_cents', 'studio_cents'].includes(key)) throw validationError({ [key]: 'Unknown field.' });
          }
          for (const key of ['personal_cents', 'commercial_cents', 'studio_cents'] as const) {
            const value = (prices as Record<string, unknown>)[key];
            if (value === undefined) continue;
            const column = key === 'personal_cents' ? 'personal' : key === 'commercial_cents' ? 'commercial' : 'studio';
            if (value === null) {
              if (key === 'personal_cents') fields['price'] = 'Enter a price from 1.00 to 1000.00 euros.';
              else updates[`price_${column}_cents`] = null;
              continue;
            }
            const cents = typeof value === 'number' ? Math.round(value) : typeof value === 'string' ? centsFromEurosText(value) : null;
            if (cents === null || cents < 100 || cents > 100_000) fields['price'] = 'Enter a price from 1.00 to 1000.00 euros.';
            else updates[`price_${column}_cents`] = cents;
          }
        }
      }
      if (body['discount_percent'] !== undefined) {
        const discount = Number(body['discount_percent']);
        if (!Number.isInteger(discount) || discount < 0 || discount > 90) fields['discount'] = 'Enter a whole number from 0 to 90.';
        else updates['discount_percent'] = discount;
      }
      if (body['edition_total'] !== undefined) {
        if (body['edition_total'] === null) {
          if (model.edition_sales > 0) throw new ApiError(409, 'edition_locked');
          updates['edition_total'] = null;
        } else {
          const total = Number(body['edition_total']);
          if (!Number.isInteger(total) || total < 1 || total > 500) fields['edition_total'] = 'Use a whole number from 1 to 500.';
          else {
            if (model.edition_sales > 0 && total !== model.edition_total) throw new ApiError(409, 'edition_locked');
            if (!plan.editions) throw new ApiError(403, 'not_in_plan');
            updates['edition_total'] = total;
          }
        }
      }
      if (body['edition_price_cents'] !== undefined) {
        const cents = typeof body['edition_price_cents'] === 'number' ? Math.round(body['edition_price_cents']) : centsFromEurosText(String(body['edition_price_cents']));
        if (cents === null || cents < 100 || cents > 100_000) fields['price'] = 'Enter a price from 1.00 to 1000.00 euros.';
        else updates['edition_price_cents'] = cents;
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);

      await withTransaction(async client => {
        const sets = Object.keys(updates).map((key, i) => `${snakeCase(key)} = $${i + 1}`);
        const values = Object.values(updates);
        if (sets.length > 0) {
          await client.query(
            `UPDATE models SET ${sets.join(', ')} WHERE id = $${values.length + 1}`,
            [...values, model.id],
          );
        }
        if (passwordChange || visibilityChange) {
          await client.query('UPDATE models SET password_epoch = password_epoch + 1 WHERE id = $1', [model.id]);
        }
        if (visibilityChange) {
          if (String(updates['visibility']) === 'unlisted') {
            const token = randomToken(24);
            await client.query(
              `INSERT INTO share_tokens (model_id, token) VALUES ($1, $2)
               ON CONFLICT (model_id) DO UPDATE SET token = EXCLUDED.token, created_at = now()`,
              [model.id, token],
            );
          } else {
            await client.query('DELETE FROM share_tokens WHERE model_id = $1', [model.id]);
            await client.query('DELETE FROM embeds WHERE model_id = $1', [model.id]);
          }
          if (String(updates['visibility']) !== 'password') {
            await client.query('UPDATE models SET password_hash = NULL WHERE id = $1', [model.id]);
          }
        }
        const fresh = await getModelBySlug(slug);
        if (fresh !== null) {
          if (fresh.state === 'published' && fresh.visibility === 'public' && !fresh.read_only) {
            await client.query(`UPDATE models SET index_state = 'dirty' WHERE id = $1`, [fresh.id]);
          } else if (fresh.index_state !== 'out') {
            await client.query(`UPDATE models SET index_state = 'pending_removal' WHERE id = $1`, [fresh.id]);
          }
        }
      });

      sendJson(ctx, 200, await studioDetail(slug));
    },
  });

  router.add({
    method: 'PUT',
    pattern: '/api/studio/models/:slug/view',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const slug = ctx.params['slug'] ?? '';
      const body = bodyOf(ctx);
      for (const key of Object.keys(body)) {
        if (!['default_camera', 'hotspots'].includes(key)) throw validationError({ [key]: 'Unknown field.' });
      }
      const model = await getModelBySlug(slug);
      if (model === null) throw new ApiError(404, 'not_found');
      if (model.read_only) throw new ApiError(409, 'read_only');
      const fields: Record<string, string> = {};
      const cameraBody = body['default_camera'];
      let camera: Camera | null = null;
      if (typeof cameraBody === 'object' && cameraBody !== null) {
        const cam = cameraBody as Record<string, unknown>;
        camera = {
          azimuth: Number(cam['azimuth']),
          tilt: Number(cam['tilt']),
          distanceFactor: Number(cam['distance']),
          fov: Number(cam['fov']),
        };
        if (!validCamera(camera)) fields['camera'] = `Keep the camera within the viewer's limits.`;
      } else {
        fields['camera'] = `Keep the camera within the viewer's limits.`;
      }
      const hotspotsBody = body['hotspots'];
      const hotspots: { label: string; x_mm: number; y_mm: number; z_mm: number }[] = [];
      if (Array.isArray(hotspotsBody)) {
        if (hotspotsBody.length > 8) {
          fields['hotspots'] = `Use up to 8 hotspots inside the model's bounds, each labelled with 1 to 60 characters.`;
        } else {
          const half = { width: Number(model.width_mm) / 2, height: Number(model.height_mm) / 2, depth: Number(model.depth_mm) / 2 };
          for (const entry of hotspotsBody) {
            if (typeof entry !== 'object' || entry === null) {
              fields['hotspots'] = `Use up to 8 hotspots inside the model's bounds, each labelled with 1 to 60 characters.`;
              break;
            }
            const record = entry as Record<string, unknown>;
            const label = typeof record['label'] === 'string' ? record['label'] : '';
            const x = Number(record['x_mm']);
            const y = Number(record['y_mm']);
            const z = Number(record['z_mm']);
            if (
              charCount(label) < 1 ||
              charCount(label) > 60 ||
              !Number.isFinite(x) ||
              !Number.isFinite(y) ||
              !Number.isFinite(z) ||
              Math.abs(x) > half.width ||
              Math.abs(y) > half.height ||
              Math.abs(z) > half.depth
            ) {
              fields['hotspots'] = `Use up to 8 hotspots inside the model's bounds, each labelled with 1 to 60 characters.`;
              break;
            }
            hotspots.push({ label, x_mm: x, y_mm: y, z_mm: z });
          }
        }
      } else {
        fields['hotspots'] = `Use up to 8 hotspots inside the model's bounds, each labelled with 1 to 60 characters.`;
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);
      await query(
        `UPDATE models SET cam_azimuth = $2, cam_tilt = $3, cam_distance_factor = $4, cam_fov = $5, hotspots = $6 WHERE id = $1`,
        [model.id, camera?.azimuth, camera?.tilt, camera?.distanceFactor, camera?.fov, JSON.stringify(hotspots)],
      );
      sendJson(ctx, 200, await studioDetail(slug));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/studio/models/:slug/transitions',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      const user = await requireRole(ctx, ['author', 'editor']);
      const body = bodyOf(ctx);
      for (const key of Object.keys(body)) {
        if (key !== 'to') throw validationError({ [key]: 'Unknown field.' });
      }
      const to = String(body['to'] ?? '');
      if (!['draft', 'in_review', 'published', 'withdrawn'].includes(to)) {
        throw validationError({ to: 'Choose one of the listed values.' });
      }
      const slug = ctx.params['slug'] ?? '';
      const model = await getModelBySlug(slug);
      if (model === null) throw new ApiError(404, 'not_found');
      const isOwner = model.owner_id === user.id;
      const result = await applyTransition(slug, to as 'draft' | 'in_review' | 'published' | 'withdrawn', {
        role: user.role,
        userId: user.id,
        isOwner,
      });
      sendJson(ctx, 200, result);
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/studio/models/:slug',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const slug = ctx.params['slug'] ?? '';
      const model = await getModelBySlug(slug);
      if (model === null) throw new ApiError(404, 'not_found');
      if (model.state !== 'draft') throw new ApiError(409, 'not_deletable');
      if (model.index_state !== 'out') {
        // Deleting an indexed model removes its search document first, so no stale entry is served.
        try {
          await deleteDoc(model.slug);
        } catch {
          throw new ApiError(503, 'search_unavailable');
        }
      }
      await query('DELETE FROM collection_items WHERE model_id = $1', [model.id]);
      await query('DELETE FROM models WHERE id = $1', [model.id]);
      sendJson(ctx, 204, null);
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/studio/uploads',
    allowedParams: [],
    multipart: true,
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const { ingestUpload } = await import('../uploads/ingest.js');
      await ingestUpload(ctx, 'studio');
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/studio/uploads/:ref',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const status = await uploadStatus(ctx.params['ref'] ?? '');
      if (status === null) throw new ApiError(404, 'not_found');
      sendJson(ctx, 200, status);
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/studio/uploads/:ref/requeue',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const ref = ctx.params['ref'] ?? '';
      const existing = await getUpload(ref);
      if (existing === null) throw new ApiError(404, 'not_found');
      if (existing.upload.status !== 'failed') throw new ApiError(409, 'not_failed');
      await requeueUpload(ref);
      const status = await uploadStatus(ref);
      sendJson(ctx, 202, status);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/studio/models/:slug/original',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const model = await getModelBySlug(ctx.params['slug'] ?? '');
      if (model === null) throw new ApiError(404, 'not_found');
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
    pattern: '/api/studio/models/:slug/share-link',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const model = await getModelBySlug(ctx.params['slug'] ?? '');
      if (model === null) throw new ApiError(404, 'not_found');
      if (model.read_only) throw new ApiError(409, 'read_only');
      if (model.visibility !== 'unlisted') throw new ApiError(409, 'visibility_conflict');
      const token = randomToken(24);
      await query(
        `INSERT INTO share_tokens (model_id, token) VALUES ($1, $2)
         ON CONFLICT (model_id) DO UPDATE SET token = EXCLUDED.token, created_at = now()`,
        [model.id, token],
      );
      sendJson(ctx, 201, { share_url: `/u/${token}` });
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/studio/models/:slug/embeds',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const model = await getModelBySlug(ctx.params['slug'] ?? '');
      if (model === null) throw new ApiError(404, 'not_found');
      const state = await planState();
      const plan = planOf(state.plan);
      if (!plan.embeds) throw new ApiError(403, 'not_in_plan');
      if (model.read_only) throw new ApiError(409, 'read_only');
      if (model.state !== 'published' || (model.visibility !== 'public' && model.visibility !== 'unlisted')) {
        throw new ApiError(409, 'visibility_conflict');
      }
      const token = randomToken(24);
      await query('INSERT INTO embeds (token, model_id) VALUES ($1, $2)', [token, model.id]);
      sendJson(ctx, 201, { token, url: `/embed/${token}` });
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/studio/embeds/:token',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const result = await query('DELETE FROM embeds WHERE token = $1', [ctx.params['token'] ?? '']);
      if (result.rowCount === 0) throw new ApiError(404, 'not_found');
      sendJson(ctx, 204, null);
    },
  });

  registerCollectionRoutes(router);
  registerPlanRoutes(router);
  registerApiKeyRoutes(router);
  registerExportRoute(router);
}

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export async function studioDetail(slug: string): Promise<Record<string, unknown>> {
  const model = await getModelBySlug(slug);
  if (model === null) throw new ApiError(404, 'not_found');
  const share = await one<{ token: string }>('SELECT token FROM share_tokens WHERE model_id = $1', [model.id]);
  const embeds = await query<{ token: string }>('SELECT token FROM embeds WHERE model_id = $1 ORDER BY created_at', [model.id]);
  const latest = await one<{ ref: string }>(
    `SELECT u.ref FROM uploads u JOIN model_revisions r ON r.id = u.revision_id
     WHERE r.model_id = $1 AND r.revision_no = $2 ORDER BY u.created_at DESC LIMIT 1`,
    [model.id, model.revision_count],
  );
  const owner = await one<{ email: string }>('SELECT email FROM users WHERE id = $1', [model.owner_id]);
  const detail = modelDetailOf(model, 'studio');
  if (detail.edition !== null) {
    detail.edition.remaining = await editionRemaining(model.id);
  }
  return {
    ...detail,
    state: model.state,
    visibility: model.visibility,
    read_only: model.read_only,
    revision: model.revision,
    share_url: share === null ? null : `/u/${share.token}`,
    embeds: embeds.rows.map(row => ({ token: row.token, url: `/embed/${row.token}` })),
    latest_upload: latest?.ref ?? null,
    owner: owner?.email ?? 'author',
    hotspots: model.hotspots,
    default_camera: {
      azimuth: model.cam_azimuth,
      tilt: model.cam_tilt,
      distance: model.cam_distance_factor,
      fov: model.cam_fov,
    },
    discount_percent: model.discount_percent,
  };
}

function registerCollectionRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/studio/collections',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const rows = await query<{ slug: string; name: string; item_count: string; models: string[] | null }>(
        `SELECT c.slug, c.name,
           (SELECT count(*)::text FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count,
           (SELECT array_agg(m.slug ORDER BY m.slug) FROM collection_items ci JOIN models m ON m.id = ci.model_id WHERE ci.collection_id = c.id) AS models
         FROM collections c ORDER BY c.name`,
      );
      sendJson(ctx, 200, {
        items: rows.rows.map(row => ({
          slug: row.slug,
          name: row.name,
          item_count: Number(row.item_count),
          models: row.models ?? [],
        })),
      });
    },
  });
  router.add({
    method: 'POST',
    pattern: '/api/studio/collections',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const body = bodyOf(ctx);
      for (const key of Object.keys(body)) {
        if (key !== 'name') throw validationError({ [key]: 'Unknown field.' });
      }
      const name = typeof body['name'] === 'string' ? body['name'] : '';
      if (charCount(name) < 1 || charCount(name) > 60) throw validationError({ name: `Use 1 to 60 characters that no other collection or key uses.` });
      const existing = await one<{ id: number }>('SELECT id FROM collections WHERE lower(name) = lower($1)', [name]);
      if (existing !== null) throw validationError({ name: `Use 1 to 60 characters that no other collection or key uses.` });
      const slug = slugFromTitle(name, candidate => one('SELECT id FROM collections WHERE slug = $1', [candidate]) !== null, 1);
      await query('INSERT INTO collections (slug, name) VALUES ($1, $2)', [slug, name]);
      sendJson(ctx, 201, { slug, name, item_count: 0 });
    },
  });
  router.add({
    method: 'PATCH',
    pattern: '/api/studio/collections/:slug',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const body = bodyOf(ctx);
      for (const key of Object.keys(body)) {
        if (key !== 'name') throw validationError({ [key]: 'Unknown field.' });
      }
      const name = typeof body['name'] === 'string' ? body['name'] : '';
      if (charCount(name) < 1 || charCount(name) > 60) throw validationError({ name: `Use 1 to 60 characters that no other collection or key uses.` });
      const collection = await one<{ id: number }>('SELECT id FROM collections WHERE slug = $1', [ctx.params['slug'] ?? '']);
      if (collection === null) throw new ApiError(404, 'not_found');
      const conflict = await one<{ id: number }>('SELECT id FROM collections WHERE lower(name) = lower($1) AND id <> $2', [name, collection.id]);
      if (conflict !== null) throw validationError({ name: `Use 1 to 60 characters that no other collection or key uses.` });
      await query('UPDATE collections SET name = $2 WHERE id = $1', [collection.id, name]);
      sendJson(ctx, 200, { slug: ctx.params['slug'], name });
    },
  });
  router.add({
    method: 'DELETE',
    pattern: '/api/studio/collections/:slug',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const result = await query('DELETE FROM collections WHERE slug = $1', [ctx.params['slug'] ?? '']);
      if (result.rowCount === 0) throw new ApiError(404, 'not_found');
      sendJson(ctx, 204, null);
    },
  });
  router.add({
    method: 'POST',
    pattern: '/api/studio/collections/:slug/items',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const body = bodyOf(ctx);
      for (const key of Object.keys(body)) {
        if (key !== 'model') throw validationError({ [key]: 'Unknown field.' });
      }
      const collection = await one<{ id: number }>('SELECT id FROM collections WHERE slug = $1', [ctx.params['slug'] ?? '']);
      if (collection === null) throw new ApiError(404, 'not_found');
      const model = await getModelBySlug(String(body['model'] ?? ''));
      if (model === null) throw new ApiError(404, 'not_found');
      const existing = await one<{ model_id: number }>('SELECT model_id FROM collection_items WHERE collection_id = $1 AND model_id = $2', [collection.id, model.id]);
      if (existing !== null) throw new ApiError(409, 'already_in_collection');
      await query('INSERT INTO collection_items (collection_id, model_id) VALUES ($1, $2)', [collection.id, model.id]);
      sendJson(ctx, 201, collectionItemResponse(ctx.params['slug'] ?? ''));
    },
  });
  router.add({
    method: 'DELETE',
    pattern: '/api/studio/collections/:slug/items/:model',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const collection = await one<{ id: number }>('SELECT id FROM collections WHERE slug = $1', [ctx.params['slug'] ?? '']);
      if (collection === null) throw new ApiError(404, 'not_found');
      const model = await getModelBySlug(ctx.params['model'] ?? '');
      if (model === null) throw new ApiError(404, 'not_found');
      await query('DELETE FROM collection_items WHERE collection_id = $1 AND model_id = $2', [collection.id, model.id]);
      sendJson(ctx, 204, null);
    },
  });
  router.add({
    method: 'POST',
    pattern: '/api/studio/collections/:slug/items/:model/move',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author', 'editor']);
      const body = bodyOf(ctx);
      for (const key of Object.keys(body)) {
        if (key !== 'to') throw validationError({ [key]: 'Unknown field.' });
      }
      const from = await one<{ id: number; slug: string; name: string }>('SELECT id, slug, name FROM collections WHERE slug = $1', [ctx.params['slug'] ?? '']);
      const to = await one<{ id: number; slug: string; name: string }>('SELECT id, slug, name FROM collections WHERE slug = $1', [String(body['to'] ?? '')]);
      if (from === null || to === null) throw new ApiError(404, 'not_found');
      const model = await getModelBySlug(ctx.params['model'] ?? '');
      if (model === null) throw new ApiError(404, 'not_found');
      const conflict = await one<{ model_id: number }>('SELECT model_id FROM collection_items WHERE collection_id = $1 AND model_id = $2', [to.id, model.id]);
      if (conflict !== null) throw new ApiError(409, 'already_in_collection');
      await withTransaction(async client => {
        await client.query('DELETE FROM collection_items WHERE collection_id = $1 AND model_id = $2', [from.id, model.id]);
        await client.query('INSERT INTO collection_items (collection_id, model_id) VALUES ($1, $2)', [to.id, model.id]);
      });
      sendJson(ctx, 200, { from: { slug: from.slug, name: from.name }, to: { slug: to.slug, name: to.name } });
    },
  });
}

async function collectionItemResponse(slug: string): Promise<Record<string, unknown>> {
  const rows = await query<{ slug: string; name: string; item_count: string; models: string[] | null }>(
    `SELECT c.slug, c.name,
       (SELECT count(*)::text FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count,
       (SELECT array_agg(m.slug ORDER BY m.slug) FROM collection_items ci JOIN models m ON m.id = ci.model_id WHERE ci.collection_id = c.id) AS models
     FROM collections c WHERE c.slug = $1`,
    [slug],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new ApiError(404, 'not_found');
  return { slug: row.slug, name: row.name, item_count: Number(row.item_count), models: row.models ?? [] };
}

function registerPlanRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/studio/plan',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const state = await planState();
      const quota = await quotaInfo();
      sendJson(ctx, 200, {
        plan: state.plan,
        pending:
          state.pending_plan === null || state.pending_effective_date === null
            ? null
            : { plan: state.pending_plan, effective_date: state.pending_effective_date },
        billing_cycle_day: state.billing_cycle_day,
        confirmed_at: state.confirmed_at,
        quota,
      });
    },
  });
  router.add({
    method: 'POST',
    pattern: '/api/studio/plan',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const key = idempotencyKeyOf(ctx);
      const body = bodyOf(ctx);
      for (const keyName of Object.keys(body)) {
        if (keyName !== 'plan') throw validationError({ [keyName]: 'Unknown field.' });
      }
      const plan = String(body['plan'] ?? '');
      if (!['free', 'basic', 'pro', 'premium'].includes(plan)) {
        throw validationError({ plan: 'Choose one of the listed values.' });
      }
      const rawBody = JSON.stringify(bodyOf(ctx));
      const response = await idempotent('plan-change', key, rawBody, async () => {
        const result = await changePlan(plan as PlanId);
        return {
          status: result.status,
          body: JSON.stringify({
            plan: result.plan,
            pending: result.pending,
            charged_cents: result.charged_cents,
            redirect: '/studio/plan',
          }),
          contentType: 'application/json',
        };
      });
      sendRaw(ctx, response.status, response.body, response.content_type);
    },
  });
}

function registerApiKeyRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/studio/api-keys',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const rows = await query<{ ref: string; name: string; created_at: string; active: boolean }>(
        'SELECT ref, name, created_at, active FROM api_keys ORDER BY created_at',
      );
      sendJson(ctx, 200, { items: rows.rows });
    },
  });
  router.add({
    method: 'POST',
    pattern: '/api/studio/api-keys',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const body = bodyOf(ctx);
      for (const key of Object.keys(body)) {
        if (key !== 'name') throw validationError({ [key]: 'Unknown field.' });
      }
      const name = typeof body['name'] === 'string' ? body['name'] : '';
      if (charCount(name) < 1 || charCount(name) > 60) {
        throw validationError({ name: `Use 1 to 60 characters that no other collection or key uses.` });
      }
      const existingKey = await one<{ id: number }>('SELECT id FROM api_keys WHERE lower(name) = lower($1)', [name]);
      if (existingKey !== null) throw validationError({ name: `Use 1 to 60 characters that no other collection or key uses.` });
      const state = await planState();
      const plan = planOf(state.plan);
      const activeCount = await one<{ count: string }>('SELECT count(*)::text AS count FROM api_keys WHERE active = true');
      if (Number(activeCount?.count ?? '0') >= plan.apiKeys) throw new ApiError(403, 'not_in_plan');
      const key = `tsr_${randomToken(20)}`;
      const ref = `k_${randomToken(8).replace(/[^a-zA-Z0-9]/g, 'a')}`;
      await query('INSERT INTO api_keys (ref, name, key_hash) VALUES ($1, $2, $3)', [ref, name, hashKey(key)]);
      const created = await one<{ created_at: string }>('SELECT created_at FROM api_keys WHERE ref = $1', [ref]);
      sendJson(ctx, 201, { ref, name, key, created_at: created?.created_at });
    },
  });
  router.add({
    method: 'DELETE',
    pattern: '/api/studio/api-keys/:ref',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      const result = await query('UPDATE api_keys SET active = false WHERE ref = $1', [ctx.params['ref'] ?? '']);
      if (result.rowCount === 0) throw new ApiError(404, 'not_found');
      sendJson(ctx, 204, null);
    },
  });
}

function registerExportRoute(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/studio/exports/catalogue.csv',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['author']);
      if (await hasPendingRemovals()) throw new ApiError(503, 'search_unavailable');
      const hits = await allIndexed({ sort: 'newest' });
      const lines: string[] = ['slug,title,category,formats,licences,price_from_eur,published_on'];
      for (const hit of hits) {
        const priceEur = (hit.price_from_cents / 100).toFixed(2);
        const publishedOn = new Date(hit.published_at * 1000).toISOString().slice(0, 10);
        const cells = [
          hit.slug,
          hit.title,
          hit.category,
          hit.formats.join(';'),
          hit.licences.join(';'),
          priceEur,
          publishedOn,
        ].map(neutraliseFormula).map(csvCell);
        lines.push(cells.join(','));
      }
      sendRaw(ctx, 200, lines.join('\r\n') + '\r\n', 'text/csv; charset=utf-8');
    },
  });
}

/** Spreadsheet formula characters are neutralised by the published rule. */
function neutraliseFormula(cell: string): string {
  const first = cell.charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return `'${cell}`;
  }
  return cell;
}

function csvCell(cell: string): string {
  if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

