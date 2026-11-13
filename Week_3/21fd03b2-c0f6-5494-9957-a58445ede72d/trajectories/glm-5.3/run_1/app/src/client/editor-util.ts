import { api } from './api';
import { h } from './ui';
import { navigate, encodeReturn } from './router';
import { loadMe, type Me } from './auth';
import { setWorkspaceContext } from './chrome';
import { COPY } from '../bench/copy';
import type { SceneDocument, SceneObject, ObjectKind } from '../bench/scene';
import type { Op } from '../bench/ops';
import type { Body, StepState } from '../bench/sim';
import { quatFromZAngle } from '../bench/sim';

export type EditorRoute = { name: 'editor'; wid: string; sid: string };

export type SceneData = {
  scene: {
    id: string; projectId: string; name: string; status: string; revision: number; stateHash: string;
    lab: { token: string; url: string; bundleHash: string; publishedAt: string; checkpointId: string; exposed: string[] } | null;
  };
  document: SceneDocument;
  workspaceId: string;
};

export type PresenceData = {
  people: Array<{ userId: string; displayName: string; cursor: [number, number, number] | null; selected: string | null }>;
  locks: Array<{ objectId: string; holder: { userId: string; displayName: string }; fence: number; expiresAt: string }>;
};

export type AssetData = {
  id: string; name: string; kind: string; bytes: number; sha256: string;
  unit: string | null; scaleToMetres: number | null; extentMetres: number | null; createdAt: string;
};

export type CheckpointData = { id: string; label: string; revision: number; stateHash: string; documentSha256: string; createdAt: string };

export const vis = (): string => 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';

export const KIND_GLYPHS: Record<ObjectKind, string> = {
  ramp: '◺', pendulum: '⏱', launcher: '⤴', crate: '▢', model: '◈',
};

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function localApplyOps(doc: SceneDocument, ops: Op[]): SceneDocument {
  const next: SceneDocument = { ...doc, objects: doc.objects.map((o) => ({ ...o, params: { ...o.params } })) };
  for (const op of ops) {
    if (op.op === 'scene') {
      if (op.field === 'name') next.name = String(op.value);
      else next.gravity = Number(op.value);
    } else if (op.op === 'add') {
      if (!next.objects.some((o) => o.id === op.object.id)) next.objects.push(structuredClone(op.object));
    } else if (op.op === 'remove') {
      next.objects = next.objects.filter((o) => o.id !== op.objectId);
    } else if (op.op === 'set') {
      const object = next.objects.find((o) => o.id === op.objectId);
      if (!object) continue;
      if (op.field === 'name') object.name = String(op.value);
      else if (op.field === 'position') object.position = [...(op.value as [number, number, number])];
      else if (op.field === 'rotation') object.rotation = [...(op.value as [number, number, number, number])];
      else if (op.field === 'scale') object.scale = [...(op.value as [number, number, number])];
      else if (op.field.startsWith('params.')) {
        object.params = { ...object.params, [op.field.slice('params.'.length)]: Number(op.value) };
      }
    }
  }
  next.objects.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return next;
}

export function stepStateFor(doc: SceneDocument, bodies: Body[], step: number): StepState {
  return {
    objects: bodies.map((b, i) => ({
      id: doc.objects[i]!.id,
      position: [round6(b.position[0]), round6(b.position[1]), round6(b.position[2])] as [number, number, number],
      rotation: b.kind === 'pendulum' ? quatFromZAngle(b.angle) : b.rotation,
      velocity: [round6(b.velocity[0]), round6(b.velocity[1]), round6(b.velocity[2])] as [number, number, number],
    })),
    step,
  };
}

export async function goSignIn(): Promise<void> {
  navigate(`/sign-in?return=${encodeReturn(location.pathname, location.search)}`);
}

export async function ensureMe(): Promise<Me | null> {
  const me = await loadMe();
  if (!me) {
    await goSignIn();
    return null;
  }
  return me;
}


