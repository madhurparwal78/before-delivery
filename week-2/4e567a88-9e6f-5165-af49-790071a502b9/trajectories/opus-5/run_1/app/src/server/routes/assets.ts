import { config } from '../config';
import { db, tx } from '../db';
import { assetViews, lineageOf, matchesSearch, singleAssetView } from '../domain/assetViews';
import { assetAccessFor } from '../domain/projection';
import { fail } from '../errors';
import { Ctx, Router, created, noContent, ok } from '../http/router';
import { noteStorageFailure, storageIsUp } from '../services/deps';
import { extensionFor, pixelSizeOf } from '../services/media';
import { StorageUnavailable, deleteObject, putObject } from '../services/s3';
import { assetById, insertAsset, isGone, liveAssets, markRemoved } from '../store/assets';
import { allModels } from '../store/catalogue';
import { allTeams } from '../store/people';
import { AssetRecord, JsonValue } from '../types';
import { policyNow, requireRole, resolveTeam } from './support';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function registerAssetRoutes(router: Router): void {
  router.add('POST', '/api/uploads', 'raw', async (ctx) => {
    requireRole(ctx.caller, ['member']);
    const team = await resolveTeam(ctx, { required: false });
    const contentType = (ctx.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!IMAGE_TYPES.includes(contentType as (typeof IMAGE_TYPES)[number])) {
      throw fail.unsupportedMediaType('Use a PNG, JPEG or WebP image.');
    }
    if (ctx.raw.length === 0) throw fail.validation({ body: 'Send the image bytes as the request body.' });
    if (!storageIsUp()) throw fail.storageUnavailable();
    const policy = await policyNow();
    const size = pixelSizeOf(contentType, ctx.raw);
    const extension = extensionFor(contentType);
    const expiresAt = new Date(Date.now() + policy.retention_days * config.retentionDaySeconds * 1000);
    const asset = await tx(async (client) =>
      insertAsset(client, {
        teamId: team.id,
        kind: 'upload',
        mediaType: contentType,
        jobId: null,
        modelSlug: null,
        width: size?.width ?? null,
        height: size?.height ?? null,
        durationSeconds: null,
        bytes: ctx.raw.length,
        expiresAt,
        storageKeyFor: (assetId) => `uploads/${team.id}/${assetId}.${extension}`,
        prompt: null,
        ownerMemberId: ctx.caller.member.id,
        outputIndex: null,
      }),
    );
    try {
      await putObject(asset.storageKey, ctx.raw, contentType);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        noteStorageFailure();
        throw fail.storageUnavailable();
      }
      throw error;
    }
    const view = await singleAssetView(asset, ctx.caller.member, policy);
    return created({ asset: view!.json });
  });

  router.add('GET', '/api/assets', 'none', async (ctx) => {
    const policy = await policyNow();
    const query = ctx.query.get('q') ?? '';
    const kind = ctx.query.get('kind');
    const modelSlug = ctx.query.get('model');
    const requestedTeam = ctx.query.get('team');
    const teams = await allTeams();
    if (requestedTeam !== null && !teams.some((team) => team.id === requestedTeam)) throw fail.notFound();
    const assets = await liveAssets({
      teamIds: requestedTeam === null ? null : [requestedTeam],
      kind,
      modelSlug,
      limit: 500,
    });
    const views = await assetViews(assets, ctx.caller.member, policy);
    const models = await allModels();
    const names = new Map(models.map((model) => [model.slug, model.name]));
    const matching = views.filter((view) =>
      matchesSearch({ view, modelName: view.asset.modelSlug === null ? null : names.get(view.asset.modelSlug) ?? null }, query),
    );
    return ok({ assets: matching.slice(0, 100).map((view) => view.json) as unknown as JsonValue });
  });

  router.add('GET', '/api/assets/:id', 'none', async (ctx) => {
    const policy = await policyNow();
    const asset = await readableAsset(ctx);
    const state = isGone(asset, new Date());
    if (state.gone) throw fail.assetGone(state.removedAt.toISOString(), state.reason);
    const view = await singleAssetView(asset, ctx.caller.member, policy);
    if (!view) throw fail.notFound();
    return ok({ asset: view.json });
  });

  router.add('GET', '/api/assets/:id/lineage', 'none', async (ctx) => {
    const policy = await policyNow();
    const asset = await readableAsset(ctx);
    const state = isGone(asset, new Date());
    if (state.gone) throw fail.assetGone(state.removedAt.toISOString(), state.reason);
    const lineage = await lineageOf(asset.id, ctx.caller.member, policy, new Date());
    return ok({ nodes: lineage.nodes, edges: lineage.edges as unknown as JsonValue });
  });

  router.add('DELETE', '/api/assets/:id', 'none', async (ctx) => {
    const asset = await readableAsset(ctx);
    if (ctx.caller.member.role !== 'compliance' && ctx.caller.member.role !== 'admin') throw fail.forbidden();
    const state = isGone(asset, new Date());
    if (state.gone) throw fail.assetGone(state.removedAt.toISOString(), state.reason);
    if (!storageIsUp()) throw fail.storageUnavailable();
    try {
      await deleteObject(asset.storageKey);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        noteStorageFailure();
        throw fail.storageUnavailable();
      }
      throw error;
    }
    await markRemoved(db, asset.id, 'deleted', new Date());
    return noContent();
  });
}

/** Resolves an asset id, answering not_found before any gone or role refusal. */
async function readableAsset(ctx: Ctx): Promise<AssetRecord> {
  const policy = await policyNow();
  const asset = await assetById(ctx.params['id']!);
  if (!asset) throw fail.notFound();
  if (assetAccessFor(asset, ctx.caller.member, policy) === 'hidden') throw fail.notFound();
  return asset;
}
