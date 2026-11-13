import { findScene } from '../../shared/document';
import { evaluate, sceneFrames, type Query } from '../../shared/evaluator';
import { MESSAGES, mustBeBetween } from '../../shared/messages';
import { ARTBOARDS, BREAKPOINTS, type Breakpoint, type SceneDocument } from '../../shared/types';
import { openProject } from '../access';
import { config } from '../config';
import { pool, query } from '../db';
import { loadAssets, loadDocument } from '../documents';
import { invalid, json, router, type Ctx } from '../http';

function whole(ctx: Ctx, name: string, min: number, max: number): number | undefined {
  const raw = ctx.q(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value) || value < min || value > max) return invalid(name, mustBeBetween(min, max));
  return value;
}

function parseQuery(ctx: Ctx, document: SceneDocument): { scene: SceneDocument['scenes'][number]; query: Query } {
  const sceneId = ctx.q('scene');
  if (sceneId === null || sceneId === '') return invalid('scene', MESSAGES.invalidValue);
  const scene = findScene(document, sceneId);
  if (!scene) return invalid('scene', MESSAGES.unknownField);
  const breakpointRaw = ctx.q('breakpoint') ?? 'desktop';
  if (!(BREAKPOINTS as readonly string[]).includes(breakpointRaw)) return invalid('breakpoint', MESSAGES.invalidValue);
  const breakpoint = breakpointRaw as Breakpoint;
  const frame = whole(ctx, 'frame', 0, sceneFrames(scene)) ?? 0;
  const scrollRaw = ctx.q('scroll');
  const scroll = scrollRaw === null ? 0 : Number(scrollRaw);
  if (scrollRaw !== null && (scrollRaw.trim() === '' || !Number.isFinite(scroll) || scroll < 0 || scroll > 100)) invalid('scroll', mustBeBetween(0, 100));
  const reduced = ctx.q('reducedMotion') ?? '0';
  if (reduced !== '0' && reduced !== '1') invalid('reducedMotion', mustBeBetween(0, 1));
  const layerId = ctx.q('layer') ?? undefined;
  if (layerId !== undefined && !scene.layers.some((l) => l.id === layerId)) invalid('layer', MESSAGES.unknownLayer);
  const board = ARTBOARDS[breakpoint];
  const evaluation: Query = {
    layerId,
    frame,
    breakpoint,
    scroll,
    reducedMotion: reduced === '1',
    vertex: ctx.q('vertex') ?? undefined,
    particle: whole(ctx, 'particle', 1, 1_000_000),
    point: ctx.q('point') ?? undefined,
    node: ctx.q('node') ?? undefined,
    sampleX: whole(ctx, 'sampleX', 0, board.width - 1),
    sampleY: whole(ctx, 'sampleY', 0, board.height - 1),
  };
  return { scene, query: evaluation };
}

router.get('/api/projects/:id/inspect', async (ctx) => {
  const { project } = await openProject(ctx, ctx.param('id'));
  let document: SceneDocument = (await loadDocument(pool, project.id)).document;
  const versionRaw = ctx.q('version');
  if (versionRaw !== null) {
    const number = Number(versionRaw);
    if (!Number.isInteger(number) || number < 1) return invalid('version', MESSAGES.invalidValue);
    const rows = await query<{ document: SceneDocument }>('SELECT document FROM versions WHERE project_id = $1 AND number = $2', [project.id, number]);
    if (!rows[0]) return invalid('version', MESSAGES.invalidValue);
    document = rows[0].document;
  }
  const { scene, query: evaluation } = parseQuery(ctx, document);
  const assets = new Map((await loadAssets(pool, project.id)).map((asset) => [asset.id, asset]));
  return json(200, evaluate(document, scene, evaluation, assets, { particleMax: config.particleMax }));
});
