// Inspector: the server's evaluator, shared with the client stage.
import { sendJson } from '../http';
import { notFound, validationMessage } from '../errors';
import type { RouteCtx } from '../routes';
import { openProjectById, requirePersonRoute } from '../store';
import { evaluateScene, makeEvalContext } from '../../domain/evaluate';
import { formatTimeReadout } from '../../domain/format';
import { buildReadouts } from '../readouts';
import type { SceneBundle, SceneDocument, Variable, Vec3, Breakpoint } from '../../domain/kinds';

export async function handleInspect(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  await openProjectById(ctx.app, ctx, projectId, person);
  const q = ctx.query;
  const sceneParam = q.get('scene');
  if (!sceneParam) throw validationMessage('Enter a name.', 'scene');
  const frame = Number(q.get('frame') ?? 0);
  if (!Number.isFinite(frame) || frame < 0) throw validationMessage('Must be between 0 and 100000.', 'frame');
  const bpParam = (q.get('breakpoint') ?? 'desktop') as Breakpoint;
  if (!['desktop', 'tablet', 'mobile'].includes(bpParam)) {
    throw validationMessage('Choose one of the listed breakpoints.', 'breakpoint');
  }
  const scroll = Number(q.get('scroll') ?? 0);
  if (!Number.isFinite(scroll) || scroll < 0 || scroll > 100) {
    throw validationMessage('Must be between 0 and 100.', 'scroll');
  }
  const reducedMotion = q.get('reducedMotion') === '1';

  const version = q.get('version');
  let bundle: SceneBundle;
  if (version) {
    const n = Number(version);
    const res = await ctx.app.pool.query<{ doc: unknown }>(
      `SELECT doc FROM versions WHERE project_id = $1 AND number = $2`,
      [projectId, n],
    );
    const row = res.rows[0];
    if (!row) throw notFound();
    bundle = row.doc as SceneBundle;
  } else {
    bundle = await loadBundle(ctx.app, projectId);
  }
  const doc = bundle.scenes.find((s) => s.id === sceneParam) ?? bundle.scenes[0];
  if (!doc) throw notFound();
  const layerId = q.get('layer');
  const layer = layerId ? doc.layers.find((l) => l.id === layerId) : undefined;

  const modelInfo = await collectModelInfo(ctx.app, projectId, doc);
  const ec = makeEvalContext({
    frame,
    breakpoint: bpParam,
    scroll,
    reducedMotion,
    pointer: null,
    pointerFrames: 0,
    hoverLayerIds: new Set(),
    hoverFrames: 0,
    limits: { particleMax: ctx.app.limits.particleMax },
    modelInfo,
    svgInfo: await collectSvgInfo(ctx.app, projectId, doc),
  });
  const resolved = evaluateScene(doc, ec, bundle.variables);
  const resolvedLayer = layer ? resolved.layers.find((l) => l.layer.id === layer.id) : undefined;

  const values: Record<string, number | string> = {};
  const sources: Record<string, string> = {};
  if (resolvedLayer) {
    for (const [path, value] of Object.entries(flatten(resolvedLayer.props))) {
      values[path] = formattedValue(value);
      const src = resolvedLayer.sources[path];
      if (src && src !== 'desktop') {
        sources[path] = src === 'tablet' ? 'Tablet' : 'Mobile';
      }
    }
  }

  const readouts = buildReadouts(ctx.app, doc, resolved, resolvedLayer, {
    frame,
    vertex: q.get('vertex'),
    particle: q.get('particle'),
    point: q.get('point'),
    node: q.get('node'),
    sampleX: q.get('sampleX'),
    sampleY: q.get('sampleY'),
    bundle,
    modelInfo,
  });

  sendJson(ctx.res, 200, {
    frame,
    time: formatTimeReadout(frame),
    breakpoint: bpParam,
    values,
    sources,
    readouts,
  });
}

async function loadBundle(app: import('../app').App, projectId: string): Promise<SceneBundle> {
  const vars = await app.pool.query<{ variables: unknown; presets: unknown }>(
    `SELECT variables, presets FROM scenes WHERE project_id = $1 ORDER BY ord LIMIT 1`,
    [projectId],
  );
  const scenes = await app.pool.query<{ doc: unknown }>(
    `SELECT doc FROM scenes WHERE project_id = $1 ORDER BY ord`,
    [projectId],
  );
  return {
    schemaVersion: 3,
    name: '',
    variables: (vars.rows[0]?.variables as Variable[]) ?? [],
    presets: (vars.rows[0]?.presets as SceneBundle['presets']) ?? [],
    scenes: scenes.rows.map((s) => s.doc as SceneDocument),
  };
}

async function collectModelInfo(
  app: import('../app').App,
  projectId: string,
  doc: SceneDocument,
): Promise<Map<string, import('../../domain/evaluate').ModelInfo>> {
  const out = new Map<string, import('../../domain/evaluate').ModelInfo>();
  for (const layer of doc.layers) {
    if (layer.kind !== 'Model') continue;
    const assetId = layer.props.modelAssetId as string | null;
    if (!assetId) {
      // Preset models
      out.set(layer.id, presetModelInfo(layer.props.preset as string | null));
      continue;
    }
    const res = await app.pool.query<{ parsed: unknown }>(
      `SELECT parsed FROM assets WHERE id = $1 AND project_id = $2`,
      [assetId, projectId],
    );
    const parsed = res.rows[0]?.parsed as import('../../domain/evaluate').ModelInfo | undefined;
    if (parsed) out.set(layer.id, parsed);
  }
  return out;
}

function presetModelInfo(preset: string | null): import('../../domain/evaluate').ModelInfo {
  const presets: Record<string, { min: Vec3; max: Vec3 }> = {
    Pebble: { min: { x: -0.6, y: -0.35, z: -0.5 }, max: { x: 0.6, y: 0.35, z: 0.5 } },
    Arch: { min: { x: -0.8, y: -0.5, z: -0.3 }, max: { x: 0.8, y: 0.5, z: 0.3 } },
    Lattice: { min: { x: -0.5, y: -0.5, z: -0.5 }, max: { x: 0.5, y: 0.5, z: 0.5 } },
  };
  const box = presets[preset ?? 'Pebble']!;
  return {
    min: box.min,
    max: box.max,
    clips: [],
    nodes: [{ name: 'Root', translation: { x: 0, y: 0, z: 0 }, rotation: [0, 0, 0, 1], scale: { x: 1, y: 1, z: 1 } }],
  };
}

async function collectSvgInfo(
  app: import('../app').App,
  projectId: string,
  doc: SceneDocument,
): Promise<Map<string, import('../../domain/evaluate').SvgInfo>> {
  const out = new Map<string, import('../../domain/evaluate').SvgInfo>();
  for (const layer of doc.layers) {
    if (layer.kind !== 'Extrusion') continue;
    if (layer.props.source !== 'svg') continue;
    const assetId = layer.props.svgAssetId as string | null;
    if (!assetId) continue;
    const res = await app.pool.query<{ parsed: unknown }>(
      `SELECT parsed FROM assets WHERE id = $1 AND project_id = $2`,
      [assetId, projectId],
    );
    const parsed = res.rows[0]?.parsed as import('../../domain/evaluate').SvgInfo | undefined;
    if (parsed) out.set(layer.id, parsed);
  }
  return out;
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, path));
    } else {
      out[path] = v;
    }
  }
  return out;
}

function formattedValue(v: unknown): number | string {
  if (typeof v === 'number') return Math.round(v * 1000) / 1000;
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  return String(v);
}
