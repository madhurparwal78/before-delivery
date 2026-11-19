import { ASSET_CLASS_LABELS } from '../../shared/labels.js';
import type { AdminAsset, AssetClass } from '../../shared/types.js';
import { appendAudit } from '../audit.js';
import { DERIVATIVE_MAX_BYTES } from '../config.js';
import { nextCounter, withTransaction, type Queryable } from '../db.js';
import type { AssetRecord, PrincipalRecord } from '../domain/records.js';
import { assetTransitions, wrongAssetState } from '../domain/transitions.js';
import { errors } from '../errors.js';
import { detectFormat, readPixelSize } from '../images.js';
import { jsonBody, parseMultipart, requireSignedIn, type Ctx } from '../http/context.js';
import { sendEmpty, sendJson } from '../http/respond.js';
import { EVERYONE, publish } from '../live.js';
import { repo } from '../repo.js';
import { rejectOpenRequestsOnAsset } from '../services/requests.js';
import { derivativeKey, storage, StorageUnavailable } from '../storage.js';

const SIZE_CONTRACTS: Partial<Record<AssetClass, { width: number; height: number }>> = {
  spot_icon: { width: 120, height: 120 },
  pictogram: { width: 64, height: 64 },
  ui_icon: { width: 24, height: 24 },
};

async function projectAsset(asset: AssetRecord, source?: Queryable): Promise<AdminAsset> {
  const derivatives = await repo.derivativesOfAsset(asset.id, source);
  const variants = await repo.variants(source);
  return {
    id: asset.id,
    name: asset.name,
    class: asset.assetClass,
    state: asset.state,
    successorId: asset.successorId,
    derivatives: derivatives.map((derivative) => ({
      id: derivative.id,
      variant: derivative.variantId
        ? (variants.find((variant) => variant.id === derivative.variantId)?.key ?? null)
        : null,
      fileName: derivative.fileName,
      format: derivative.format,
      width: derivative.width,
      height: derivative.height,
      byteSize: derivative.byteSize,
    })),
  };
}

export async function listAdminAssets(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  if (principal.role !== 'owner') throw errors.notFound();
  const assets = await repo.assets();
  const projected: AdminAsset[] = [];
  for (const asset of assets) projected.push(await projectAsset(asset));
  sendJson(ctx.res, 200, { assets: projected });
}

function requireOwner(ctx: Ctx): PrincipalRecord {
  const principal = requireSignedIn(ctx);
  if (principal.role !== 'owner') throw errors.forbidden();
  return principal;
}

async function requireAuditedOwner(ctx: Ctx, action: string, resourceId: string): Promise<PrincipalRecord> {
  const principal = requireSignedIn(ctx);
  if (principal.role === 'owner') return principal;
  await withTransaction(async (tx) => {
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action,
      resourceType: 'asset',
      resourceId,
      requestId: null,
      before: null,
      after: null,
      outcome: 'denied',
    });
  });
  throw errors.forbidden();
}

