import type { Ctx, Method } from './http';
import { requireSession } from './http';
import { query, withTransaction, type Tx } from './db';
import {
  forbidden,
  noDerivatives,
  notFound,
  seedConflict,
  successorInvalid,
  storageChanges,
  derivativeType,
  tooLarge,
  wrongStateAsset,
  ApiError,
} from './errors';
import type { Config } from './config';
import { readClock } from './clock';
import { appendAudit } from './audit';
import { notify } from './pglisten';
import { S3Client } from './s3client';
import { storageReachable } from './routes-grants';
import { auditDenied } from './audit-denied';
import { created } from './created';
import { CLASS_LABELS, type AssetClass } from '../shared/domain';
import { formatDay } from './datetime';

const SIZE_CONTRACTS: Partial<Record<AssetClass, { width: number; height: number }>> = {
  spot_icon: { width: 120, height: 120 },
  pictogram: { width: 64, height: 64 },
  ui_icon: { width: 24, height: 24 },
};

export const DERIVATIVE_MAX_BYTES = 10485760;

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47) return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

function svgSize(bytes: Buffer): { width: number; height: number } | null {
  const text = bytes.toString('utf8').slice(0, 4096);
  const root = /<svg[^>]*>/.exec(text);
  if (!root) return null;
  const w = /\bwidth\s*=\s*"(\d+)"/.exec(root[0]);
  const h = /\bheight\s*=\s*"(\d+)"/.exec(root[0]);
  if (!w || !h) return null;
  return { width: Number(w[1]), height: Number(h[1]) };
}

