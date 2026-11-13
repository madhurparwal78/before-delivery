import { createHash, randomUUID } from 'node:crypto';
import { errors, readJsonBody, readMultipartBody, sendBytes, sendJson } from './http';
import { MSG, copy } from '../shared/messages';
import { config } from './config';
import { query, queryOne, transaction } from './db';
import { serverNow } from './clock';
import { loadAssets, loadDocument, persistDocument } from './repo';
import { openProject, requireActive } from './access';
import type { Router } from './router';
import { applyChanges, touchedLayerIdsOf } from './ops';
import type { AssetState, Change } from './ops';
import { depths, markUndone, nextRedo, nextSeq, nextUndo, recordOp } from './history';
import { lockHolder, locksFor, releaseLock, takeLock } from './locks';
import { withIdempotency } from './idempotency';
import { broadcastChange } from './ws';
import { evaluate } from '../shared/evaluator';
import type { Breakpoint, JsonObject, JsonValue } from '../shared/types';
import { BREAKPOINTS } from '../shared/types';
import { assetRecord, loadedAssets, numberParam } from './api-shared';
import { checkImage, checkModel, checkSvg, contentTypeFor } from './assets';
import {
  confirmObject,
  getObject,
  putObject,
  storageKeys,
  StorageUnavailable,
} from './storage';

function parseChanges(raw: JsonValue): Change[] {
  if (!Array.isArray(raw)) throw errors.validation({ changes: 'Send a list of changes.' });
  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw errors.validation({ changes: 'Send a list of changes.' });
    }
    const record = entry as JsonObject;
    if (typeof record.type !== 'string') {
      throw errors.validation({ changes: 'Choose one of the listed change types.' });
    }
    return record as unknown as Change;
  });
}

async function assetStates(projectId: string): Promise<AssetState[]> {
  const rows = await loadAssets(projectId);
  return rows.map((row) => ({ id: row.id, status: row.status, kind: row.kind }));
}

async function checkLayerLocks(
  projectId: string,
  personId: string,
  layerIds: string[],
  lockedNames: Map<string, string>,
): Promise<void> {
  for (const layerId of layerIds) {
    const holder = await lockHolder(projectId, layerId);
    if (holder && holder.id !== personId) {
      throw errors.conflict('layer_held', copy.layerHeld(holder.name));
    }
  }
  for (const layerId of layerIds) {
    const name = lockedNames.get(layerId);
    if (name !== undefined) {
      throw errors.conflict('layer_locked', copy.layerLocked(name));
    }
  }
  for (const layerId of layerIds) {
    await takeLock(projectId, layerId, personId);
  }
}

