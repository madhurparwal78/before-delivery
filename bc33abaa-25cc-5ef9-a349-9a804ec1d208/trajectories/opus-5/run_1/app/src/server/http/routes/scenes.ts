import { Express } from 'express';
import { Author } from '../../../shared/api';
import { Graph } from '../../../shared/graph';
import { RawOp } from '../../../shared/ops';
import { query } from '../../db/pool';
import {
  SceneRow,
  applyBatch,
  claimLock,
  getScene,
  graphAt,
  hashGraph,
  listLocks,
  listOps,
  redoBatch,
  refreshHolderLocks,
  releaseLock,
  restoreToSeq,
  takeoverLock,
  undoBatch,
} from '../../domain/scenes';
import { PRESENCE_TTL_SECONDS, toIso } from '../../domain/time';
import { writeAudit } from '../../domain/workspace';
import { SceneEvent, publish, subscribe } from '../../realtime/bus';
import { mirror } from '../../services/pocketbase';
import { randomId } from '../../util/crypto';
import { fail } from '../errors';
import {
  CallerContext,
  body,
  param,
  queryInteger,
  requireCaller,
  requirePermission,
  requireString,
  requireWritableWorkspace,
} from '../context';
import { route } from '../route';

const STARTING_GRAPH: Graph = {
  nodes: [
    {
      id: 'n_root',
      name: 'Scene',
      kind: 'group',
      parentId: null,
      primitive: null,
      assetId: null,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      materialLayers: [],
      visible: true,
    },
    {
      id: 'n_cam',
      name: 'Main camera',
      kind: 'camera',
      parentId: 'n_root',
      primitive: null,
      assetId: null,
      position: [0, 1.2, 4],
      rotation: [-15, 0, 0],
      scale: [1, 1, 1],
      materialLayers: [],
      visible: true,
    },
    {
      id: 'n_key',
      name: 'Key light',
      kind: 'light',
      parentId: 'n_root',
      primitive: null,
      assetId: null,
      position: [2, 3, 2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      materialLayers: [],
      visible: true,
    },
  ],
  states: [{ id: 'rest', name: 'Rest', overrides: [] }],
  transitions: [],
  cameraViews: [],
};

export function startingGraph(): Graph {
  return JSON.parse(JSON.stringify(STARTING_GRAPH)) as Graph;
}

async function loadScene(context: CallerContext, sceneId: string): Promise<SceneRow> {
  const scene = await getScene(sceneId, context.workspace.id);
  if (!scene) throw fail.notFound();
  return scene;
}

function parseOps(body: Record<string, unknown>): RawOp[] {
  const raw = body.ops;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 200) {
    throw fail.validation({ ops: 'Must hold 1 to 200 operations' });
  }
  return raw.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw fail.validation({ [`ops[${index}]`]: 'Must be an operation object' });
    }
    const op = entry as Record<string, unknown>;
    if (typeof op.type !== 'string') {
      throw fail.validation({ [`ops[${index}].type`]: 'Unknown operation' });
    }
    const payload =
      op.payload !== null && typeof op.payload === 'object' && !Array.isArray(op.payload)
        ? (op.payload as Record<string, unknown>)
        : null;
    if (!payload) {
      throw fail.validation({ [`ops[${index}].payload`]: 'Must be an object' });
    }
    return { type: op.type, payload };
  });
}

async function presenceAuthors(
  sceneId: string,
): Promise<{ author: Author; selection: string | null }[]> {
  const rows = await query<{
    author_kind: 'member' | 'agent';
    author_id: string;
    author_name: string;
    selection: string | null;
  }>(
    `SELECT author_kind, author_id, author_name, selection FROM presence
     WHERE scene_id = $1 AND seen_at > now() - ($2 || ' seconds')::interval
     ORDER BY author_name`,
    [sceneId, PRESENCE_TTL_SECONDS],
  );
  return rows.map((row) => ({
    author: { kind: row.author_kind, id: row.author_id, name: row.author_name },
    selection: row.selection,
  }));
}