export function routeAssets(
  router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void },
  cfg: Config,
  s3: S3Client,
): void {
  router.add('GET', '/admin/assets', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner') throw notFound();
    const assets = await query<{
      id: string;
      name: string;
      class: string;
      state: string;
      successor_id: string | null;
      licence_id: string;
    }>(`SELECT id, name, class, state, successor_id, licence_id FROM assets ORDER BY name, id`);
    const out = [];
    for (const asset of assets) {
      const derivatives = await query<{
        id: string;
        file_name: string;
        format: string;
        width: number;
        height: number;
        byte_size: string;
        variant_key: string | null;
      }>(
        `SELECT d.id, d.file_name, d.format, d.width, d.height, d.byte_size, v.key AS variant_key
           FROM derivatives d LEFT JOIN variants v ON v.id = d.variant_id
          WHERE d.asset_id = $1 ORDER BY d.position`,
        [asset.id],
      );
      out.push({
        id: asset.id,
        name: asset.name,
        class: asset.class,
        classLabel: CLASS_LABELS[asset.class as AssetClass] ?? asset.class,
        state: asset.state,
        successorId: asset.successor_id,
        derivatives: derivatives.map((d) => ({
          id: d.id,
          variant: d.variant_key,
          fileName: d.file_name,
          format: d.format,
          width: d.width,
          height: d.height,
          byteSize: Number(d.byte_size),
        })),
      });
    }
    return { assets: out };
  });

  router.add('POST', '/assets/:id/derivatives', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner') throw forbidden();
    const asset = await query<{ id: string; name: string; state: string }>(
      'SELECT id, name, state FROM assets WHERE id = $1',
      [ctx.params.id],
    );
    if (asset.length === 0) throw notFound();
    if (asset[0].state !== 'draft') throw wrongStateAsset(asset[0].name, stateWord(asset[0].state));
    if (!ctx.body.file) throw derivativeType();
    const bytes = ctx.body.file.bytes;
    if (bytes.length > DERIVATIVE_MAX_BYTES) throw tooLarge();
    const lower = ctx.body.file.fileName.toLowerCase();
    if (!lower.endsWith('.png') && !lower.endsWith('.svg')) throw derivativeType();
    const size = lower.endsWith('.png') ? pngSize(bytes) : svgSize(bytes);
    if (!size) throw derivativeType();
    const ok = await storageReachable(s3);
    if (!ok) throw storageChanges();
    const variantKey = ctx.body.fields['variant'] || null;
    const variantId = variantKey
      ? (await query<{ id: string }>('SELECT id FROM variants WHERE asset_id = $1 AND key = $2', [
          asset[0].id,
          variantKey,
        ]))[0]?.id ?? null
      : null;
    const now = await readClock(cfg);
    const derivativeId = await withTransaction(async (tx) => {
      const existing = await txRows<{ id: string; variant_id: string | null }>(
        tx,
        'SELECT id, variant_id FROM derivatives WHERE asset_id = $1 AND file_name = $2',
        [asset[0].id, ctx.body.file!.fileName],
      );
      const count = await txRows<{ c: number }>(tx, 'SELECT COUNT(*)::int AS c FROM derivatives WHERE asset_id = $1', [
        asset[0].id,
      ]);
      let id: string;
      if (existing.length > 0) {
        id = existing[0].id;
        await s3.put(derivativeKey(asset[0].id, variantId, ctx.body.file!.fileName), bytes, 'application/octet-stream');
        await tx.query(
          `UPDATE derivatives SET variant_id = $2, format = $3, width = $4, height = $5, byte_size = $6 WHERE id = $1`,
          [id, variantId, lower.endsWith('.png') ? 'png' : 'svg', size.width, size.height, bytes.length],
        );
      } else {
        const seq = await tx.query<{ next: string }>(
          `SELECT 'drv_' || $1 || '_' || ((SELECT COUNT(*) FROM derivatives WHERE asset_id = $1) + 1)::text AS next`,
          [asset[0].id],
        );
        id = seq.rows[0].next;
        await s3.put(derivativeKey(asset[0].id, variantId, ctx.body.file!.fileName), bytes, 'application/octet-stream');
        await tx.query(
          `INSERT INTO derivatives (id, asset_id, variant_id, file_name, format, width, height, byte_size, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            asset[0].id,
            variantId,
            ctx.body.file!.fileName,
            lower.endsWith('.png') ? 'png' : 'svg',
            size.width,
            size.height,
            bytes.length,
            count[0].c,
          ],
        );
      }
      await notify(tx, JSON.stringify({ type: 'library.updated' }));
      return id;
    });
    void now;
    return created({
      id: derivativeId,
      fileName: ctx.body.file.fileName,
      format: lower.endsWith('.png') ? 'png' : 'svg',
      width: size.width,
      height: size.height,
      byteSize: bytes.length,
    });
  });

  router.add('DELETE', '/derivatives/:id', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner') throw forbidden();
    const derivative = await query<{ id: string; asset_id: string; asset_name: string; asset_state: string; file_name: string; variant_id: string | null }>(
      `SELECT d.id, d.asset_id, a.name AS asset_name, a.state AS asset_state, d.file_name, d.variant_id
         FROM derivatives d JOIN assets a ON a.id = d.asset_id WHERE d.id = $1`,
      [ctx.params.id],
    );
    if (derivative.length === 0) throw notFound();
    if (derivative[0].asset_state !== 'draft') {
      throw wrongStateAsset(derivative[0].asset_name, stateWord(derivative[0].asset_state));
    }
    const ok = await storageReachable(s3);
    if (!ok) throw storageChanges();
    await withTransaction(async (tx) => {
      await s3.remove(derivativeKey(derivative[0].asset_id, derivative[0].variant_id, derivative[0].file_name));
      await tx.query('DELETE FROM derivatives WHERE id = $1', [derivative[0].id]);
      await notify(tx, JSON.stringify({ type: 'library.updated' }));
    });
    return null;
  });

  router.add('POST', '/assets/:id/release', async (ctx) => {
    const principal = requireSession(ctx);
    const asset = await query<{ id: string; name: string; class: string; state: string }>(
      'SELECT id, name, class, state FROM assets WHERE id = $1',
      [ctx.params.id],
    );
    if (asset.length === 0) throw notFound();
    if (principal.role !== 'owner') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'asset.released',
          resourceType: 'asset',
          resourceId: asset[0].id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    if (asset[0].state !== 'draft' && asset[0].state !== 'restricted') {
      throw wrongStateAsset(asset[0].name, stateWord(asset[0].state));
    }
    const derivatives = await query<{
      id: string;
      file_name: string;
      width: number;
      height: number;
      byte_size: string;
      variant_id: string | null;
    }>(
      'SELECT id, file_name, width, height, byte_size, variant_id FROM derivatives WHERE asset_id = $1 ORDER BY position',
      [asset[0].id],
    );
    if (derivatives.length === 0) throw noDerivatives(asset[0].name);
    const ok = await storageReachable(s3);
    if (!ok) throw storageChanges();
    const contract = SIZE_CONTRACTS[asset[0].class as AssetClass];
    const failures: string[] = [];
    for (const derivative of derivatives) {
      const objectKey = derivativeKey(asset[0].id, derivative.variant_id, derivative.file_name);
      const head = await s3.head(objectKey);
      if (!head || head.size !== Number(derivative.byte_size)) {
        failures.push(`Cannot release: ${derivative.file_name} is missing from storage.`);
        continue;
      }
      if (contract && (derivative.width !== contract.width || derivative.height !== contract.height)) {
        failures.push(
          `Cannot release: ${derivative.file_name} is ${derivative.width} x ${derivative.height}; a ${
            CLASS_LABELS[asset[0].class as AssetClass]
          } must be ${contract.width} x ${contract.height}.`,
        );
      }
    }
    if (failures.length > 0) {
      throw new ApiError(422, 'size_contract', failures.join('\n'));
    }
    const now = await readClock(cfg);
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE assets SET state = 'released' WHERE id = $1`, [asset[0].id]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'asset.released',
        resourceType: 'asset',
        resourceId: asset[0].id,
        requestId: null,
        before: { state: asset[0].state },
        after: { state: 'released' },
        outcome: 'success',
      });
      await notify(tx, JSON.stringify({ type: 'library.updated' }));
      await notify(tx, JSON.stringify({ type: 'chapter.updated' }));
    });
    return assetOut(asset[0].id);
  });

  router.add('POST', '/assets/:id/restrict', async (ctx) => {
    const principal = requireSession(ctx);
    const asset = await query<{ id: string; name: string; state: string }>(
      'SELECT id, name, state FROM assets WHERE id = $1',
      [ctx.params.id],
    );
    if (asset.length === 0) throw notFound();
    if (principal.role !== 'owner') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'asset.restricted',
          resourceType: 'asset',
          resourceId: asset[0].id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    if (asset[0].state !== 'released') throw wrongStateAsset(asset[0].name, stateWord(asset[0].state));
    const now = await readClock(cfg);
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE assets SET state = 'restricted' WHERE id = $1`, [asset[0].id]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'asset.restricted',
        resourceType: 'asset',
        resourceId: asset[0].id,
        requestId: null,
        before: { state: 'released' },
        after: { state: 'restricted' },
        outcome: 'success',
      });
      await notify(tx, JSON.stringify({ type: 'library.updated' }));
    });
    return assetOut(asset[0].id);
  });

  router.add('POST', '/assets/:id/retire', async (ctx) => {
    const principal = requireSession(ctx);
    const body = asRecord(ctx.body.json);
    const successorAssetId = typeof body.successorAssetId === 'string' ? body.successorAssetId : '';
    const asset = await query<{ id: string; name: string; state: string }>(
      'SELECT id, name, state FROM assets WHERE id = $1',
      [ctx.params.id],
    );
    if (asset.length === 0) throw notFound();
    if (principal.role !== 'owner') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'asset.retired',
          resourceType: 'asset',
          resourceId: asset[0].id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    if (asset[0].state !== 'released' && asset[0].state !== 'restricted') {
      throw wrongStateAsset(asset[0].name, stateWord(asset[0].state));
    }
    const successor = await query<{ id: string; name: string; state: string }>(
      'SELECT id, name, state FROM assets WHERE id = $1',
      [successorAssetId],
    );
    if (successor.length === 0 || successor[0].state !== 'released') throw successorInvalid();
    const now = await readClock(cfg);
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE assets SET state = 'retired', successor_id = $2 WHERE id = $1`, [
        asset[0].id,
        successorAssetId,
      ]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'asset.retired',
        resourceType: 'asset',
        resourceId: asset[0].id,
        requestId: null,
        before: { state: asset[0].state },
        after: { state: 'retired', successor: successorAssetId },
        outcome: 'success',
      });
      const open = await txRows<{ id: string; n: number; kind: string; assignee_id: string | null }>(
        tx,
        `SELECT id, 1 AS n, 'brand' AS kind, NULL AS assignee_id FROM requests
          WHERE asset_id = $1 AND state IN ('draft','routed','under_review','changes_requested')`,
        [asset[0].id],
      );
      for (const request of open) {
        await tx.query(
          `UPDATE requests SET state = 'rejected', holder_id = requester_id WHERE id = $1`,
          [request.id],
        );
        const stages = await tx.query<{ n: number }>(
          'SELECT n FROM request_stages WHERE request_id = $1 AND decision IS NULL ORDER BY n',
          [request.id],
        );
        for (const stage of stages.rows) {
          await tx.query(
            `UPDATE request_stages SET decision = 'reject', decided_at = $2, comment = $3 WHERE request_id = $1 AND n = $4`,
            [request.id, now, `Asset retired. Use ${successor[0].name} instead.`, stage.n],
          );
        }
        await appendAudit(tx, {
          occurredAt: now,
          actorId: 'system',
          actorRole: 'system',
          action: 'request.decided',
          resourceType: 'request',
          resourceId: request.id,
          requestId: request.id,
          before: { state: 'under_review' },
          after: {
            decision: 'reject',
            stage: stages.rows[0]?.n ?? 1,
            state: 'rejected',
            comment: `Asset retired. Use ${successor[0].name} instead.`,
          },
          outcome: 'success',
        });
      }
      await notify(tx, JSON.stringify({ type: 'library.updated' }));
      await notify(tx, JSON.stringify({ type: 'queue.updated' }));
    });
    return assetOut(asset[0].id);
  });
}

