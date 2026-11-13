import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { errors } from './http';
import { loadAssets } from './repo';
import type { AssetRow } from './repo';
import type { LoadedAsset } from '../shared/evaluator';
import type { GltfModel } from '../shared/gltf';
import type { Outline } from '../shared/extrusion';
import type { AssetClip, JsonValue } from '../shared/types';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derived] = stored.split(':');
  if (!salt || !derived) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(derived, 'hex');
  if (candidate.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(candidate, expected);
}

export function assetRecord(row: AssetRow): {
  id: string;
  kind: 'image' | 'svg' | 'model';
  fileName: string;
  bytes: number;
  sha256: string;
  status: 'pending' | 'confirmed' | 'failed';
  width: number | null;
  height: number | null;
  vertices: number | null;
  clips: AssetClip[];
} {
  return {
    id: row.id,
    kind: row.kind as 'image' | 'svg' | 'model',
    fileName: row.file_name,
    bytes: row.bytes,
    sha256: row.sha256,
    status: row.status as 'pending' | 'confirmed' | 'failed',
    width: row.width,
    height: row.height,
    vertices: row.vertices,
    clips: (row.clips as unknown as AssetClip[]) ?? [],
  };
}

export async function loadedAssets(projectId: string): Promise<Record<string, LoadedAsset>> {
  const rows = await loadAssets(projectId);
  const out: Record<string, LoadedAsset> = {};
  for (const row of rows) {
    const parsed = row.parsed as JsonValue;
    out[row.id] = {
      record: assetRecord(row),
      model: row.kind === 'model' ? ((parsed as unknown as GltfModel) ?? null) : null,
      outline: row.kind === 'svg' ? ((parsed as unknown as Outline) ?? null) : null,
    };
  }
  return out;
}

export function numberParam(
  url: URL,
  name: string,
  fallback: number | null,
  min: number,
  max: number,
): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw errors.validation({ [name]: `Must be between ${min} and ${max}.` });
  }
  return value;
}

export function sessionCookie(id: string): string {
  return `hs_session=${id}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedSessionCookie(): string {
  return 'hs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