export async function addDerivative(ctx: Ctx): Promise<void> {
  const asset = await repo.asset(ctx.params['id'] ?? '');
  if (!asset) throw errors.notFound();
  requireOwner(ctx);

  if (asset.state !== 'draft') wrongAssetState(asset.name, asset.state);

  const multipart = parseMultipart(ctx);
  const file = multipart.file;
  if (!file) throw errors.derivativeType();
  const format = detectFormat(file.bytes);
  if (format !== 'png' && format !== 'svg') throw errors.derivativeType();
  if (multipart.truncated || file.bytes.length > DERIVATIVE_MAX_BYTES) throw errors.tooLarge();

  const size = readPixelSize(file.bytes, format);
  if (!size) throw errors.derivativeType();

  const variantKey = multipart.fields['variant'] ?? null;
  const variants = await repo.variants();
  const variant = variantKey
    ? (variants.find((candidate) => candidate.assetId === asset.id && candidate.key === variantKey) ?? null)
    : null;

  const objectKey = derivativeKey(asset.id, variant?.key ?? null, file.fileName);
  try {
    await storage.putObject(objectKey, file.bytes, format === 'png' ? 'image/png' : 'image/svg+xml');
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageWrite();
    throw error;
  }

  const created = await withTransaction(async (tx) => {
    const existing = await repo.derivativesOfAsset(asset.id, tx);
    const replaced = existing.find((candidate) => candidate.fileName === file.fileName);
    if (replaced) await tx.query('delete from derivatives where id = $1', [replaced.id]);
    const sort = replaced?.sort ?? existing.length;
    const assetKey = asset.id.replace(/^ast_/, '');
    const index = replaced?.id ?? `drv_${assetKey}_${await nextCounter(tx, `derivatives:${asset.id}`)}`;
    await tx.query(
      `insert into derivatives (id, asset_id, variant_id, file_name, format, width, height, byte_size, object_key, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        index,
        asset.id,
        variant?.id ?? null,
        file.fileName,
        format,
        size.width,
        size.height,
        file.bytes.length,
        objectKey,
        sort,
      ],
    );
    await publish(tx, { type: 'library.updated' }, EVERYONE);
    return {
      id: index,
      variant: variant?.key ?? null,
      fileName: file.fileName,
      format,
      width: size.width,
      height: size.height,
      byteSize: file.bytes.length,
    };
  });

  sendJson(ctx.res, 201, created);
}

export async function removeDerivative(ctx: Ctx): Promise<void> {
  const derivative = await repo.derivative(ctx.params['id'] ?? '');
  if (!derivative) throw errors.notFound();
  requireOwner(ctx);

  const asset = (await repo.asset(derivative.assetId))!;
  if (asset.state !== 'draft') wrongAssetState(asset.name, asset.state);

  try {
    await storage.deleteObject(derivative.objectKey);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageWrite();
    throw error;
  }

  await withTransaction(async (tx) => {
    await tx.query('delete from derivatives where id = $1', [derivative.id]);
    await publish(tx, { type: 'library.updated' }, EVERYONE);
  });
  sendEmpty(ctx.res, 204);
}

export async function releaseAsset(ctx: Ctx): Promise<void> {
  const asset = await repo.asset(ctx.params['id'] ?? '');
  if (!asset) throw errors.notFound();
  const principal = await requireAuditedOwner(ctx, 'asset.released', asset.id);

  if (!assetTransitions.canRelease(asset.state)) wrongAssetState(asset.name, asset.state);

  const derivatives = await repo.derivativesOfAsset(asset.id);
  if (derivatives.length === 0) throw errors.noDerivatives(asset.name);

  const contract = SIZE_CONTRACTS[asset.assetClass];
  const failures: string[] = [];
  for (const derivative of derivatives) {
    let head: { contentLength: number } | null;
    try {
      head = await storage.headObject(derivative.objectKey);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw errors.storageWrite();
      throw error;
    }
    if (!head || head.contentLength !== derivative.byteSize) {
      failures.push(`Cannot release: ${derivative.fileName} is missing from storage.`);
      continue;
    }
    if (contract && (derivative.width !== contract.width || derivative.height !== contract.height)) {
      failures.push(
        `Cannot release: ${derivative.fileName} is ${derivative.width} x ${derivative.height}; a ${ASSET_CLASS_LABELS[asset.assetClass]} must be ${contract.width} x ${contract.height}.`,
      );
    }
  }
  if (failures.length > 0) throw errors.sizeContract(failures);

  const updated = await withTransaction(async (tx) => {
    await tx.query(`update assets set state = 'released' where id = $1`, [asset.id]);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'asset.released',
      resourceType: 'asset',
      resourceId: asset.id,
      requestId: null,
      before: { state: asset.state },
      after: { state: 'released' },
      outcome: 'success',
    });
    await publish(tx, { type: 'library.updated' }, EVERYONE);
    return projectAsset((await repo.asset(asset.id, tx))!, tx);
  });

  sendJson(ctx.res, 200, updated);
}

export async function restrictAsset(ctx: Ctx): Promise<void> {
  const asset = await repo.asset(ctx.params['id'] ?? '');
  if (!asset) throw errors.notFound();
  const principal = await requireAuditedOwner(ctx, 'asset.restricted', asset.id);
  if (!assetTransitions.canRestrict(asset.state)) wrongAssetState(asset.name, asset.state);

  const updated = await withTransaction(async (tx) => {
    await tx.query(`update assets set state = 'restricted' where id = $1`, [asset.id]);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'asset.restricted',
      resourceType: 'asset',
      resourceId: asset.id,
      requestId: null,
      before: { state: 'released' },
      after: { state: 'restricted' },
      outcome: 'success',
    });
    await publish(tx, { type: 'library.updated' }, EVERYONE);
    return projectAsset((await repo.asset(asset.id, tx))!, tx);
  });
  sendJson(ctx.res, 200, updated);
}

export async function retireAsset(ctx: Ctx): Promise<void> {
  const asset = await repo.asset(ctx.params['id'] ?? '');
  if (!asset) throw errors.notFound();
  const principal = await requireAuditedOwner(ctx, 'asset.retired', asset.id);
  if (!assetTransitions.canRetire(asset.state)) wrongAssetState(asset.name, asset.state);

  const body = jsonBody<{ successorAssetId?: string }>(ctx);
  const successor = body.successorAssetId ? await repo.asset(body.successorAssetId) : null;
  if (!successor || successor.state !== 'released' || successor.id === asset.id) throw errors.successorInvalid();

  const updated = await withTransaction(async (tx) => {
    await tx.query(`update assets set state = 'retired', successor_id = $1 where id = $2`, [successor.id, asset.id]);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'asset.retired',
      resourceType: 'asset',
      resourceId: asset.id,
      requestId: null,
      before: { state: asset.state },
      after: { state: 'retired', successor: successor.id },
      outcome: 'success',
    });
    await rejectOpenRequestsOnAsset(tx, asset.id, successor.name, ctx.now);
    await publish(tx, { type: 'library.updated' }, EVERYONE);
    return projectAsset((await repo.asset(asset.id, tx))!, tx);
  });
  sendJson(ctx.res, 200, updated);
}
