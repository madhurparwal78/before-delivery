import type { RequestContext } from '../http/types.js';
import { ApiError } from '../errors.js';
import { validationError } from '../http/types.js';
import { readMultipart, MULTIPART_BODY_LIMIT } from '../http/body.js';
import { sendJson } from '../http/respond.js';
import { charCount, sha256Hex, slugFromTitle } from '../domain/ids.js';
import { detectPackageType, checkPackageAccepted, checkPackageStructure } from '../geometry/packages.js';
import { putObject, originalKey } from '../providers/storage.js';
import { planOf } from '../domain/plans.js';
import { planState } from '../domain/plan-service.js';
import { query, one, withTransaction } from '../db/db.js';
import { getModelBySlug, type ModelRow } from '../domain/models.js';
import { createUpload } from '../queue/runner.js';

const CATEGORIES = ['hard-surface', 'miniature', 'scan'];
const UNITS = ['mm', 'cm', 'm', 'in'];

export interface IngestResult {
  slug: string;
  upload: string;
  queue_url: string;
}

/**
 * One upload ingest: plan size and type checks run before anything is stored or
 * queued; accepted packages are stored byte for byte under their checksum.
 */
export async function ingestUpload(ctx: RequestContext, area: 'studio' | 'contrib'): Promise<void> {
  const contentType = ctx.req.headers['content-type'] ?? '';
  const { fields, files } = await readMultipart(ctx.req, contentType, MULTIPART_BODY_LIMIT);
  const file = files.get('file');
  if (file === undefined) throw validationError({ file: 'Choose a file to upload.' });
  const sourceUnit = fields.get('source_unit') ?? '';
  const modelSlug = fields.get('model') ?? '';
  const title = fields.get('title') ?? '';
  const category = fields.get('category') ?? '';

  const isReplace = modelSlug !== '';
  const fields_: Record<string, string> = {};
  if (!UNITS.includes(sourceUnit)) fields_['source_unit'] = 'Choose one of the listed values.';
  if (!isReplace && (charCount(title) < 1 || charCount(title) > 120)) {
    fields_['title'] = 'Enter a title of 1 to 120 characters.';
  }
  if (!isReplace && !CATEGORIES.includes(category)) {
    fields_['category'] = 'Choose one of the listed values.';
  }
  if (Object.keys(fields_).length > 0) throw validationError(fields_);

  const state = await planState();
  const plan = planOf(state.plan);

  // Package checks in the published order: size, then type, then plan acceptance.
  if (file.data.length > plan.maxPackageBytes) {
    throw new ApiError(413, 'file_too_large', { limit: plan.maxPackageBytes });
  }
  const packageType = detectPackageType(file.data, file.filename);
  checkPackageAccepted(packageType, plan);
  checkPackageStructure(file.data, packageType);

  const checksum = sha256Hex(file.data);
  await putObject(originalKey(checksum), file.data, 'application/octet-stream');

  let model: ModelRow | null;
  let isNew = false;
  if (isReplace) {
    model = await getModelBySlug(modelSlug);
    if (model === null) throw new ApiError(404, 'not_found');
    if (area === 'contrib') {
      const user = await currentUserOf(ctx);
      if (model.owner_id !== user?.id || model.state !== 'draft') throw new ApiError(404, 'not_found');
    }
    if (model.read_only) throw new ApiError(409, 'read_only');
  } else {
    model = null;
    isNew = true;
  }

  const owner = await currentUserOf(ctx);
  const result = await withTransaction(async client => {
    let modelId: number;
    let slug: string;
    if (isNew) {
      const taken = new Set(
        (await client.query<{ slug: string }>('SELECT slug FROM models')).rows.map(row => row.slug),
      );
      const slugCandidate = slugFromTitle(title, candidate => taken.has(candidate), 1);
      const insert = await client.query<{ id: number; slug: string }>(
        `INSERT INTO models (slug, title, description, category, state, visibility, owner_id, source_unit, source_name)
         VALUES ($1, $2, '', $3, 'draft', 'private', $4, $5, $6) RETURNING id, slug`,
        [slugCandidate, title, category, owner?.id ?? 1, sourceUnit, file.filename],
      );
      modelId = insert.rows[0]!.id;
      slug = insert.rows[0]!.slug;
    } else {
      modelId = model?.id as number;
      slug = model?.slug as string;
      await client.query(
        `UPDATE models SET source_unit = $2, source_name = $3, rebuilding = true, outdated = true,
           index_state = CASE WHEN state = 'published' AND visibility = 'public' AND NOT read_only THEN 'dirty' ELSE index_state END
         WHERE id = $1`,
        [modelId, sourceUnit, file.filename],
      );
    }
    const revisionCount = await client.query<{ revision_count: number }>(
      'SELECT revision_count FROM models WHERE id = $1',
      [modelId],
    );
    const nextRevision = (revisionCount.rows[0]?.revision_count ?? 0) + 1;
    const revision = await client.query<{ id: number }>(
      `INSERT INTO model_revisions (model_id, revision_no, source_checksum, source_name, source_size, source_unit, current)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [modelId, nextRevision, checksum, file.filename, file.data.length, sourceUnit, !isNew],
    );
    await client.query('UPDATE models SET revision_count = $2 WHERE id = $1', [modelId, nextRevision]);
    const uploadRef = await createUpload(modelId, revision.rows[0]!.id, client);
    return { slug, uploadRef };
  });

  sendJson(ctx, 202, {
    model: result.slug,
    upload: result.uploadRef,
    queue_url: area === 'studio' ? `/studio/models/${result.slug}/queue` : `/contribute/models/${result.slug}`,
  });
}

async function currentUserOf(ctx: RequestContext): Promise<{ id: number } | null> {
  const { currentUser } = await import('../api/session.js');
  return currentUser(ctx);
}
