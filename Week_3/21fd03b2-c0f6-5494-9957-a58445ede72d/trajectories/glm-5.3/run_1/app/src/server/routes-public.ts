import { app, assetSummary } from './routes';
import { withClient, withTransaction } from './db';
import { AppError, asyncHandler, linkNotFound } from './errors';
import { sha256 } from './crypto';
import { PUBLIC_URL, presenceBody } from './shared';
import { loadScene, loadDocument, documentBytes, computeStateHash } from './scenes';
import { KIND_SPECS } from '../bench/scene';
import { simulate, stateHashInput } from '../bench/sim';
import { COPY } from '../bench/copy';
import { storageGet } from './storage';
import type { SceneDocument } from '../bench/scene';

type AssetRow = { id: string; name: string; kind: string; bytes: number; sha256: string; unit: string | null; scale_to_metres: number | null; extent_metres: number | null; created_at: Date };

type LabRow = {
  scene_id: string;
  token: string;
  bundle_hash: string;
  published_at: Date;
  checkpoint_id: string;
  exposed: string[];
  status: string;
};

async function activeLab(token: string): Promise<LabRow | null> {
  return withClient(async (client) => {
    const row = await client.query("SELECT * FROM labs WHERE token = $1 AND status = 'active'", [token]);
    return row.rows[0] ?? null;
  });
}

app.get('/api/labs/:token', asyncHandler(async (req, res) => {
  const lab = await activeLab(req.params.token!);
  if (!lab) throw linkNotFound();
  const data = await withClient(async (client) => {
    const scene = await loadScene(client, lab.scene_id);
    if (!scene) return null;
    const doc = await loadDocument(client, scene.id, lab.checkpoint_id ? (await checkpointRevision(client, lab)) : scene.revision);
    return { scene, doc };
  });
  if (!data) throw linkNotFound();
  const exposed = (Array.isArray(lab.exposed) ? lab.exposed : JSON.parse(lab.exposed as unknown as string)) as string[];
  const exposedSpecs = exposed.map((key) => {
    const [objectId, param] = String(key).split('.');
    const object = data.doc.objects.find((o) => o.id === objectId);
    const spec = object ? KIND_SPECS[object.kind].params.find((p) => p.key === param) : undefined;
    return {
      key,
      label: `${object?.name ?? objectId}: ${spec?.label ?? param}`,
      min: spec?.min ?? 0,
      max: spec?.max ?? 1,
      step: spec?.step ?? 0.1,
      unit: spec?.group === 'length' ? 'm' : spec?.group === 'mass' ? 'kg' : spec?.group === 'angle' ? 'deg' : '',
      value: object?.params[param ?? ''] ?? 0,
    };
  });
  res.json({
    lab: {
      sceneName: data.scene.name,
      bundleHash: lab.bundle_hash,
      publishedAt: new Date(lab.published_at).toISOString(),
      exposed: exposedSpecs,
    },
    document: data.doc,
  });
}));

async function checkpointRevision(client: Parameters<typeof loadScene>[0], lab: LabRow): Promise<number> {
  const row = await client.query('SELECT revision FROM checkpoints WHERE id = $1', [lab.checkpoint_id]);
  return row.rows[0].revision;
}

app.get('/api/labs/:token/bundle', asyncHandler(async (req, res) => {
  const lab = await activeLab(req.params.token!);
  if (!lab) throw linkNotFound();
  const bytes = await storageGet(`labs/${lab.scene_id}/${lab.bundle_hash}.json`);
  res.setHeader('Content-Type', 'application/json');
  res.send(bytes);
}));

app.get('/api/labs/:token/assets/:sha', asyncHandler(async (req, res) => {
  const lab = await activeLab(req.params.token!);
  if (!lab) throw linkNotFound();
  const bundle = JSON.parse((await storageGet(`labs/${lab.scene_id}/${lab.bundle_hash}.json`)).toString('utf8')) as {
    assets: Array<{ sha256: string; kind: string }>;
  };
  const asset = bundle.assets.find((a) => a.sha256 === req.params.sha);
  if (!asset) throw linkNotFound();
  const row = await withClient(async (client) => {
    const result = await client.query('SELECT * FROM assets WHERE sha256 = $1 AND kind = $2', [req.params.sha, asset.kind]);
    return result.rows[0];
  });
  if (!row) throw linkNotFound();
  const bytes = await storageGet(`assets/${row.project_id}/${req.params.sha}`);
  res.setHeader('Content-Type', asset.kind === 'glb' ? 'model/gltf-binary' : asset.kind === 'gltf' ? 'model/gltf+json' : asset.kind === 'png' ? 'image/png' : 'image/jpeg');
  res.setHeader('ETag', `"${req.params.sha}"`);
  res.send(bytes);
}));