export function registerSceneRoutes(app: Express): void {
  app.get(
    '/api/scenes',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'scene.read');
      const rows = await query<{
        id: string;
        name: string;
        latest_seq: number;
        updated_at: Date;
        published_version: number | null;
      }>(
        `SELECT s.id, s.name, s.latest_seq, s.updated_at,
                (SELECT v.number FROM versions v
                  WHERE v.scene_id = s.id AND v.state = 'published'
                  ORDER BY v.number DESC LIMIT 1) AS published_version
         FROM scenes s WHERE s.workspace_id = $1
         ORDER BY s.updated_at DESC`,
        [context.workspace.id],
      );
      res.json({
        scenes: rows.map((row) => ({
          id: row.id,
          name: row.name,
          latestSeq: row.latest_seq,
          updatedAt: toIso(row.updated_at),
          publishedVersion: row.published_version,
        })),
      });
    }),
  );

  app.post(
    '/api/scenes',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      requirePermission(context, 'scene.create');
      requireWritableWorkspace(context);
      const name = requireString(input, 'name', { min: 1, max: 80 });
      const id = randomId('sc');
      await query(
        `INSERT INTO scenes (id, workspace_id, name, base_graph, latest_seq)
         VALUES ($1, $2, $3, $4::jsonb, 0)`,
        [id, context.workspace.id, name, JSON.stringify(startingGraph())],
      );
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'scene.created',
        target: { type: 'scene', id },
      });
      res.status(201).json({ id, name, latestSeq: 0 });
    }),
  );

  app.get(
    '/api/scenes/:sceneId',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.read');
      const graph = await graphAt(scene, scene.latest_seq);
      res.json({
        id: scene.id,
        name: scene.name,
        latestSeq: scene.latest_seq,
        graph,
        hash: hashGraph(graph),
      });
    }),
  );

  app.get(
    '/api/scenes/:sceneId/graph',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.read');
      const at = queryInteger(req, 'at', {
        min: 0,
        max: scene.latest_seq,
        fallback: scene.latest_seq,
      });
      const graph = await graphAt(scene, at);
      res.json({ seq: at, graph, hash: hashGraph(graph) });
    }),
  );

  app.get(
    '/api/scenes/:sceneId/ops',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.read');
      const after = queryInteger(req, 'after', { min: 0, max: 1_000_000, fallback: 0 });
      const limit = queryInteger(req, 'limit', { min: 1, max: 1000, fallback: 500 });
      res.json({ ops: await listOps(scene.id, after, limit), latestSeq: scene.latest_seq });
    }),
  );

  app.post(
    '/api/scenes/:sceneId/ops',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.edit');
      requireWritableWorkspace(context);
      const ops = parseOps(input);
      res.status(201).json(await applyBatch(context.caller, scene.id, ops));
    }),
  );

  app.post(
    '/api/scenes/:sceneId/undo',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.edit');
      requireWritableWorkspace(context);
      res.status(201).json(await undoBatch(context.caller, scene.id));
    }),
  );

  app.post(
    '/api/scenes/:sceneId/redo',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.edit');
      requireWritableWorkspace(context);
      res.status(201).json(await redoBatch(context.caller, scene.id));
    }),
  );

  app.post(
    '/api/scenes/:sceneId/restore',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.edit');
      requireWritableWorkspace(context);
      const toSeq = input.toSeq;
      if (typeof toSeq !== 'number' || !Number.isInteger(toSeq)) {
        throw fail.validation({ toSeq: 'Must be a whole number' });
      }
      const result = await restoreToSeq(context.caller, scene.id, toSeq);
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'scene.restored',
        target: { type: 'scene', id: scene.id },
      });
      res.status(201).json(result);
    }),
  );

  app.get(
    '/api/search',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'scene.read');
      const raw = req.query.q;
      const q = typeof raw === 'string' ? raw : '';
      if (q.length < 2) throw fail.validation({ q: 'Must be at least 2 characters' });
      const pattern = `%${q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
      const scenes = await query<{ id: string; name: string }>(
        `SELECT id, name FROM scenes WHERE workspace_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 50`,
        [context.workspace.id, pattern],
      );
      const assets = await query<{ id: string; name: string }>(
        `SELECT id, name FROM assets WHERE workspace_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 50`,
        [context.workspace.id, pattern],
      );
      res.json({ scenes, assets });
    }),
  );

  app.get(
    '/api/scenes/:sceneId/events',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.read');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      const send = (event: SceneEvent): void => {
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      };
      send({ event: 'presence', data: { authors: await presenceAuthors(scene.id) } });
      for (const lock of await listLocks(scene.id)) {
        send({ event: 'lock', data: { nodeId: lock.nodeId, holder: lock.holder } });
      }
      const unsubscribe = subscribe(scene.id, send);
      const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
      const close = (): void => {
        clearInterval(keepAlive);
        unsubscribe();
      };
      req.on('close', close);
      res.on('close', close);
    }),
  );

  app.post(
    '/api/scenes/:sceneId/presence',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'presence.write');
      const selectionRaw = input.selection;
      if (selectionRaw !== null && selectionRaw !== undefined && typeof selectionRaw !== 'string') {
        throw fail.validation({ selection: 'Must be a node ID or null' });
      }
      const cursorRaw = input.cursor;
      let cursor: number[] | null = null;
      if (Array.isArray(cursorRaw)) {
        if (
          cursorRaw.length !== 2 ||
          cursorRaw.some((value) => typeof value !== 'number' || value < 0 || value > 1)
        ) {
          throw fail.validation({ cursor: 'Must be two numbers between 0 and 1' });
        }
        cursor = cursorRaw as number[];
      }
      const selection = typeof selectionRaw === 'string' ? selectionRaw : null;
      await query(
        `INSERT INTO presence (scene_id, author_kind, author_id, author_name, selection, cursor, seen_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
         ON CONFLICT (scene_id, author_kind, author_id) DO UPDATE
           SET author_name = EXCLUDED.author_name,
               selection = EXCLUDED.selection,
               cursor = EXCLUDED.cursor,
               seen_at = now()`,
        [
          scene.id,
          context.author.kind,
          context.author.id,
          context.author.name,
          selection,
          JSON.stringify(cursor),
        ],
      );
      await refreshHolderLocks(scene, context.author);
      mirror.presence({
        workspaceId: scene.workspace_id,
        sceneId: scene.id,
        authorKind: context.author.kind,
        authorId: context.author.id,
        authorName: context.author.name,
        selection,
        cursor,
        seenAt: toIso(new Date()),
      });
      publish(scene.id, { event: 'presence', data: { authors: await presenceAuthors(scene.id) } });
      res.status(204).end();
    }),
  );

  app.get(
    '/api/scenes/:sceneId/locks',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.read');
      res.json({ locks: await listLocks(scene.id) });
    }),
  );

  app.post(
    '/api/scenes/:sceneId/locks',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      const nodeId = typeof input.nodeId === 'string' ? input.nodeId : null;
      if (nodeId === null) throw fail.validation({ nodeId: 'Must be a node ID' });
      const graph = await graphAt(scene, scene.latest_seq);
      if (!graph.nodes.some((node) => node.id === nodeId)) throw fail.notFound();
      requirePermission(context, 'scene.edit');
      requireWritableWorkspace(context);
      res.json({ lock: await claimLock(context.caller, scene, nodeId) });
    }),
  );

  app.delete(
    '/api/scenes/:sceneId/locks/:nodeId',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      requirePermission(context, 'scene.edit');
      await releaseLock(context.caller, scene, param(req, 'nodeId'));
      res.status(204).end();
    }),
  );

  app.post(
    '/api/scenes/:sceneId/locks/:nodeId/takeover',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await loadScene(context, param(req, 'sceneId'));
      const graph = await graphAt(scene, scene.latest_seq);
      if (!graph.nodes.some((node) => node.id === param(req, 'nodeId'))) throw fail.notFound();
      requirePermission(context, 'scene.edit');
      requireWritableWorkspace(context);
      res.json(await takeoverLock(context.caller, scene, param(req, 'nodeId')));
    }),
  );
}
