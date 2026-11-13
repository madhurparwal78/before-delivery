import {
  applyChanges,
  CHANGE_TYPES,
  changeLayerIds,
  findLayer,
  heldRefusal,
  lockedRefusal,
  lockRefusal,
  patchOf,
  type Patch,
  type Refusal,
} from '../../shared/document';
import { MESSAGES } from '../../shared/messages';
import type { OpsResponse, Person as WirePerson, ServerMessage, UndoResponse } from '../../shared/protocol';
import type { Change, LockInfo, ProjectSummary } from '../../shared/types';
import { lockProject, openProject, refuseTrashed, requireEditor } from '../access';
import { now } from '../clock';
import { config } from '../config';
import { transaction } from '../db';
import { deleteLayers, loadAssetStatuses, loadDocument, projectSeq, writeLayer, writePatch, writePresets, writeSceneFields, writeVariables } from '../documents';
import { captureImage, depths, markStep, nextStep, patchOfImage, positionsOf, recordStep } from '../history';
import { fail, invalid, json, newId, noContent, notFound, router, type Person, type Reply } from '../http';
import { broadcast } from '../hub';
import { fingerprint } from '../idempotency';
import { holders, releaseLock, takeLocks } from '../locks';

const STORED_AS_LOCKING: readonly Change['type'][] = ['updateLayer', 'clearOverride', 'setKeyframe', 'moveKeyframe', 'deleteKeyframe', 'bind', 'unbind'];
const MAX_CHANGES = 500;

interface OpBody {
  opId: string;
  sceneId: string;
  changes: Change[];
}

function checkOpId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) return invalid('opId', MESSAGES.invalidValue);
  return value;
}

function parseOpBody(body: Record<string, unknown>): OpBody {
  const opId = checkOpId(body['opId']);
  if (typeof body['sceneId'] !== 'string') invalid('sceneId', MESSAGES.invalidValue);
  const changes = body['changes'];
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) return invalid('changes', MESSAGES.invalidValue);
  changes.forEach((change, index) => {
    const type = (change as { type?: unknown } | null)?.type;
    if (typeof change !== 'object' || change === null || !(CHANGE_TYPES as readonly unknown[]).includes(type)) invalid(`changes[${index}].type`, MESSAGES.invalidValue);
  });
  return { opId, sceneId: body['sceneId'] as string, changes: changes as Change[] };
}

interface Outcome {
  /** Ids created by the change (`ops` only). */
  ids?: Record<string, string>;
  patch: Patch;
  locks: LockInfo[];
  changed: boolean;
}

interface Committed {
  reply: OpsResponse | UndoResponse;
  messages: ServerMessage[];
}

/**
 * One write transaction for ops, undo and redo: the project row is locked, a replayed opId returns its stored
 * response (before any state check), a trashed project answers 409, then `action` does the work.
 */
async function writeOp(
  person: Person,
  project: ProjectSummary,
  opId: string,
  hash: string,
  action: (client: Parameters<Parameters<typeof transaction>[0]>[0]) => Promise<Outcome>,
): Promise<Reply> {
  const committed = await transaction<Committed | { stored: unknown }>(async (client) => {
    const status = await lockProject(client, project.id, 'update');
    const stored = (
      await client.query<{ body_hash: string; response: unknown }>('SELECT body_hash, response FROM ops WHERE project_id = $1 AND person_id = $2 AND op_id = $3', [
        project.id,
        person.id,
        opId,
      ])
    ).rows[0];
    if (stored) {
      if (stored.body_hash !== hash) return fail(409, 'idempotency_conflict', MESSAGES.idempotencyConflict);
      return { stored: stored.response };
    }
    refuseTrashed(status);
    const outcome = await action(client);
    let seq = await projectSeq(client, project.id);
    if (outcome.changed) {
      seq = Number((await client.query<{ seq: string }>('UPDATE projects SET seq = seq + 1 WHERE id = $1 RETURNING seq', [project.id])).rows[0]?.seq);
    }
    const depth = await depths(client, project.id, person.id);
    const reply: OpsResponse | UndoResponse = { opId, seq, ...depth, ...(outcome.ids ? { ids: outcome.ids } : {}), patch: outcome.patch };
    await client.query('INSERT INTO ops (project_id, person_id, op_id, body_hash, response, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      project.id,
      person.id,
      opId,
      hash,
      JSON.stringify(reply),
      await now(client),
    ]);
    const by: WirePerson = { id: person.id, name: person.name };
    const messages: ServerMessage[] = [];
    if (outcome.changed) messages.push({ type: 'patch', seq, opId, by, patch: outcome.patch });
    for (const lock of outcome.locks) messages.push({ type: 'lock', lock });
    return { reply, messages };
  });
  if ('stored' in committed) return json(200, committed.stored);
  for (const message of committed.messages) broadcast(project.id, message);
  return json(200, committed.reply);
}

const failWith = (refusal: Refusal): never => fail(refusal.status, refusal.code, refusal.message, refusal.status === 422 ? refusal.errors : undefined);

