import { createHash } from 'node:crypto';
import { canEditScenes } from '../../shared/states.js';
import {
  CONTENT_TYPES,
  checkSelfContained,
  checkUploadName,
  isModelUnit,
  measureExtent,
  scaleToMetres,
  sniffUpload,
  type AssetKind,
  type ModelUnit,
} from '../../shared/uploads.js';
import { fieldCopy } from '../../shared/copy.js';
import { one, query } from '../db.js';
import { faults } from '../errors.js';
import { newId } from '../ids.js';
import { created, ok, raw, type Ctx, type Reply, type Route } from '../http.js';
import { assetRow, recordActivity, requireProject, type AssetDbRow } from '../repo.js';
import { StorageDown, getObject, putObject, storageKeys } from '../s3.js';

async function uploadAsset(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const project = await requireProject(ctx.params.pid, account.id);
  if (!canEditScenes(project.role)) throw faults.forbidden();

  const name = ctx.query('name') ?? '';
  const nameFailure = checkUploadName(name);
  if (nameFailure) throw faults.validation({ [nameFailure.field]: nameFailure.message });

  const unitText = ctx.query('unit') ?? 'm';
  if (!isModelUnit(unitText)) throw faults.validation({ unit: fieldCopy.uploadUnit });
  const unit: ModelUnit = unitText;

  const bytes = ctx.rawBody;
  const sniffed = sniffUpload(bytes);
  if ('failure' in sniffed)
    throw faults.validation({ [sniffed.failure.field]: sniffed.failure.message });

  let extentMetres: number | null = null;
  if (sniffed.kind === 'glb' || sniffed.kind === 'gltf') {
    const external = checkSelfContained(sniffed.json);
    if (external) throw faults.validation({ [external.field]: external.message });
    const measured = measureExtent(sniffed.json, unit);
    if ('failure' in measured)
      throw faults.validation({ [measured.failure.field]: measured.failure.message });
    extentMetres = measured.extentMetres;
  }

  const kind: AssetKind = sniffed.kind;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const existing = await one<AssetDbRow>(
    `select id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres, created_at
       from assets where project_id = $1 and sha256 = $2`,
    [project.projectId, sha256],
  );
  if (existing) return ok({ asset: assetRow(existing) });

  try {
    await putObject(storageKeys.asset(project.projectId, sha256), bytes, CONTENT_TYPES[kind]);
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }

  const isModel = kind === 'glb' || kind === 'gltf';
  const id = newId();
  const rows = await query<AssetDbRow>(
    `insert into assets (id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (project_id, sha256) do update set name = assets.name
     returning id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres, created_at`,
    [
      id,
      project.projectId,
      name,
      kind,
      bytes.length,
      sha256,
      isModel ? unit : null,
      isModel ? scaleToMetres(unit) : null,
      extentMetres,
    ],
  );
  await query('update projects set updated_at = now() where id = $1', [project.projectId]);
  await recordActivity(project.workspaceId, account.id, 'asset.uploaded', name);
  return created({ asset: assetRow(rows[0]) });
}

async function downloadOriginal(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const row = await one<AssetDbRow & { workspace_id: string }>(
    `select a.id, a.project_id, a.name, a.kind, a.bytes, a.sha256, a.unit, a.scale_to_metres,
            a.extent_metres, a.created_at, p.workspace_id
       from assets a
       join projects p on p.id = a.project_id
       join memberships m on m.workspace_id = p.workspace_id
      where a.id = $1 and m.user_id = $2`,
    [ctx.params.aid, account.id],
  );
  if (!row) throw faults.notFound();
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(storageKeys.asset(row.project_id, row.sha256));
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }
  if (!bytes) throw faults.notFound();
  return raw(bytes, CONTENT_TYPES[row.kind], { etag: `"${row.sha256}"` });
}

export const assetRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/projects/:pid/assets', handler: uploadAsset, raw: true },
  { method: 'GET', pattern: '/api/assets/:aid/original', handler: downloadOriginal },
];
