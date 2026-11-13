// JSON import: refused at the first published problem, or a new project
// with its original bytes kept beside it.
import { sendJson } from '../http';
import { validationMessage, storageUnavailable, notFound } from '../errors';
import { COPY } from '../../domain/copy';
import type { RouteCtx } from '../routes';
import { requirePersonRoute, openProjectById, newId } from '../store';
import { parseMultipart } from './uploads';
import type { SceneBundle, SceneDocument, Layer, LayerKind, Variable } from '../../domain/kinds';
import { makeDefaultProps, DEFAULT_LIMITS } from '../../domain/props';
import { EASING_ORDER, EASING_DISPLAY } from '../../domain/kinds';

const LAYER_KINDS_SET = new Set<string>([
  'Rectangle',
  'Ellipse',
  'Polygon',
  'Text',
  'Image',
  'Gradient',
  'Effect',
  'Primitive',
  'Extrusion',
  'Model',
  'Particles',
  'Cloth',
  'Group',
]);

export async function handleImportRoutes(ctx: RouteCtx): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const raw = ctx.rawBody;
  if (!raw) throw validationMessage('Send a file.', 'file');
  const ct = ctx.req.headers['content-type'] ?? '';
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) throw validationMessage('Send a file.', 'file');
  const boundary = `--${m[1] ?? m[2]}`;
  const parts = parseMultipart(raw, boundary);
  const workspaceField = parts.find((p) => p.name === 'workspaceId');
  const fileField = parts.find((p) => p.name === 'file');
  if (!workspaceField || !fileField) throw validationMessage('Send a file.', 'file');
  const workspaceId = workspaceField.value.toString('utf8').trim();
  if (workspaceId !== person.workspaceId) {
    throw validationMessage(COPY.notFound, 'workspaceId');
  }
  const bytes = fileField.value;
  const fileName = fileField.filename ?? 'import.json';

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw validationMessage(COPY.importInvalidJson, 'file');
  }

  const doc = validateImportDocument(parsed);
  if (doc === null) {
    // The refusal details were thrown inside validateImportDocument.
    return;
  }

  const projectId = newId('prj');
  // Store the original bytes unchanged before the project becomes usable.
  const key = `projects/${projectId}/imports/original.json`;
  try {
    await ctx.app.s3.putObject(key, bytes, 'application/json');
    const head = await ctx.app.s3.headObject(key);
    if (!head || head.size !== bytes.length) throw new Error('confirm failed');
  } catch {
    throw storageUnavailable(COPY.importOutage);
  }

  const client = await ctx.app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO projects (id, workspace_id, name, status, created_at, import_original_key)
       VALUES ($1, $2, $3, 'active', now(), $4::text)`,
      [projectId, workspaceId, `${doc.name} (imported)`, key],
    );
    await client.query(
      `INSERT INTO members (project_id, person_id, role) VALUES ($1, $2, 'Owner')`,
      [projectId, person.id],
    );
    for (let i = 0; i < doc.scenes.length; i++) {
      await client.query(
        `INSERT INTO scenes (id, project_id, name, ord, doc, variables, presets)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
        [
          doc.scenes[i]!.id,
          projectId,
          doc.scenes[i]!.name,
          i,
          JSON.stringify(doc.scenes[i]),
          JSON.stringify(doc.variables),
          JSON.stringify(doc.presets),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();

  const { projectSummary } = await import('../store');
  sendJson(ctx.res, 201, {
    project: await projectSummary(ctx.app, projectId, 'Owner'),
  });
  void fileName;
}

export async function handleImportOriginal(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { project } = await openProjectById(ctx.app, ctx, projectId, person);
  if (!project?.import_original_key) throw notFound();
  const bytes = await ctx.app.s3.getObject(project.import_original_key);
  if (!bytes) throw notFound();
  ctx.res.writeHead(200, { 'content-type': 'application/json' });
  ctx.res.end(bytes);
}

interface ImportDoc extends SceneBundle {}

