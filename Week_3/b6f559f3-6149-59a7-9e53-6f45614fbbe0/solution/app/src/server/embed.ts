/** The public embed: the page, the live bundle, the live version number and the assets the live version uses. */
import { MESSAGES } from '../shared/messages';
import type { SceneDocument } from '../shared/types';
import { now } from './clock';
import { query } from './db';
import { ASSET_HEADERS, json, notFound, router, storageDown, type Ctx, type Reply } from './http';
import { assetKey, bundleKey, StorageUnavailable } from './s3';
import { storage } from './services';
import { shellPage } from './static';

interface LiveVersion {
  number: number;
  bundle: Buffer;
}

/** The live version of a project that is active and not purged, or null: the only thing an embed ever shows. */
async function liveVersion(projectId: string): Promise<LiveVersion | null> {
  if (projectId.includes('\u0000')) return null;
  const rows = await query<LiveVersion>(
    `SELECT v.number, v.bundle FROM versions v JOIN projects p ON p.id = v.project_id
     WHERE v.project_id = $1 AND v.status = 'live' AND p.status = 'active' AND (p.purge_at IS NULL OR p.purge_at > $2)`,
    [projectId, (await now()).toISOString()],
  );
  return rows[0] ?? null;
}

const NOT_PUBLISHED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>Halation Studio embed</title>
<style>html,body{margin:0;height:100%;background:#0b0b0e;color:#8b8a98;font:15px system-ui,"Segoe UI",Roboto,sans-serif}
main{min-height:100%;display:grid;place-items:center;padding:15px;text-align:center}</style></head>
<body><main><p>${MESSAGES.notPublished}</p></main></body></html>`;

async function embedPage(ctx: Ctx): Promise<Reply> {
  const live = await liveVersion(ctx.param('projectId'));
  const headers = { 'Cache-Control': 'no-store' };
  if (!live) return { status: 404, raw: NOT_PUBLISHED_PAGE, contentType: 'text/html; charset=utf-8', headers };
  return shellPage('embed.html');
}

async function embedScene(ctx: Ctx): Promise<Reply> {
  const projectId = ctx.param('projectId');
  const live = await liveVersion(projectId);
  if (!live) return notFound();
  let bytes: Buffer | null = null;
  try {
    bytes = await storage.get(bundleKey(projectId, live.number));
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
  return {
    status: 200,
    raw: bytes ?? live.bundle,
    contentType: 'application/json',
    headers: { 'X-Halation-Version': String(live.number), 'X-Scene-Source': bytes ? 'bundle' : 'row', 'Cache-Control': 'no-store' },
  };
}

async function embedVersion(ctx: Ctx): Promise<Reply> {
  const live = await liveVersion(ctx.param('projectId'));
  if (!live) return notFound();
  return json(200, { number: live.number }, { 'Cache-Control': 'no-store' });
}

const ASSET_PROPS = ['assetId', 'svgAssetId', 'modelAssetId'];

/** Asset ids the layers of a document point at. */
function usedAssets(document: SceneDocument): Set<string> {
  const ids = new Set<string>();
  for (const scene of document.scenes) {
    for (const layer of scene.layers) {
      for (const prop of ASSET_PROPS) {
        const value = layer.props[prop];
        if (typeof value === 'string') ids.add(value);
        for (const level of [layer.overrides.tablet, layer.overrides.mobile]) {
          const override = level[prop];
          if (typeof override === 'string') ids.add(override);
        }
      }
    }
  }
  return ids;
}

async function embedAsset(ctx: Ctx): Promise<Reply> {
  const projectId = ctx.param('projectId');
  const assetId = ctx.param('assetId');
  const live = await liveVersion(projectId);
  if (!live || !usedAssets(JSON.parse(live.bundle.toString('utf8')) as SceneDocument).has(assetId)) return notFound();
  const rows = await query<{ content_type: string }>(`SELECT content_type FROM assets WHERE id = $1 AND project_id = $2 AND status = 'confirmed'`, [assetId, projectId]);
  const asset = rows[0];
  if (!asset) return notFound();
  let bytes: Buffer | null;
  try {
    bytes = await storage.get(assetKey(projectId, assetId));
  } catch (error) {
    if (error instanceof StorageUnavailable) return storageDown(MESSAGES.storageUploads);
    throw error;
  }
  if (!bytes) return notFound();
  return { status: 200, raw: bytes, contentType: asset.content_type, headers: { ...ASSET_HEADERS, 'Cache-Control': 'no-store' } };
}

export function registerEmbedRoutes(): void {
  router.get('/embed/:projectId', embedPage);
  router.get('/api/embed/:projectId/scene', embedScene);
  router.get('/api/embed/:projectId/version', embedVersion);
  router.get('/api/embed/:projectId/assets/:assetId', embedAsset);
}
