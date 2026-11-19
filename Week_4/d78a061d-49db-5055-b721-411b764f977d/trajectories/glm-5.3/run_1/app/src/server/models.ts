import { query, transaction } from './db.js';
import { StorageUnavailable, putObject, deleteObject, objectExists, originalKey, thumbnailKey, sha256, getObject } from './storage.js';
import { judgeModel, type Report } from './rulebook.js';
import { silhouetteThumbnail } from './thumbnail.js';
import { sanitizeFilename, MAX_UPLOAD_BYTES, MODEL_QUOTA_BYTES, rulebookVersion } from '../shared/domain.js';

export type ModelRow = {
  id: string;
  account_id: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  status: 'stored' | 'validating' | 'accepted' | 'equipped' | 'rejected';
  rulebook_version: string | null;
  report: Report | null;
  created_at: Date;
};

export function modelJson(m: ModelRow): Record<string, unknown> {
  return {
    id: m.id,
    filename: m.filename,
    size_bytes: m.size_bytes,
    sha256: m.sha256,
    status: m.status,
    rulebook_version: m.rulebook_version,
    report: m.report,
    created_at: m.created_at.toISOString(),
  };
}

const listableStatuses = "('stored','validating','accepted','equipped','rejected')";

export async function modelsForAccount(accountId: string): Promise<ModelRow[]> {
  const res = await query<ModelRow>(
    `select id, account_id, filename, size_bytes, sha256, status, rulebook_version, report, created_at
       from models where account_id = $1 and status::text in ${listableStatuses}
       order by created_at desc`,
    [accountId],
  );
  return res.rows;
}

export async function modelById(id: string): Promise<ModelRow | null> {
  const res = await query<ModelRow>(
    'select id, account_id, filename, size_bytes, sha256, status, rulebook_version, report, created_at from models where id = $1',
    [id],
  );
  return res.rows[0] ?? null;
}

export async function quotaUsed(accountId: string): Promise<number> {
  const res = await query<{ total: string | null }>(
    'select coalesce(sum(size_bytes), 0) as total from models where account_id = $1',
    [accountId],
  );
  return Number(res.rows[0]?.total ?? 0);
}

export function intakeChecks(contentType: string | undefined, buf: Buffer): { error?: 'unsupported_type' | 'not_gltf' } {
  if (contentType !== 'model/gltf-binary' && contentType !== 'application/octet-stream') {
    return { error: 'unsupported_type' };
  }
  if (buf.subarray(0, 4).toString('ascii') !== 'glTF') return { error: 'not_gltf' };
  return {};
}

/**
 * Stores the original in MinIO, then writes the record. If the record write fails,
 * the object it wrote is removed (DP-69). Decided in this one function.
 */
export async function storeUpload(accountId: string, filename: string, buf: Buffer): Promise<ModelRow> {
  const id = crypto.randomUUID();
  const filenameClean = sanitizeFilename(filename);
  const digest = sha256(buf);
  const size = buf.length;
  if (size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('too large'), { code: 'too_large' });
  const used = await quotaUsed(accountId);
  if (used + size > MODEL_QUOTA_BYTES) throw Object.assign(new Error('quota'), { code: 'quota_exceeded' });
  try {
    await putObject(originalKey(accountId, id), buf, 'model/gltf-binary');
  } catch {
    throw Object.assign(new Error('storage'), { code: 'storage_unavailable' });
  }
  try {
    const res = await query<ModelRow>(
      `insert into models (id, account_id, filename, size_bytes, sha256, status)
       values ($1, $2, $3, $4, $5, 'stored')
       returning id, account_id, filename, size_bytes, sha256, status, rulebook_version, report, created_at`,
      [id, accountId, filenameClean, size, digest],
    );
    return res.rows[0] as ModelRow;
  } catch {
    try {
      await deleteObject(originalKey(accountId, id));
    } catch {
      // storage refused the cleanup; the orphan is invisible without a record
    }
    throw Object.assign(new Error('record failed'), { code: 'record_write_failed' });
  }
}

export async function startValidation(model: ModelRow): Promise<void> {
  const updated = await query<ModelRow>(
    "update models set status = 'validating' where id = $1 and status = 'stored' returning id, account_id, filename, size_bytes, sha256, status, rulebook_version, report, created_at",
    [model.id],
  );
  if (updated.rows.length === 0) return;
  void validateAndFinish(updated.rows[0] as ModelRow);
}