// Walks the document depth-first in key order, reporting the first problem.
function validateImportDocument(parsed: unknown): ImportDoc | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw validationMessage(COPY.importInvalidJson, 'file');
  }
  const root = parsed as Record<string, unknown>;
  if (!('schemaVersion' in root)) {
    throw validationMessage(COPY.importMissing('schemaVersion'), 'file');
  }
  const sv = root.schemaVersion;
  if (typeof sv !== 'number' || sv > 3 || sv < 1) {
    throw validationMessage(COPY.importSchema(Number(sv) || 0), 'file');
  }
  if (!('name' in root) || typeof root.name !== 'string') {
    throw validationMessage(COPY.importMissing('name'), 'file');
  }
  if (!('scenes' in root) || !Array.isArray(root.scenes)) {
    throw validationMessage(COPY.importMissing('scenes'), 'file');
  }
  const scenes: SceneDocument[] = [];
  root.scenes.forEach((rawScene, si) => {
    const scenePath = `scenes[${si}]`;
    if (typeof rawScene !== 'object' || rawScene === null) {
      throw validationMessage(COPY.importMissing(`${scenePath}.id`), 'file');
    }
    const scene = rawScene as Record<string, unknown>;
    if (!('id' in scene) || typeof scene.id !== 'string') {
      throw validationMessage(COPY.importMissing(`${scenePath}.id`), 'file');
    }
    if (!('name' in scene) || typeof scene.name !== 'string') {
      throw validationMessage(COPY.importMissing(`${scenePath}.name`), 'file');
    }
    if (!('layers' in scene) || !Array.isArray(scene.layers)) {
      throw validationMessage(COPY.importMissing(`${scenePath}.layers`), 'file');
    }
    const layers: Layer[] = [];
    scene.layers.forEach((rawLayer, li) => {
      const layerPath = `${scenePath}.layers[${li}]`;
      if (typeof rawLayer !== 'object' || rawLayer === null) {
        throw validationMessage(COPY.importMissing(`${layerPath}.id`), 'file');
      }
      const layer = rawLayer as Record<string, unknown>;
      if (!('id' in layer) || typeof layer.id !== 'string') {
        throw validationMessage(COPY.importMissing(`${layerPath}.id`), 'file');
      }
      if (!('name' in layer) || typeof layer.name !== 'string') {
        throw validationMessage(COPY.importMissing(`${layerPath}.name`), 'file');
      }
      if (!('kind' in layer) || typeof layer.kind !== 'string') {
        throw validationMessage(COPY.importMissing(`${layerPath}.kind`), 'file');
      }
      if (!LAYER_KINDS_SET.has(layer.kind as string)) {
        throw validationMessage(COPY.importKind(String(layer.kind), `${layerPath}.kind`), 'file');
      }
      const kind = layer.kind as LayerKind;
      const props =
        typeof layer.props === 'object' && layer.props !== null
          ? (layer.props as Record<string, unknown>)
          : makeDefaultProps(kind, null, DEFAULT_LIMITS);
      const built: Layer = {
        id: layer.id as string,
        name: layer.name as string,
        kind,
        parentId: typeof layer.parentId === 'string' ? layer.parentId : null,
        order: typeof layer.order === 'number' ? layer.order : 0,
        visible: layer.visible !== false,
        locked: layer.locked === true,
        maskAbove: layer.maskAbove === true,
        blendMode: (layer.blendMode as Layer['blendMode']) ?? 'Normal',
        props,
        overrides:
          typeof layer.overrides === 'object' && layer.overrides !== null
            ? (layer.overrides as Layer['overrides'])
            : { tablet: {}, mobile: {} },
        keyframes: Array.isArray(layer.keyframes) ? (layer.keyframes as Layer['keyframes']) : [],
        events:
          typeof layer.events === 'object' && layer.events !== null
            ? (layer.events as Layer['events'])
            : {},
        bindings:
          typeof layer.bindings === 'object' && layer.bindings !== null
            ? (layer.bindings as Layer['bindings'])
            : {},
      };
      // Range checks on the values present.
      checkRanges(built, layerPath);
      layers.push(built);
    });
    scenes.push({
      id: scene.id as string,
      name: scene.name as string,
      background: typeof scene.background === 'string' ? scene.background : '#0B0B0E',
      environment: (scene.environment as SceneDocument['environment']) ?? 'Flat',
      durationMs: typeof scene.durationMs === 'number' ? scene.durationMs : 5000,
      camera: {
        fov: numOr((scene.camera as Record<string, unknown>)?.fov, 50),
        position: vecOr((scene.camera as Record<string, unknown>)?.position, { x: 0, y: 0, z: 10 }),
        target: vecOr((scene.camera as Record<string, unknown>)?.target, { x: 0, y: 0, z: 0 }),
        near: numOr((scene.camera as Record<string, unknown>)?.near, 0.1),
        far: numOr((scene.camera as Record<string, unknown>)?.far, 100),
      },
      orbit: {
        enabled: ((scene.orbit as Record<string, unknown>)?.enabled as boolean) ?? false,
        startAngle: numOr((scene.orbit as Record<string, unknown>)?.startAngle, 0),
        endAngle: numOr((scene.orbit as Record<string, unknown>)?.endAngle, 90),
      },
      light: {
        enabled: ((scene.light as Record<string, unknown>)?.enabled as boolean) ?? true,
        sensitivity: numOr((scene.light as Record<string, unknown>)?.sensitivity, 1),
        momentum: numOr((scene.light as Record<string, unknown>)?.momentum, 1),
      },
      layers,
    });
  });
  const variables: Variable[] = Array.isArray(root.variables)
    ? (root.variables as Variable[])
    : [];
  const presets: SceneBundle['presets'] = Array.isArray(root.presets)
    ? (root.presets as SceneBundle['presets'])
    : [];
  return { schemaVersion: 3, name: root.name as string, variables, presets, scenes };
}

