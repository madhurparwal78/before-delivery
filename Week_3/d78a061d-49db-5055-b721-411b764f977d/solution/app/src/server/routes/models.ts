import { createHash, randomUUID } from 'node:crypto';
import { pool, query, transaction } from '../db.js';
import { errors, type ApiError } from '../errors.js';
import { setStorageNotice } from '../accounts.js';
import { requireAccount, type Ctx, type Reply } from '../http.js';
import {
  StorageUnavailable,
  deleteObject,
  getObject,
  objectExists,
  originalKey,
  putObject,
  thumbnailKey,
} from '../storage/s3.js';
import { hasGltfMagic } from '../models/glb.js';
import { judgeUpload, RULE_LIMITS } from '../models/rulebook.js';
import { renderThumbnail } from '../models/thumbnail.js';
import { appendEvent } from '../realtime/streams.js';
import { QUOTA_BYTES, RULEBOOK_VERSION, UPLOAD_MAX_BYTES, VALIDATOR_VERSION } from '../../shared/constants.js';
import { t, type MessageKey } from '../../shared/i18n/index.js';
import type { ModelRecord, ModelStatus, Report, RuleId } from '../../shared/types.js';
import { syncModelStatuses } from './characters.js';

const ALLOWED_CONTENT_TYPES = ['model/gltf-binary', 'application/octet-stream'];
const LISTED_STATUSES: ModelStatus[] = ['stored', 'validating', 'accepted', 'equipped', 'rejected'];

interface ModelRow {
  id: string;
  account_id: string;
  filename: string;
  size_bytes: string;
  sha256: string;
  status: ModelStatus;
  rulebook_version: string | null;
  report: Report | null;
  created_at: Date;
}

function toModel(row: ModelRow): ModelRecord {
  return {
    id: row.id,
    filename: row.filename,
    size_bytes: Number(row.size_bytes),
    sha256: row.sha256,
    status: row.status,
    rulebook_version: row.rulebook_version,
    report: row.report,
    created_at: row.created_at.toISOString(),
  };
}

/** The upload's name is a label only; storage keys never use it. */
function sanitiseFilename(header: string | undefined): string {
  let name = '';
  if (header !== undefined) {
    try {
      name = decodeURIComponent(header);
    } catch {
      name = header;
    }
  }
  const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  name = name.slice(lastSlash + 1);
  name = name.replace(/[^A-Za-z0-9.\-_]/g, '_');
  name = name.replace(/^\.+/, '').slice(0, 64);
  if (name === '') return 'model.glb';
  return /\.glb$/i.test(name) ? name : `${name}.glb`;
}

/**
 * Counts the body while it streams in and refuses it as soon as it breaks a rule. A refused body
 * is drained (never stored or parsed) so the client still reads the answer.
 */
function readUploadBody(ctx: Ctx): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let magicChecked = false;
    const refuse = (error: ApiError): void => {
      ctx.req.off('data', onData);
      ctx.req.off('end', onEnd);
      ctx.res.setHeader('Connection', 'close');
      ctx.req.resume();
      reject(error);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > UPLOAD_MAX_BYTES) {
        refuse(errors.tooLarge());
        return;
      }
      chunks.push(chunk);
      if (!magicChecked && size >= 4) {
        magicChecked = true;
        if (!hasGltfMagic(Buffer.concat(chunks))) refuse(errors.notGltf());
      }
    };
    const onEnd = (): void => {
      const bytes = Buffer.concat(chunks);
      if (!hasGltfMagic(bytes)) {
        reject(errors.notGltf());
        return;
      }
      resolve(bytes);
    };
    ctx.req.on('data', onData);
    ctx.req.on('end', onEnd);
    ctx.req.on('error', reject);
  });
}

async function usedQuota(accountId: string): Promise<number> {
  const rows = await query<{ total: string | null }>(
    'SELECT sum(size_bytes) AS total FROM models WHERE account_id = $1',
    [accountId],
  );
  return Number(rows[0].total ?? 0);
}

export async function uploadModel(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const contentType = (ctx.req.headers['content-type'] ?? '').split(';')[0].trim();
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    ctx.req.resume();
    throw errors.unsupportedType();
  }

  const bytes = await readUploadBody(ctx);

  if ((await usedQuota(account.id)) + bytes.length > QUOTA_BYTES) {
    throw errors.quotaExceeded();
  }

  const id = randomUUID();
  const filename = sanitiseFilename(
    typeof ctx.req.headers['x-filename'] === 'string' ? ctx.req.headers['x-filename'] : undefined,
  );
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  try {
    await putObject(originalKey(account.id, id), bytes, 'model/gltf-binary');
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      await setStorageNotice(account.id, 'upload_unavailable');
      throw errors.storageUnavailable('upload');
    }
    throw error;
  }

  // The record is written under the account's row lock with the quota checked again, so
  // simultaneous uploads cannot pass 60 MiB together. A refused or failed record removes its object.
  try {
    await transaction(async (client) => {
      await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [account.id]);
      const { rows: used } = await client.query<{ total: string | null }>(
        'SELECT sum(size_bytes) AS total FROM models WHERE account_id = $1',
        [account.id],
      );
      if (Number(used[0].total ?? 0) + bytes.length > QUOTA_BYTES) throw errors.quotaExceeded();
      await client.query(
        `INSERT INTO models (id, account_id, filename, size_bytes, sha256, status)
         VALUES ($1, $2, $3, $4, $5, 'stored')`,
        [id, account.id, filename, bytes.length, sha256],
      );
    });
  } catch (error) {
    await deleteObject(originalKey(account.id, id)).catch(() => undefined);
    throw error;
  }

  await setStorageNotice(account.id, null);
  const rows = await query<ModelRow>('SELECT * FROM models WHERE id = $1', [id]);
  setImmediate(() => {
    runValidation(id, account.id).catch(() => undefined);
  });
  return { status: 201, body: { model: toModel(rows[0]) } };
}