router.post('/api/projects/:id/ops', async (ctx) => {
  const { person, project } = await openProject(ctx, ctx.param('id'));
  requireEditor(project);
  const { opId, sceneId, changes } = parseOpBody(await ctx.jsonObject());
  return writeOp(person, project, opId, fingerprint('POST', 'ops', { sceneId, changes }), async (client) => {
    const { document, idx } = await loadDocument(client, project.id);
    const statuses = await loadAssetStatuses(client, project.id);
    const held = await holders(project.id, person.id, client);
    const refused = lockRefusal(document, changes, (layerId) => held.get(layerId) ?? null);
    if (refused) failWith(refused);
    const applied = applyChanges(document, sceneId, changes, {
      seeds: config.seeds,
      newId: () => newId('l'),
      assetStatus: (assetId) => statuses.get(assetId),
    });
    if (!applied.ok) return failWith(applied.refusal);
    const { touched } = applied;
    const nothing = touched.layers.size + touched.removed.size + touched.scenes.size === 0 && !touched.variables && !touched.presets;
    const patch = patchOf(applied.document, touched);
    if (nothing) return { ids: applied.ids, patch, locks: [], changed: false };
    const before = captureImage(document, idx, touched);
    await deleteLayers(client, project.id, [...touched.removed.keys()]);
    const positions = new Map(idx);
    for (const entry of patch.layers) positions.set(entry.layer.id, await writeLayer(client, project.id, entry.sceneId, entry.layer));
    for (const fields of patch.scenes) await writeSceneFields(client, project.id, fields);
    if (patch.variables) await writeVariables(client, project.id, patch.variables);
    if (patch.presets) await writePresets(client, project.id, patch.presets);
    const after = captureImage(applied.document, positions, touched);
    await recordStep(client, { projectId: project.id, personId: person.id, opId, before, after, at: await now(client) });
    const lockIds = [
      ...new Set(
        changes
          .filter((change) => STORED_AS_LOCKING.includes(change.type))
          .flatMap(changeLayerIds)
          .filter((layerId) => findLayer(applied.document, layerId)),
      ),
    ];
    const locks = await takeLocks(project.id, person.id, person.name, lockIds, client);
    return { ids: applied.ids, patch, locks, changed: true };
  });
});

async function step(direction: 'undo' | 'redo', ctxParams: { person: Person; project: ProjectSummary }, opId: string): Promise<Reply> {
  const { person, project } = ctxParams;
  return writeOp(person, project, opId, fingerprint('POST', direction, {}), async (client) => {
    const found = await nextStep(client, project.id, person.id, direction);
    if (!found) {
      return direction === 'undo'
        ? fail(409, 'nothing_to_undo', MESSAGES.nothingToUndo)
        : fail(409, 'nothing_to_redo', MESSAGES.nothingToRedo);
    }
    const image = direction === 'undo' ? found.before : found.after;
    const { document } = await loadDocument(client, project.id);
    const held = await holders(project.id, person.id, client);
    for (const entry of image.layers) {
      const current = findLayer(document, entry.layerId)?.layer;
      if (!current) continue;
      const holder = held.get(entry.layerId);
      if (holder) return failWith(heldRefusal(holder));
      if (current.locked && entry.layer?.locked === current.locked) return failWith(lockedRefusal(current.name));
    }
    await writePatch(client, project.id, patchOfImage(image), positionsOf(image));
    await markStep(client, found.id, direction === 'undo');
    const patch = patchOfImage(image);
    return { patch, locks: [], changed: true };
  });
}

for (const direction of ['undo', 'redo'] as const) {
  router.post(`/api/projects/:id/${direction}`, async (ctx) => {
    const opened = await openProject(ctx, ctx.param('id'));
    requireEditor(opened.project);
    const body = await ctx.jsonObject();
    return step(direction, opened, checkOpId(body['opId']));
  });
}

router.put('/api/projects/:id/layers/:layerId/lock', async (ctx) => {
  const { person, project } = await openProject(ctx, ctx.param('id'));
  requireEditor(project);
  const layerId = ctx.param('layerId');
  const lock = await transaction(async (client) => {
    refuseTrashed(await lockProject(client, project.id, 'update'));
    const exists = (await client.query('SELECT 1 FROM layers WHERE project_id = $1 AND id = $2', [project.id, layerId])).rows.length > 0;
    if (!exists) return notFound();
    const holder = (await holders(project.id, person.id, client)).get(layerId);
    if (holder) return failWith(heldRefusal(holder));
    return (await takeLocks(project.id, person.id, person.name, [layerId], client))[0] as LockInfo;
  });
  broadcast(project.id, { type: 'lock', lock });
  return json(200, { lock });
});

router.delete('/api/projects/:id/layers/:layerId/lock', async (ctx) => {
  const { person, project } = await openProject(ctx, ctx.param('id'));
  requireEditor(project);
  const layerId = ctx.param('layerId');
  if (await releaseLock(project.id, person.id, layerId)) broadcast(project.id, { type: 'unlock', layerId });
  return noContent();
});