function numOr(v: unknown, def: number): number {
  return typeof v === 'number' ? v : def;
}

function vecOr(v: unknown, def: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  if (typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number') {
    const o = v as { x: number; y?: number; z?: number };
    return { x: o.x, y: o.y ?? 0, z: o.z ?? 0 };
  }
  return def;
}

// Range checks, in the order keys appear, reported one at a time.
function checkRanges(layer: Layer, layerPath: string): void {
  void EASING_ORDER;
  void EASING_DISPLAY;
  const ranges: [string, number, number][] = [
    ['x', -10000, 10000],
    ['y', -10000, 10000],
    ['width', 1, 10000],
    ['height', 1, 10000],
    ['opacity', 0, 100],
    ['sides', 3, 12],
    ['textSize', 8, 400],
    ['letterHeight', 0.1, 10],
    ['depth', 0.01, 10],
    ['bevelSize', 0, 0.5],
    ['bevelSegments', 1, 4],
    ['rate', 0, 600],
    ['burst', 0, 500],
    ['lifetime', 0.1, 10],
    ['speed', 0, 20],
    ['gravity', 0, 30],
    ['trailLength', 0, 32],
    ['orbit', -720, 720],
    ['columns', 4, 20],
    ['rows', 4, 20],
    ['clothGravity', 0, 30],
    ['windStrength', 0, 20],
    ['windDirection', 0, 359],
    ['stiffness', 0.1, 1],
    ['damping', 0, 0.2],
    ['iterations', 1, 10],
  ];
  for (const [prop, min, max] of ranges) {
    const v = layer.props[prop];
    if (typeof v === 'number' && (v < min || v > max)) {
      throw validationMessage(
        COPY.importRange(`${layerPath}.props.${prop}`, String(v), min, max),
        'file',
      );
    }
  }
  const pos = layer.props.position as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (pos) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = pos[axis];
      if (typeof v === 'number' && (v < -100 || v > 100)) {
        throw validationMessage(
          COPY.importRange(`${layerPath}.props.position.${axis}`, String(v), -100, 100),
          'file',
        );
      }
    }
  }
  const rot = layer.props.rotation as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (rot) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = rot[axis];
      if (typeof v === 'number' && (v < -360 || v > 360)) {
        throw validationMessage(
          COPY.importRange(`${layerPath}.props.rotation.${axis}`, String(v), -360, 360),
          'file',
        );
      }
    }
  }
  const scale = layer.props.scale as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (scale) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = scale[axis];
      if (typeof v === 'number' && (v < 0.01 || v > 100)) {
        throw validationMessage(
          COPY.importRange(`${layerPath}.props.scale.${axis}`, String(v), 0.01, 100),
          'file',
        );
      }
    }
  }
}