export async function validateAndFinish(model: ModelRow): Promise<void> {
  let buf: Buffer;
  try {
    buf = await getObject(originalKey(model.account_id, model.id));
  } catch {
    return;
  }
  const report = await judgeModel(buf);
  const status = report.failed_count === 0 ? 'accepted' : 'rejected';
  await query(
    'update models set status = $1, rulebook_version = $2, report = $3 where id = $4 and status in (\'stored\',\'validating\')',
    [status, rulebookVersion, JSON.stringify(report), model.id],
  );
  if (status === 'accepted') {
    try {
      await putObject(thumbnailKey(model.account_id, model.id), silhouetteThumbnail(), 'image/png');
    } catch {
      // thumbnail is optional; the verdict stands
    }
  }
  await notifyModelStatus(model.account_id, model.id, status, report.failed_count);
}

export async function resumePendingValidation(accountId: string): Promise<void> {
  const res = await query<ModelRow>(
    "select id, account_id, filename, size_bytes, sha256, status, rulebook_version, report, created_at from models where account_id = $1 and status in ('stored','validating')",
    [accountId],
  );
  for (const row of res.rows) await validateAndFinish(row);
}

async function notifyModelStatus(accountId: string, modelId: string, status: string, failedCount: number | null): Promise<void> {
  const { publishModelStatus } = await import('./realtime.js');
  publishModelStatus(accountId, modelId, status, failedCount);
}

/** The all-or-nothing model delete (DP-69), decided in this one function. */
export async function deleteModel(accountId: string, modelId: string): Promise<void> {
  const model = await modelById(modelId);
  if (!model || model.account_id !== accountId) throw Object.assign(new Error('not found'), { code: 'not_found' });
  try {
    // First confirm both objects can be reached; an already-missing object counts as removed.
    try {
      await objectExists(originalKey(accountId, modelId));
    } catch (err) {
      if (!(err instanceof StorageUnavailable)) throw err;
      throw err;
    }
    await deleteObject(originalKey(accountId, modelId));
    try {
      await deleteObject(thumbnailKey(accountId, modelId));
    } catch {
      // The original removal is what frees the record; a missing thumbnail is fine.
    }
  } catch {
    throw Object.assign(new Error('storage'), { code: 'storage_unavailable' });
  }
  await transaction(async (client) => {
    await client.query('update characters set model_id = null where model_id = $1', [modelId]);
    await client.query('delete from models where id = $1', [modelId]);
  });
}

export async function equipModel(accountId: string, modelId: string, characterId: string): Promise<void> {
  await query('update characters set model_id = $1 where id = $2 and account_id = $3', [modelId, characterId, accountId]);
  await transaction(async (client) => {
    const used = await client.query<{ count: string }>('select count(*) as count from characters where model_id = $1', [modelId]);
    const count = Number(used.rows[0]?.count ?? 0);
    if (count > 0) {
      await client.query("update models set status = 'equipped' where id = $1 and status = 'accepted'", [modelId]);
    } else {
      await client.query("update models set status = 'accepted' where id = $1 and status = 'equipped'", [modelId]);
    }
  });
}

export async function refreshEquipState(modelId: string): Promise<void> {
  await transaction(async (client) => {
    const used = await client.query<{ count: string }>('select count(*) as count from characters where model_id = $1', [modelId]);
    const count = Number(used.rows[0]?.count ?? 0);
    if (count > 0) {
      await client.query("update models set status = 'equipped' where id = $1 and status = 'accepted'", [modelId]);
    } else {
      await client.query("update models set status = 'accepted' where id = $1 and status = 'equipped'", [modelId]);
    }
  });
}

export async function readModelFile(accountId: string, modelId: string): Promise<Buffer> {
  try {
    return await getObject(originalKey(accountId, modelId));
  } catch {
    throw Object.assign(new Error('storage'), { code: 'storage_unavailable' });
  }
}

export async function readThumbnail(accountId: string, modelId: string): Promise<Buffer> {
  try {
    return await getObject(thumbnailKey(accountId, modelId));
  } catch {
    throw Object.assign(new Error('storage'), { code: 'storage_unavailable' });
  }
}

export async function setStorageNotice(accountId: string, notice: 'upload_unavailable' | 'delete_unavailable' | null): Promise<void> {
  await query('update accounts set storage_notice = $1 where id = $2', [notice, accountId]);
}