export function derivativeKey(assetId: string, variantId: string | null, fileName: string): string {
  const variantPart = variantId
    ? `variants/${variantId.replace(/^var_[a-z0-9-]+_/, '')}`
    : 'base';
  return `derivatives/${assetId}/${variantPart}/${fileName}`;
}

export function stateWord(state: string): string {
  return state;
}

async function assetOut(assetId: string): Promise<unknown> {
  const rows = await query<{ id: string; name: string; class: string; state: string; successor_id: string | null }>(
    'SELECT id, name, class, state, successor_id FROM assets WHERE id = $1',
    [assetId],
  );
  const derivatives = await query<{ id: string; file_name: string; format: string; width: number; height: number; byte_size: string; variant_id: string | null }>(
    'SELECT id, file_name, format, width, height, byte_size, variant_id FROM derivatives WHERE asset_id = $1 ORDER BY position',
    [assetId],
  );
  const variantIds = derivatives.map((d) => d.variant_id);
  const variants = variantIds.filter((v) => v !== null).length > 0
    ? await query<{ id: string; key: string }>('SELECT id, key FROM variants WHERE id = ANY($1)', [variantIds])
    : [];
  const keyOf = new Map(variants.map((v) => [v.id, v.key]));
  return {
    id: rows[0].id,
    name: rows[0].name,
    class: rows[0].class,
    state: rows[0].state,
    successorId: rows[0].successor_id,
    derivatives: derivatives.map((d) => ({
      id: d.id,
      variant: d.variant_id ? keyOf.get(d.variant_id) ?? null : null,
      fileName: d.file_name,
      format: d.format,
      width: d.width,
      height: d.height,
      byteSize: Number(d.byte_size),
    })),
  };
}

async function txRows<T extends Record<string, unknown>>(tx: Tx, sql: string, params: readonly unknown[]): Promise<T[]> {
  const res = await tx.query(sql, params as unknown[]);
  return res.rows as T[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export { seedConflict, formatDay, storageReachable };
