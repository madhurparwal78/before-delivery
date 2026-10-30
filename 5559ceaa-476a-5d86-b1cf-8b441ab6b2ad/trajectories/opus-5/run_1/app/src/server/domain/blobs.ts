import { checkpointDamaged } from '../http/errors.js';
import {
  getObject,
  headObject,
  putObject,
  sha256Base64,
  sha256Hex,
} from '../services/storage.js';

export const blobKey = (projectId: string, sha256: string) =>
  `projects/${projectId}/blobs/${sha256}`;

export const manifestKey = (projectId: string, checkpointId: string) =>
  `projects/${projectId}/checkpoints/${checkpointId}/manifest.json`;

export const quarantineKey = (importId: string) => `quarantine/${importId}.zip`;

class BlobNotConfirmed extends Error {
  constructor(sha256: string) {
    super(`Storage did not confirm blob ${sha256}`);
    this.name = 'BlobNotConfirmed';
  }
}

/**
 * The one place a blob counts as stored. An object already at the key is never
 * accepted on sight: either storage reports the expected checksum, or the bytes
 * are read back and hashed.
 */
export async function confirmBlob(projectId: string, sha256: string, bytes: Buffer): Promise<void> {
  const key = blobKey(projectId, sha256);
  const expected = sha256Base64(bytes);

  const existing = await headObject(key);
  if (existing !== null && existing.checksumSha256 === expected) return;

  await putObject(key, bytes, { checksumSha256: expected, contentType: 'application/octet-stream' });

  const written = await headObject(key);
  if (written !== null && written.checksumSha256 === expected) return;

  const readBack = await getObject(key);
  if (readBack !== null && sha256Hex(readBack.body) === sha256) return;

  throw new BlobNotConfirmed(sha256);
}

export interface ManifestFile {
  file_id: string;
  path: string;
  sha256: string;
  size: number;
}

export function manifestBody(manifest: {
  checkpointId: string;
  projectId: string;
  name: string;
  createdAt: string;
  files: ManifestFile[];
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      checkpoint_id: manifest.checkpointId,
      project_id: manifest.projectId,
      name: manifest.name,
      created_at: manifest.createdAt,
      files: [...manifest.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    }),
    'utf8',
  );
}

/**
 * The one place the damage check runs. Every blob read is hashed against the
 * manifest's hash for that file; a missing or differing blob is damage.
 */
export async function readCheckpointBlobs(
  projectId: string,
  files: readonly ManifestFile[],
): Promise<{ file: ManifestFile; bytes: Buffer }[]> {
  const bytesBySha = new Map<string, Buffer>();
  const read: { file: ManifestFile; bytes: Buffer }[] = [];
  const damaged: string[] = [];

  for (const file of files) {
    let bytes = bytesBySha.get(file.sha256);
    if (bytes === undefined) {
      const stored = await getObject(blobKey(projectId, file.sha256));
      if (stored === null || sha256Hex(stored.body) !== file.sha256) {
        damaged.push(file.path);
        continue;
      }
      bytes = stored.body;
      bytesBySha.set(file.sha256, bytes);
    }
    read.push({ file, bytes });
  }

  if (damaged.length > 0) throw checkpointDamaged(damaged);
  return read;
}