export function registerEditRoutes(router: Router): void {
  router.add('POST', '/api/projects/:id/ops', async ({ request, response, person, params }) => {
    const access = await openProject(person, params.id, 'edit');
    const body = await readJsonBody(request);
    const opId = body.opId;
    if (typeof opId !== 'string' || opId.length < 1 || opId.length > 100) {
      throw errors.validation({ opId: 'Must be between 1 and 100 characters.' });
    }
    const result = await withIdempotency(
      `ops:${params.id}`,
      opId,
      person!.id,
      body,
      async () => {
        requireActive(access.row);
        const sceneId = typeof body.sceneId === 'string' ? body.sceneId : '';
        const changes = parseChanges(body.changes ?? null);
        const document = await loadDocument(params.id);
        const scene = document.scenes.find((candidate) => candidate.id === sceneId);
        if (!scene) throw errors.validation({ sceneId: 'Choose a scene that exists.' });
        const lockedNames = new Map<string, string>();
        for (const layer of scene.layers) {
          if (layer.locked) lockedNames.set(layer.id, layer.name);
        }
        const touched = touchedLayerIdsOf(changes).filter((layerId) =>
          scene.layers.some((layer) => layer.id === layerId),
        );
        await checkLayerLocks(params.id, person!.id, touched, lockedNames);
        const applied = applyChanges(document, changes, {
          sceneId,
          assets: await assetStates(params.id),
          newId: () => randomUUID(),
        });
        const seq = await nextSeq(params.id);
        const now = await serverNow();
        await transaction(async (client) => {
          await persistDocument(client, params.id, document);
        });
        await recordOp(params.id, person!.id, opId, sceneId, seq, changes, applied.inverse, now);
        const counts = await depths(params.id, person!.id);
        broadcastChange(params.id, { seq, by: person!.id, sceneId });
        return {
          status: 200,
          body: {
            opId,
            seq,
            undoDepth: counts.undoDepth,
            redoDepth: counts.redoDepth,
            ids: applied.ids,
            variableDeleteCounts: applied.variableDeleteCounts,
          } as unknown as JsonValue,
        };
      },
    );
    sendJson(response, result.status, result.body);
  });

  const walkHistory = async (
    direction: 'undo' | 'redo',
    projectId: string,
    personId: string,
    opId: string,
    rowStatus: () => void,
  ): Promise<JsonValue> => {
    rowStatus();
    const entry = direction === 'undo'
      ? await nextUndo(projectId, personId)
      : await nextRedo(projectId, personId);
    if (!entry) {
      throw errors.conflict(
        direction === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo',
        direction === 'undo' ? MSG.nothingToUndo : MSG.nothingToRedo,
      );
    }
    const changes = (direction === 'undo' ? entry.inverse : entry.forward) as unknown as Change[];
    const document = await loadDocument(projectId);
    const sceneId = entry.scene_id;
    const scene = document.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw errors.validation({ sceneId: 'Choose a scene that exists.' });
    const lockedNames = new Map<string, string>();
    for (const layer of scene.layers) {
      if (layer.locked) lockedNames.set(layer.id, layer.name);
    }
    const touched = touchedLayerIdsOf(changes).filter((layerId) =>
      scene.layers.some((layer) => layer.id === layerId),
    );
    await checkLayerLocks(projectId, personId, touched, lockedNames);
    const applied = applyChanges(document, changes, {
      sceneId,
      assets: await assetStates(projectId),
      newId: () => randomUUID(),
    });
    await transaction(async (client) => {
      await persistDocument(client, projectId, document);
    });
    // Redoing replays the inverse of what was just applied.
    if (direction === 'undo') {
      await markUndone(entry.id, true, applied.inverse, changes);
    } else {
      await markUndone(entry.id, false, changes, applied.inverse);
    }
    const seq = await nextSeq(projectId);
    const counts = await depths(projectId, personId);
    broadcastChange(projectId, { seq, by: personId, sceneId });
    return {
      opId,
      seq,
      undoDepth: counts.undoDepth,
      redoDepth: counts.redoDepth,
    } as unknown as JsonValue;
  };

  const historyRoute = (direction: 'undo' | 'redo'): void => {
    router.add(
      'POST',
      `/api/projects/:id/${direction}`,
      async ({ request, response, person, params }) => {
        const access = await openProject(person, params.id, 'edit');
        const body = await readJsonBody(request);
        const opId = body.opId;
        if (typeof opId !== 'string' || opId.length < 1 || opId.length > 100) {
          throw errors.validation({ opId: 'Must be between 1 and 100 characters.' });
        }
        const result = await withIdempotency(
          `${direction}:${params.id}`,
          opId,
          person!.id,
          body,
          async () => ({
            status: 200,
            body: await walkHistory(direction, params.id, person!.id, opId, () =>
              requireActive(access.row),
            ),
          }),
        );
        sendJson(response, result.status, result.body);
      },
    );
  };
  historyRoute('undo');
  historyRoute('redo');

  router.add(
    'PUT',
    '/api/projects/:id/layers/:layerId/lock',
    async ({ response, person, params }) => {
      const access = await openProject(person, params.id, 'edit');
      requireActive(access.row);
      const document = await loadDocument(params.id);
      const layer = document.scenes
        .flatMap((scene) => scene.layers)
        .find((candidate) => candidate.id === params.layerId);
      if (!layer) throw errors.notFound();
      const lock = await takeLock(params.id, params.layerId, person!.id);
      sendJson(response, 200, {
        lock: {
          layerId: params.layerId,
          heldBy: { id: person!.id, name: person!.name },
          expiresAt: lock.expiresAt,
        },
      });
    },
  );

  router.add(
    'DELETE',
    '/api/projects/:id/layers/:layerId/lock',
    async ({ response, person, params }) => {
      await openProject(person, params.id, 'edit');
      await releaseLock(params.id, params.layerId, person!.id);
      response.writeHead(204);
      response.end();
    },
  );

  router.add('GET', '/api/projects/:id/locks', async ({ response, person, params }) => {
    await openProject(person, params.id, 'view');
    sendJson(response, 200, { locks: await locksFor(params.id) });
  });

  router.add('GET', '/api/projects/:id/inspect', async ({ response, person, params, url }) => {
    await openProject(person, params.id, 'view');
    const sceneId = url.searchParams.get('scene');
    if (!sceneId) throw errors.validation({ scene: 'Choose a scene that exists.' });
    const versionParam = url.searchParams.get('version');
    let document = await loadDocument(params.id);
    if (versionParam !== null) {
      const number = Number(versionParam);
      const row = await queryOne<{ bundle: string }>(
        `SELECT bundle FROM versions WHERE project_id = $1 AND number = $2`,
        [params.id, number],
      );
      if (!row) throw errors.validation({ version: 'Choose a version that exists.' });
      document = JSON.parse(row.bundle);
    }
    const breakpointRaw = url.searchParams.get('breakpoint') ?? 'desktop';
    if (!(BREAKPOINTS as readonly string[]).includes(breakpointRaw)) {
      throw errors.validation({ breakpoint: 'Choose desktop, tablet or mobile.' });
    }
    const frame = numberParam(url, 'frame', 0, 0, 216000) ?? 0;
    const scroll = numberParam(url, 'scroll', 0, 0, 100) ?? 0;
    const reducedMotionRaw = url.searchParams.get('reducedMotion');
    if (reducedMotionRaw !== null && reducedMotionRaw !== '0' && reducedMotionRaw !== '1') {
      throw errors.validation({ reducedMotion: 'Choose 0 or 1.' });
    }
    const sampleX = numberParam(url, 'sampleX', null, -100000, 100000);
    const sampleY = numberParam(url, 'sampleY', null, -100000, 100000);
    const particle = numberParam(url, 'particle', null, 1, config.particleMax);
    const output = evaluate({
      document,
      sceneId,
      layerId: url.searchParams.get('layer'),
      frame: Math.round(frame),
      breakpoint: breakpointRaw as Breakpoint,
      scroll,
      reducedMotion: reducedMotionRaw === '1',
      vertex: url.searchParams.get('vertex'),
      particle: particle === null ? null : Math.round(particle),
      point: url.searchParams.get('point'),
      node: url.searchParams.get('node'),
      sampleX: sampleX === null ? null : Math.round(sampleX),
      sampleY: sampleY === null ? null : Math.round(sampleY),
      assets: await loadedAssets(params.id),
      particleMax: config.particleMax,
    });
    sendJson(response, 200, {
      frame: output.frame,
      time: output.time,
      breakpoint: output.breakpoint,
      values: output.values,
      sources: output.sources,
      readouts: output.readouts,
      drawOrder: output.drawOrder,
    });
  });

  router.add('POST', '/api/projects/:id/assets', async ({ request, response, person, params }) => {
    const access = await openProject(person, params.id, 'edit');
    const body = await readMultipartBody(request);
    requireActive(access.row);
    const kind = body.fields.kind ?? '';
    if (kind !== 'image' && kind !== 'svg' && kind !== 'model') {
      throw errors.validation({ kind: 'Choose image, svg or model.' });
    }
    const file = body.files.file;
    if (!file) throw errors.validation({ file: 'Choose a file.' });
    let width: number | null = null;
    let height: number | null = null;
    let vertices: number | null = null;
    let clips: { name: string; durationS: number }[] = [];
    let parsed: JsonValue = null;
    if (kind === 'image') {
      const check = checkImage(file.data);
      if (check.refusal) throw errors.validation({ file: check.refusal });
      width = check.info!.width;
      height = check.info!.height;
    } else if (kind === 'svg') {
      const check = checkSvg(file.data);
      if (check.refusal) throw errors.validation({ file: check.refusal });
      parsed = check.outline as unknown as JsonValue;
    } else {
      const check = checkModel(file.data, file.fileName);
      if (check.refusal) throw errors.validation({ file: check.refusal });
      vertices = check.model!.vertexCount;
      clips = check.model!.clips.map((clip) => ({ name: clip.name, durationS: clip.durationS }));
      parsed = check.model as unknown as JsonValue;
    }
    const assetId = randomUUID();
    const sha256 = createHash('sha256').update(file.data).digest('hex');
    const contentType = contentTypeFor(kind, file.fileName, file.contentType);
    const now = await serverNow();
    await query(
      `INSERT INTO assets (id, project_id, kind, file_name, content_type, bytes, sha256, status,
         width, height, vertices, clips, parsed, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10,$11,$12,$13)`,
      [
        assetId,
        params.id,
        kind,
        file.fileName,
        contentType,
        file.data.byteLength,
        sha256,
        width,
        height,
        vertices,
        JSON.stringify(clips),
        parsed === null ? null : JSON.stringify(parsed),
        now.toISOString(),
      ],
    );
    try {
      const key = storageKeys.asset(params.id, assetId);
      await putObject(key, file.data, contentType);
      const confirmed = await confirmObject(key, file.data.byteLength);
      if (!confirmed) throw new StorageUnavailable('asset not confirmed');
    } catch (error) {
      await query(`UPDATE assets SET status = 'failed' WHERE id = $1`, [assetId]);
      if (error instanceof StorageUnavailable) {
        throw errors.storageUnavailable(MSG.storageUploads);
      }
      throw error;
    }
    await query(`UPDATE assets SET status = 'confirmed' WHERE id = $1`, [assetId]);
    const rows = await loadAssets(params.id);
    const row = rows.find((candidate) => candidate.id === assetId)!;
    sendJson(response, 201, { asset: assetRecord(row) });
  });

  router.add('GET', '/api/assets/:assetId/original', async ({ response, person, params }) => {
    if (!person) throw errors.unauthenticated();
    const asset = await queryOne<{ project_id: string; content_type: string }>(
      `SELECT project_id, content_type FROM assets WHERE id = $1`,
      [params.assetId],
    );
    if (!asset) throw errors.notFound();
    await openProject(person, asset.project_id, 'view');
    const object = await getObject(storageKeys.asset(asset.project_id, params.assetId));
    if (!object) throw errors.notFound();
    sendBytes(response, 200, object.body, asset.content_type);
  });

}