app.post('/api/labs/:token/verify', asyncHandler(async (req, res) => {
  const lab = await activeLab(req.params.token!);
  if (!lab) throw linkNotFound();
  const body = req as typeof req & { jsonBody?: unknown };
  const parsed = body.jsonBody as { steps?: number; params?: Record<string, number> } | undefined;
  const steps = Number(parsed?.steps ?? NaN);
  if (!Number.isInteger(steps) || steps < 1 || steps > 12000) {
    throw new AppError(422, 'validation', COPY.fieldErrors.steps, { steps: COPY.fieldErrors.steps });
  }
  const exposed = (Array.isArray(lab.exposed) ? lab.exposed : JSON.parse(lab.exposed as unknown as string)) as string[];
  const params = parsed?.params ?? {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!exposed.includes(key)) {
      fields[key] = COPY.fieldErrors.unexposed(key);
      continue;
    }
    const [objectId, param] = String(key).split('.');
    const scene = await withClient(async (client) => loadScene(client, lab.scene_id));
    if (!scene) throw linkNotFound();
    void scene;
    const revision = await withClient(async (client) => checkpointRevision(client, lab));
    const doc = await withClient(async (client) => loadDocument(client, scene.id, revision));
    const object = doc.objects.find((o) => o.id === objectId);
    const spec = object ? KIND_SPECS[object.kind].params.find((p) => p.key === param) : undefined;
    if (spec && !(Number(value) >= spec.min && Number(value) <= spec.max)) {
      fields[key] = COPY.fieldErrors.range(spec.min, spec.max);
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new AppError(422, 'validation', 'There is a problem', fields);
  }
  const revision = await withClient(async (client) => checkpointRevision(client, lab));
  const doc = await withClient(async (client) => loadDocument(client, lab.scene_id, revision));
  const state = simulate(doc, steps, params);
  res.json({ step: steps, stateHash: sha256(stateHashInput(state)) });
}));

// ---------- read-only view links ----------

type ShareLinkRow = { id: string; project_id: string; token: string; status: string; expires_at: Date };

async function activeShareLink(token: string): Promise<ShareLinkRow | null> {
  return withClient(async (client) => {
    const row = await client.query("SELECT * FROM share_links WHERE token = $1 AND status = 'active' AND expires_at > now()", [token]);
    return row.rows[0] ?? null;
  });
}

app.get('/api/view/:token', asyncHandler(async (req, res) => {
  const link = await activeShareLink(req.params.token!);
  if (!link) throw linkNotFound();
  const data = await withClient(async (client) => {
    const project = await client.query('SELECT * FROM projects WHERE id = $1', [link.project_id]);
    if (!project.rows[0]) return null;
    const scenes = await client.query('SELECT id, name, revision FROM scenes WHERE project_id = $1 ORDER BY created_at ASC', [link.project_id]);
    const withHash = await Promise.all(scenes.rows.map(async (row: { id: string; name: string; revision: number }) => {
      const doc = await loadDocument(client, row.id, row.revision);
      return { id: row.id, name: row.name, stateHash: computeStateHash(doc, 0) };
    }));
    return { project: project.rows[0], scenes: withHash };
  });
  if (!data) throw linkNotFound();
  res.json({ project: { name: data.project.name }, scenes: data.scenes });
}));

app.get('/api/view/:token/scenes/:sid', asyncHandler(async (req, res) => {
  const link = await activeShareLink(req.params.token!);
  if (!link) throw linkNotFound();
  const data = await withClient(async (client) => {
    const scene = await loadScene(client, req.params.sid!);
    if (!scene || scene.project_id !== link.project_id) return null;
    const doc = await loadDocument(client, scene.id, scene.revision);
    const modelIds = doc.objects.filter((o) => o.kind === 'model' && o.assetId).map((o) => o.assetId!);
    const assetRows = modelIds.length > 0
      ? await client.query('SELECT * FROM assets WHERE id = ANY($1)', [modelIds])
      : { rows: [] as Array<Record<string, unknown>> };
    return { scene, doc, assets: assetRows.rows as Array<AssetRow> };
  });
  if (!data) throw linkNotFound();
  res.json({
    scene: {
      id: data.scene.id,
      projectId: data.scene.project_id,
      name: data.scene.name,
      status: data.scene.status,
      revision: data.scene.revision,
      stateHash: computeStateHash(data.doc, 0),
      lab: null,
    },
    document: data.doc,
    assets: data.assets.map(assetSummary),
  });
}));

