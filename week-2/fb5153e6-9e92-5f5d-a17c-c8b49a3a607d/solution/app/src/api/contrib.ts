import { createHash } from 'node:crypto';
import type { Reply, RequestContext } from '../http/router.js';
import { json } from '../http/router.js';
import { ApiError, fieldError, notFound, validationFailed } from '../http/errors.js';
import { requireContributor } from './guards.js';
import type { ModelRecord } from '../db/models.js';
import { findModelBySlug, modelsOwnedBy } from '../db/models.js';
import { activePlan } from '../db/plan.js';
import { plan } from '../domain/plans.js';
import { edgeAllows } from '../domain/states.js';
import { graphemeLength } from '../domain/text.js';
import { newTextureSetRef } from '../domain/identifiers.js';
import { query } from '../db/pool.js';
import { findUploadByRef, queueStatusFor } from '../db/uploads.js';
import { acceptUpload, uploadAcceptedReply } from './uploads.js';
import { applyTransition, serveOriginal, uploadPayload } from './studio.js';
import { modelDetail } from './access.js';
import { priceFromCents } from '../services/indexer.js';
import { isZipArchive } from '../media/gltf.js';
import { escapesFolder, isPngOrJpeg, readZip, ZipReadError } from '../media/zip.js';
import { objectKeys, putObject } from '../services/s3.js';
import type { Session } from '../domain/session.js';

/**
 * A contributor reaches only their own models. Any other slug, in a route or in
 * a request body, is not found.
 */
async function loadOwnModel(session: Session, slug: string | undefined): Promise<ModelRecord> {
  if (slug === undefined || slug === '') throw notFound();
  const model = await findModelBySlug(slug, await activePlan());
  if (model === null || model.ownerUserId !== session.userId) throw notFound();
  return model;
}

export async function listHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireContributor(ctx);
  const models = await modelsOwnedBy(session.userId, await activePlan());
  const items = [];
  for (const model of models) {
    items.push({
      slug: model.slug,
      title: model.title,
      state: model.state,
      visibility: model.visibility,
      read_only: model.readOnly,
      price_from_cents: priceFromCents(model),
      queue_status: await queueStatusFor(model.id),
    });
  }
  return json(200, { items });
}

export async function detailHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireContributor(ctx);
  const model = await loadOwnModel(session, ctx.params.slug);
  return json(200, {
    ...(await modelDetail(model)),
    state: model.state,
    visibility: model.visibility,
    read_only: model.readOnly,
  });
}

export async function uploadHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireContributor(ctx);
  const slug = ctx.form?.field('model') ?? null;
  let existing: ModelRecord | null = null;
  if (slug !== null) {
    existing = await loadOwnModel(session, slug);
    if (existing.state !== 'draft') throw notFound();
    if (existing.readOnly) throw new ApiError('read_only');
  }
  const accepted = await acceptUpload(ctx, await activePlan(), session.userId, existing);
  return uploadAcceptedReply(accepted, (s) => `/contribute/models/${s}`);
}

export async function uploadStatusHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireContributor(ctx);
  const upload = await findUploadByRef(ctx.params.ref ?? '');
  if (upload === null) throw notFound();
  await loadOwnModel(session, upload.modelSlug);
  return json(200, uploadPayload(upload));
}

/** The contributor's one move: their own draft into review. */
export async function submitHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireContributor(ctx);
  const model = await loadOwnModel(session, ctx.params.slug);
  if (!edgeAllows(model.state, 'in_review', 'owning_contributor')) {
    throw new ApiError('illegal_transition', { params: { from: model.state, to: 'in_review' } });
  }
  await applyTransition(model, 'in_review');
  return json(200, { slug: model.slug, state: 'in_review' });
}

export async function originalHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireContributor(ctx);
  return serveOriginal(await loadOwnModel(session, ctx.params.slug));
}

/** A ZIP of PNG and JPEG images, checked entry by entry by content. */
export async function textureSetHandler(ctx: RequestContext): Promise<Reply> {
  const session = requireContributor(ctx);
  const form = ctx.form;
  if (form === null) throw validationFailed([fieldError('file', 'file_missing')]);

  const model = await loadOwnModel(session, form.field('model') ?? '');
  const file = form.file('file');
  const limit = plan(await activePlan()).maxPackageBytes;
  if (file !== null && file.bytes.length > limit) {
    throw new ApiError('file_too_large', { params: { limit } });
  }
  if (file === null || file.bytes.length === 0) {
    throw validationFailed([fieldError('file', 'file_missing')]);
  }
  if (!isZipArchive(file.bytes)) throw new ApiError('unsupported_type');

  const name = (form.field('name') ?? '').trim();
  const nameLength = graphemeLength(name);
  if (nameLength < 1 || nameLength > 60) throw validationFailed([fieldError('name', 'name')]);

  let entries;
  try {
    entries = readZip(file.bytes);
  } catch (error) {
    if (error instanceof ZipReadError) {
      throw validationFailed([fieldError('file', 'file_texture_content')]);
    }
    throw error;
  }
  for (const entry of entries) {
    if (escapesFolder(entry.name)) {
      throw validationFailed([fieldError('file', 'file_path_escape')]);
    }
  }
  if (entries.length === 0 || !entries.every((e) => isPngOrJpeg(e.bytes))) {
    throw validationFailed([fieldError('file', 'file_texture_content')]);
  }

  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  await putObject(objectKeys.textureSet(sha256), file.bytes, 'application/zip');

  const ref = newTextureSetRef();
  await query(
    `INSERT INTO texture_sets (ref, model_id, name, sha256, images) VALUES ($1, $2, $3, $4, $5)`,
    [ref, model.id, name, sha256, entries.length],
  );
  return json(201, {
    texture_set: ref,
    model: model.slug,
    images: entries.length,
    checksum: sha256,
  });
}
