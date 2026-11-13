import type { DbClient } from './db';
import type { Op } from '../bench/ops';
import { objectFieldKeys } from '../bench/ops';
import type { SceneDocument, SceneObject } from '../bench/scene';
import { canonicalJson } from '../bench/canonical';
import { simulate, stateHashInput, type StepState } from '../bench/sim';
import { sha256 } from './crypto';

export type SceneRow = {
  id: string;
  project_id: string;
  name: string;
  status: 'draft' | 'checkpointed' | 'published' | 'unpublished';
  revision: number;
  latest_restore_revision: number | null;
};

export async function loadScene(client: DbClient, sceneId: string): Promise<SceneRow | null> {
  const row = await client.query('SELECT * FROM scenes WHERE id = $1', [sceneId]);
  return row.rows[0] ?? null;
}

export async function loadDocument(client: DbClient, sceneId: string, revision: number): Promise<SceneDocument> {
  const row = await client.query(
    'SELECT document FROM scene_revisions WHERE scene_id = $1 AND revision = $2',
    [sceneId, revision],
  );
  const first = row.rows[0];
  if (!first) throw new Error(`missing revision ${revision} for scene ${sceneId}`);
  return JSON.parse(first.document) as SceneDocument;
}

export function documentBytes(doc: SceneDocument): string {
  return canonicalJson(doc);
}

export function computeStateHash(doc: SceneDocument, steps: number, params: Record<string, number> = {}): string {
  const state: StepState = simulate(doc, steps, params);
  return sha256(stateHashInput(state));
}

export type RevisionFootprint = { revision: number; keys: Set<string>; removedObjectIds: Set<string> };

export function footprintsForRevision(ops: Op[]): { keys: Set<string>; removedObjectIds: Set<string> } {
  const keys = new Set<string>();
  const removed = new Set<string>();
  for (const op of ops) {
    switch (op.op) {
      case 'set': {
        const key = op.field.startsWith('params.')
          ? `${op.objectId}.params.${op.field.slice('params.'.length)}`
          : `${op.objectId}.${op.field}`;
        keys.add(key);
        break;
      }
      case 'scene':
        keys.add(`scene.${op.field}`);
        break;
      case 'add':
        for (const k of objectFieldKeys(op.object)) keys.add(k);
        break;
      case 'remove': {
        removed.add(op.objectId);
        for (const k of objectFieldKeys(dummyObject(op.objectId))) keys.add(k);
        break;
      }
    }
  }
  return { keys, removedObjectIds: removed };
}

function dummyObject(id: string): SceneObject {
  return { id, kind: 'crate', name: '', params: { mass_kg: 1 }, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], assetId: null };
}

export async function revisionFootprints(
  client: DbClient,
  sceneId: string,
  afterRevision: number,
  upToRevision: number,
): Promise<RevisionFootprint[]> {
  const rows = await client.query(
    'SELECT revision, ops FROM scene_revisions WHERE scene_id = $1 AND revision > $2 AND revision <= $3 ORDER BY revision',
    [sceneId, afterRevision, upToRevision],
  );
  return rows.rows.map((row: { revision: number; ops: Op[] }) => {
    const fp = footprintsForRevision(row.ops);
    return { revision: row.revision, ...fp };
  });
}

export function applyOps(doc: SceneDocument, ops: Op[]): SceneDocument {
  const next: SceneDocument = { ...doc, objects: doc.objects.map((o) => ({ ...o, params: { ...o.params } })) };
  for (const op of ops) {
    if (op.op === 'scene') {
      if (op.field === 'name') next.name = String(op.value);
      else next.gravity = Number(op.value);
    } else if (op.op === 'add') {
      if (!next.objects.some((o) => o.id === op.object.id)) next.objects.push({ ...op.object });
    } else if (op.op === 'remove') {
      next.objects = next.objects.filter((o) => o.id !== op.objectId);
    } else if (op.op === 'set') {
      const object = next.objects.find((o) => o.id === op.objectId);
      if (!object) continue;
      if (op.field === 'name') object.name = String(op.value);
      else if (op.field === 'position') object.position = op.value as [number, number, number];
      else if (op.field === 'rotation') object.rotation = op.value as [number, number, number, number];
      else if (op.field === 'scale') object.scale = op.value as [number, number, number];
      else if (op.field.startsWith('params.')) {
        object.params = { ...object.params, [op.field.slice('params.'.length)]: Number(op.value) };
      }
    }
  }
  next.objects.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return next;
}

export function fieldKeysForPatch(ops: Op[]): Set<string> {
  const keys = new Set<string>();
  for (const op of ops) {
    if (op.op === 'set') {
      keys.add(op.field.startsWith('params.')
        ? `${op.objectId}.params.${op.field.slice('params.'.length)}`
        : `${op.objectId}.${op.field}`);
    } else if (op.op === 'scene') {
      keys.add(`scene.${op.field}`);
    } else if (op.op === 'add') {
      for (const k of objectFieldKeys(op.object)) keys.add(k);
    } else if (op.op === 'remove') {
      for (const k of objectFieldKeys(dummyObject(op.objectId))) keys.add(k);
    }
  }
  return keys;
}

export function removedIdsForPatch(ops: Op[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) if (op.op === 'remove') ids.add(op.objectId);
  return ids;
}
