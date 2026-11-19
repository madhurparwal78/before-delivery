import { db, type Db } from './db.js';
import { S3Client, s3Config } from './s3.js';
import { fixtureFileBytes } from '../domain/fixtures.js';
import { sha256Hex } from './seed.js';

/**
 * Storage confirmation rule (one place): a file is Stored only when object
 * storage reports back the declared size and SHA-256 for the written object.
 */

export type StorageState = {
  reachable: boolean;
  client: S3Client | null;
  bucket: string;
};

let storage: StorageState | null = null;
let lastProbe = { ok: false, at: 0 };

export function storageClient(): S3Client | null {
  if (!storage) {
    try {
      storage = { reachable: false, client: new S3Client(s3Config()), bucket: s3Config().bucket };
    } catch {
      storage = { reachable: false, client: null, bucket: '' };
    }
  }
  return storage.client;
}

/** Resolve a corridor's tenant from the database. */
const tenantCache = new Map<string, string>();
export async function tenantOf(pool: Db, corridorId: string): Promise<string> {
  const cached = tenantCache.get(corridorId);
  if (cached) return cached;
  const res = await pool.query(
    'SELECT u.tenant_id FROM corridors c JOIN utilities u ON u.id = c.utility_id WHERE c.id = $1',
    [corridorId]
  );
  const t = res.rows.length > 0 ? (res.rows[0].tenant_id as string) : 'kestrel';
  tenantCache.set(corridorId, t);
  return t;
}

export function assetKey(tenantId: string, corridorId: string, assetId: string, path: string): string {
  return `tenants/${tenantId}/corridors/${corridorId}/assets/${assetId}/${path}`;
}

export function evidenceKey(tenantId: string, corridorId: string, setId: string): string {
  return `tenants/${tenantId}/corridors/${corridorId}/findings-sets/${setId}/evidence.json`;
}

export async function probeStorage(): Promise<boolean> {
  const client = storageClient();
  if (!client) {
    lastProbe = { ok: false, at: Date.now() };
    return false;
  }
  const ok = await client.probe();
  lastProbe = { ok, at: Date.now() };
  if (storage) storage.reachable = ok;
  return ok;
}

export function storageLastProbe(): { ok: boolean; at: number } {
  return lastProbe;
}

/** Write an object and verify storage reports the declared size and digest. */
export async function writeVerified(
  key: string,
  bytes: Buffer,
  declaredSha256: string,
  declaredSize: number
): Promise<'ok' | 'mismatch' | 'unreachable'> {
  const client = storageClient();
  if (!client) return 'unreachable';
  const put = await client.putObject(key, bytes, declaredSha256);
  if (put === null) return 'unreachable';
  const head = await client.headObject(key);
  if (head === null) return 'unreachable';
  if (head.size !== declaredSize || head.etagSha256 !== declaredSha256) return 'mismatch';
  return 'ok';
}

/** Write a seeded fixture file; returns null when storage is unreachable. */
export async function writeFixtureFile(
  tenantId: string,
  corridorId: string,
  assetId: string,
  path: string
): Promise<{ size: number; sha256: string } | null> {
  const bytes = Buffer.from(fixtureFileBytes(assetId, corridorId, path));
  const sha = sha256Hex(bytes);
  const res = await writeVerified(assetKey(tenantId, corridorId, assetId, path), bytes, sha, bytes.length);
  if (res !== 'ok') return null;
  return { size: bytes.length, sha256: sha };
}

/** Read a stored object, whole or by range. */
export async function readObject(
  key: string,
  range?: { from: number; to: number }
): Promise<{ bytes: Buffer; totalSize: number } | 'unreachable' | 'missing'> {
  const client = storageClient();
  if (!client) return 'unreachable';
  const res = await client.getObject(key, range);
  if (res === null) return 'missing';
  return { bytes: res.body, totalSize: res.size };
}

export async function deleteObject(key: string): Promise<boolean> {
  const client = storageClient();
  if (!client) return false;
  return client.deleteObject(key);
}

export async function listPrefix(prefix: string): Promise<string[]> {
  const client = storageClient();
  if (!client) return [];
  return client.listObjects(prefix);
}