app.get('/api/view/:token/scenes/:sid/live', asyncHandler(async (req, res) => {
  const link = await activeShareLink(req.params.token!);
  if (!link) throw linkNotFound();
  const scene = await withClient(async (client) => {
    const row = await loadScene(client, req.params.sid!);
    if (!row || row.project_id !== link.project_id) return null;
    return row;
  });
  if (!scene) throw linkNotFound();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
  let lastRevision = scene.revision;
  const timer = setInterval(async () => {
    try {
      const stillActive = await activeShareLink(req.params.token!);
      if (!stillActive) {
        res.write('event: link_dead\ndata: {}\n\n');
        clearInterval(timer);
        res.end();
        return;
      }
      const current = await withClient(async (client) => loadScene(client, req.params.sid!));
      if (current && current.revision !== lastRevision) {
        lastRevision = current.revision;
        const doc = await withClient(async (client) => loadDocument(client, current.id, current.revision));
        res.write(`event: revision\ndata: ${JSON.stringify({ revision: current.revision, stateHash: computeStateHash(doc, 0) })}\n\n`);
      }
    } catch {
      clearInterval(timer);
      res.end();
    }
  }, 1000);
  const heartbeat = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 10000);
  res.on('close', () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  });
}));

app.get('/api/view/:token/assets/:sha', asyncHandler(async (req, res) => {
  const link = await activeShareLink(req.params.token!);
  if (!link) throw linkNotFound();
  const asset = await withClient(async (client) => {
    const row = await client.query('SELECT * FROM assets WHERE sha256 = $1 AND project_id = $2', [req.params.sha, link.project_id]);
    return row.rows[0];
  });
  if (!asset || asset.kind === 'png' || asset.kind === 'jpeg') throw linkNotFound();
  const bytes = await storageGet(`assets/${asset.project_id}/${asset.sha256}`);
  res.setHeader('Content-Type', asset.kind === 'glb' ? 'model/gltf-binary' : 'model/gltf+json');
  res.setHeader('ETag', `"${asset.sha256}"`);
  res.send(bytes);
}));

app.post('/api/view/:token/scenes/:sid/verify', asyncHandler(async (req, res) => {
  const link = await activeShareLink(req.params.token!);
  if (!link) throw linkNotFound();
  const scene = await withClient(async (client) => {
    const row = await loadScene(client, req.params.sid!);
    if (!row || row.project_id !== link.project_id) return null;
    return row;
  });
  if (!scene) throw linkNotFound();
  const body = req as typeof req & { jsonBody?: unknown };
  const parsed = body.jsonBody as { steps?: number; params?: Record<string, number> } | undefined;
  const steps = Number(parsed?.steps ?? NaN);
  if (!Number.isInteger(steps) || steps < 1 || steps > 12000) {
    throw new AppError(422, 'validation', COPY.fieldErrors.steps, { steps: COPY.fieldErrors.steps });
  }
  const doc = await withClient(async (client) => loadDocument(client, scene.id, scene.revision));
  const state = simulate(doc, steps, parsed?.params ?? {});
  res.json({ step: steps, stateHash: sha256(stateHashInput(state)) });
}));

// HEAD acts exactly like GET on every /api/view path, without a body.
app.use('/api/view/:token', (req, res, next) => {
  if (req.method === 'HEAD') {
    req.method = 'GET';
    // express will still respond as HEAD by stripping the body
    (req as typeof req & { originalMethod: string }).originalMethod = 'HEAD';
    next();
    return;
  }
  // Any other method except the verify POST answers 405 read_only.
  const isVerifyPost = req.method === 'POST' && /\/api\/view\/[^/]+\/scenes\/[^/]+\/verify$/.test(req.originalUrl.split('?')[0] ?? '');
  if (isVerifyPost) {
    next();
    return;
  }
  res.status(405).setHeader('Allow', 'GET, HEAD');
  res.json({ error: { code: 'read_only', message: 'This link is read-only.' } });
});
