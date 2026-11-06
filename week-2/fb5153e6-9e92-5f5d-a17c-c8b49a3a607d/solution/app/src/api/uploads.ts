import { createHash } from 'node:crypto';
import type { Reply, RequestContext } from '../http/router.js';
import { json } from '../http/router.js';
import { ApiError, fieldError, notFound, validationFailed } from '../http/errors.js';
import type { FieldError } from '../http/errors.js';
import type { FilePart } from '../http/body.js';
import type { PackageKind, PlanName } from '../domain/plans.js';
import { acceptsPackage, plan } from '../domain/plans.js';
import { isCategory, isSourceUnit } from '../domain/model.js';
import type { Category, SourceUnit } from '../domain/model.js';
import { graphemeLength, uniqueSlug } from '../domain/text.js';
import { newUploadRef } from '../domain/identifiers.js';
import { isGltfBinary, isZipArchive } from '../media/gltf.js';
import { PackageError, assembleGlbFromPackage } from '../media/package.js';
import { objectKeys, putObject } from '../services/s3.js';
import { queryOne } from '../db/pool.js';
import { createUpload } from '../db/uploads.js';
import type { ModelRecord } from '../db/models.js';
import { syncModelQuietly } from '../services/indexer.js';

/**
 * The package's type comes only from its bytes. The size check runs first, and
 * both run before anything is stored or queued.
 */
export function judgePackage(file: FilePart, planName: PlanName): PackageKind {
  const limit = plan(planName).maxPackageBytes;
  if (file.bytes.length > limit) {
    throw new ApiError('file_too_large', { params: { limit } });
  }
  if (isGltfBinary(file.bytes)) return 'gltf-binary';
  if (isZipArchive(file.bytes)) {
    if (!acceptsPackage(planName, 'gltf-package')) throw new ApiError('type_not_in_plan');
    return 'gltf-package';
  }
  if (file.filename.toLowerCase().endsWith('.glb')) throw new ApiError('content_mismatch');
  throw new ApiError('unsupported_type');
}

/** A package's contents are checked entry by entry once its type is known. */
function checkPackageContents(file: FilePart, kind: PackageKind): void {
  if (kind !== 'gltf-package') return;
  try {
    assembleGlbFromPackage(file.bytes);
  } catch (error) {
    if (error instanceof PackageError) {
      throw validationFailed([
        fieldError('file', error.fault === 'path_escape' ? 'file_path_escape' : 'file_package_contents'),
      ]);
    }
    throw error;
  }
}

export interface UploadFields {
  readonly file: FilePart;
  readonly sourceUnit: SourceUnit;
  readonly title: string | null;
  readonly category: Category | null;
  readonly modelSlug: string | null;
}

function readFields(ctx: RequestContext): { file: FilePart | null; modelSlug: string | null } {
  const form = ctx.form;
  if (form === null) throw validationFailed([fieldError('file', 'file_missing')]);
  return { file: form.file('file'), modelSlug: form.field('model') };
}

function validateFields(ctx: RequestContext, file: FilePart | null): UploadFields {
  const form = ctx.form;
  if (form === null) throw validationFailed([fieldError('file', 'file_missing')]);
  const errors: FieldError[] = [];
  if (file === null || file.bytes.length === 0) errors.push(fieldError('file', 'file_missing'));

  const sourceUnit = form.field('source_unit');
  if (!isSourceUnit(sourceUnit)) errors.push(fieldError('source_unit', 'choose_one'));

  const modelSlug = form.field('model');
  let title: string | null = null;
  let category: Category | null = null;
  if (modelSlug === null) {
    const rawTitle = form.field('title') ?? '';
    const length = graphemeLength(rawTitle.trim());
    if (length < 1 || length > 120) errors.push(fieldError('title', 'title'));
    else title = rawTitle.trim();
    const rawCategory = form.field('category');
    if (!isCategory(rawCategory)) errors.push(fieldError('category', 'choose_one'));
    else category = rawCategory;
  }

  if (errors.length > 0) throw validationFailed(errors);
  if (file === null || !isSourceUnit(sourceUnit)) {
    throw validationFailed([fieldError('file', 'file_missing')]);
  }
  return { file, sourceUnit, title, category, modelSlug };
}