/** Validation starts only after the object is stored, and writes its verdict once. */
async function runValidation(modelId: string, accountId: string): Promise<void> {
  const updated = await query<{ id: string }>(
    `UPDATE models SET status = 'validating', rulebook_version = $2
     WHERE id = $1 AND status = 'stored' RETURNING id`,
    [modelId, RULEBOOK_VERSION],
  );
  if (updated.length === 0) return;
  await appendEvent(`me:${accountId}`, {
    kind: 'model_status',
    model_id: modelId,
    status: 'validating',
  });

  let bytes: Buffer | null;
  try {
    bytes = await getObject(originalKey(accountId, modelId));
  } catch {
    await pool.query(`UPDATE models SET status = 'stored' WHERE id = $1`, [modelId]);
    return;
  }
  if (bytes === null) return;

  const report = await judgeUpload(bytes);
  const status: ModelStatus = report.failed_count === 0 ? 'accepted' : 'rejected';
  if (status === 'accepted') {
    try {
      await putObject(thumbnailKey(accountId, modelId), renderThumbnail(bytes), 'image/png');
    } catch {
      // The verdict still stands; the thumbnail is made again on the next accepted upload.
    }
  }
  await pool.query(
    `UPDATE models SET status = $2, report = $3, rulebook_version = $4 WHERE id = $1`,
    [modelId, status, JSON.stringify(report), report.rulebook_version],
  );
  await syncModelStatuses(accountId);
  const fresh = await query<{ status: ModelStatus }>('SELECT status FROM models WHERE id = $1', [
    modelId,
  ]);
  await appendEvent(`me:${accountId}`, {
    kind: 'model_status',
    model_id: modelId,
    status: fresh[0]?.status ?? status,
    failed_count: report.failed_count,
  });
}

export async function resumeValidations(): Promise<void> {
  const rows = await query<{ id: string; account_id: string; status: ModelStatus }>(
    `SELECT id, account_id, status FROM models WHERE status IN ('stored', 'validating')`,
  );
  for (const row of rows) {
    if (row.status === 'validating') {
      await pool.query(`UPDATE models SET status = 'stored' WHERE id = $1`, [row.id]);
    }
    runValidation(row.id, row.account_id).catch(() => undefined);
  }
}

export async function listModels(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await query<ModelRow>(
    `SELECT * FROM models WHERE account_id = $1 AND status = ANY($2::text[])
     ORDER BY created_at DESC`,
    [account.id, LISTED_STATUSES],
  );
  return { status: 200, body: { models: rows.map(toModel) } };
}

async function ownedModel(ctx: Ctx): Promise<ModelRow> {
  const account = requireAccount(ctx);
  const rows = await query<ModelRow>('SELECT * FROM models WHERE id = $1 AND account_id = $2', [
    ctx.params.id,
    account.id,
  ]);
  if (rows[0] === undefined) throw errors.notFound();
  return rows[0];
}

export async function getModel(ctx: Ctx): Promise<Reply> {
  return { status: 200, body: { model: toModel(await ownedModel(ctx)) } };
}

export async function getModelFile(ctx: Ctx): Promise<Reply> {
  const model = await ownedModel(ctx);
  let bytes: Buffer | null;
  try {
    bytes = await getObject(originalKey(model.account_id, model.id));
  } catch {
    throw errors.storageUnavailable('read');
  }
  if (bytes === null) throw errors.notFound();
  return {
    status: 200,
    raw: { contentType: 'model/gltf-binary', body: bytes },
    headers: { 'Content-Disposition': 'attachment' },
  };
}

export async function getModelThumbnail(ctx: Ctx): Promise<Reply> {
  const model = await ownedModel(ctx);
  if (model.status !== 'accepted' && model.status !== 'equipped') throw errors.notFound();
  let bytes: Buffer | null;
  try {
    bytes = await getObject(thumbnailKey(model.account_id, model.id));
  } catch {
    throw errors.storageUnavailable('read');
  }
  if (bytes === null) throw errors.notFound();
  return {
    status: 200,
    raw: { contentType: 'image/png', body: bytes },
    headers: { 'Content-Disposition': 'attachment' },
  };
}

/** Deleting a model removes both objects and the record, or changes nothing at all. */
export async function deleteModel(ctx: Ctx): Promise<Reply> {
  const model = await ownedModel(ctx);
  const original = originalKey(model.account_id, model.id);
  const thumbnail = thumbnailKey(model.account_id, model.id);
  try {
    await objectExists(original);
    await objectExists(thumbnail);
    await deleteObject(original);
    await deleteObject(thumbnail);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      await setStorageNotice(model.account_id, 'delete_unavailable');
      throw errors.storageUnavailable('delete');
    }
    throw error;
  }
  await pool.query('UPDATE characters SET model_id = NULL WHERE model_id = $1', [model.id]);
  await pool.query('DELETE FROM models WHERE id = $1', [model.id]);
  await setStorageNotice(model.account_id, null);
  return { status: 204 };
}

export async function getRulebook(ctx: Ctx): Promise<Reply> {
  const ids: RuleId[] = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10'];
  return {
    status: 200,
    body: {
      version: RULEBOOK_VERSION,
      validator: VALIDATOR_VERSION,
      rules: ids.map((id) => ({
        id,
        title: t(ctx.locale, `rule.${id}` as MessageKey),
        limit: RULE_LIMITS[id],
      })),
    },
  };
}