async function nextRevisionNumber(modelId: number): Promise<number> {
  const row = await queryOne<{ highest: number | null }>(
    `SELECT max(revision) AS highest FROM revisions WHERE model_id = $1`,
    [modelId],
  );
  return (row?.highest ?? 0) + 1;
}

async function slugIsTaken(slug: string): Promise<boolean> {
  return (await queryOne<{ id: number }>(`SELECT id FROM models WHERE slug = $1`, [slug])) !== null;
}

async function createDraftModel(
  title: string,
  category: Category,
  ownerUserId: number,
): Promise<{ id: number; slug: string }> {
  const taken = new Set<string>();
  let slug = uniqueSlug(title, (candidate) => taken.has(candidate));
  while (await slugIsTaken(slug)) {
    taken.add(slug);
    slug = uniqueSlug(title, (candidate) => taken.has(candidate));
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO models (slug, title, category, state, visibility, owner_user_id, personal_cents)
     VALUES ($1, $2, $3, 'draft', 'private', $4, 1000) RETURNING id`,
    [slug, title, category, ownerUserId],
  );
  if (row === null) throw new Error('Model row was not created');
  return { id: row.id, slug };
}

export interface AcceptedUpload {
  readonly modelSlug: string;
  readonly uploadRef: string;
}

/**
 * Stores the original byte for byte under its content checksum and queues the
 * five stages. Replacing a source marks the current derivatives outdated at once.
 */
export async function acceptUpload(
  ctx: RequestContext,
  planName: PlanName,
  ownerUserId: number,
  existing: ModelRecord | null,
): Promise<AcceptedUpload> {
  const { file } = readFields(ctx);
  // Package checks come before field validation, as the error precedence states.
  const judged = file === null ? null : judgePackage(file, planName);
  const fields = validateFields(ctx, file);
  const packageKind = judged ?? judgePackage(fields.file, planName);
  checkPackageContents(fields.file, packageKind);

  const sha256 = createHash('sha256').update(fields.file.bytes).digest('hex');
  await putObject(objectKeys.original(sha256), fields.file.bytes, 'application/octet-stream');

  let modelId: number;
  let modelSlug: string;
  if (existing !== null) {
    modelId = existing.id;
    modelSlug = existing.slug;
  } else {
    if (fields.title === null || fields.category === null) {
      throw validationFailed([fieldError('title', 'title')]);
    }
    const created = await createDraftModel(fields.title, fields.category, ownerUserId);
    modelId = created.id;
    modelSlug = created.slug;
  }

  const revisionNumber = await nextRevisionNumber(modelId);
  const revision = await queryOne<{ id: number }>(
    `INSERT INTO revisions (model_id, revision, original_sha256, original_filename, original_bytes,
       source_unit, package_kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      modelId,
      revisionNumber,
      sha256,
      fields.file.filename,
      fields.file.bytes.length,
      fields.sourceUnit,
      packageKind,
    ],
  );
  if (revision === null) throw new Error('Revision row was not created');

  const uploadRef = newUploadRef();
  await createUpload(uploadRef, modelId, revision.id);

  if (existing !== null) {
    // Cards and the viewer show the rebuilding copy until publish confirms.
    await syncModelQuietly({ ...existing });
  }
  return { modelSlug, uploadRef };
}

export function uploadAcceptedReply(
  accepted: AcceptedUpload,
  queueUrl: (slug: string) => string,
): Reply {
  return json(202, {
    model: accepted.modelSlug,
    upload: accepted.uploadRef,
    queue_url: queueUrl(accepted.modelSlug),
  });
}

export { notFound };
