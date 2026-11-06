/**
 * The filing vault. Exhibit bytes are staged, read back, then copied to their
 * published key; the vault's reachability is probed in the background.
 */
import { VaultClient, VaultUnreachable } from './s3';
import { loadConfig } from './config';
import { seededExhibits } from './seedExhibits';

const client = new VaultClient(loadConfig().vault);

let reachable = false;
let bucketReady = false;
let seedsWritten = false;

export type VaultStatus = 'available' | 'unavailable';

export function vaultStatus(): VaultStatus {
  return reachable ? 'available' : 'unavailable';
}

export function stagingKey(restatementId: string, uploadId: string): string {
  return `incoming/${restatementId}/${uploadId}.pdf`;
}

export function publishedKey(accession: string, sha256: string): string {
  return `exhibits/${accession}/${sha256}.pdf`;
}

async function ensureReady(): Promise<void> {
  if (!bucketReady) {
    await client.ensureBucket();
    bucketReady = true;
  }
}

export async function stageExhibitBytes(key: string, body: Buffer): Promise<void> {
  try {
    await ensureReady();
    await client.putObject(key, body, 'application/pdf');
    reachable = true;
  } catch (failure) {
    reachable = false;
    bucketReady = false;
    throw failure instanceof VaultUnreachable ? failure : new VaultUnreachable();
  }
}

/** Reads an object back, whether staged under `incoming/` or published. */
export async function readVaultBytes(key: string): Promise<Buffer> {
  try {
    const body = await client.getObject(key);
    reachable = true;
    if (body === null) throw new VaultUnreachable();
    return body;
  } catch (failure) {
    if (!(failure instanceof VaultUnreachable)) reachable = false;
    throw failure instanceof VaultUnreachable ? failure : new VaultUnreachable();
  }
}

/** Create-only write; an existing object is attached unchanged. */
export async function copyToPublishedKey(key: string, body: Buffer): Promise<void> {
  try {
    await ensureReady();
    await client.putObjectIfAbsent(key, body, 'application/pdf');
    reachable = true;
  } catch (failure) {
    reachable = false;
    bucketReady = false;
    throw failure instanceof VaultUnreachable ? failure : new VaultUnreachable();
  }
}

async function writeSeededExhibits(): Promise<void> {
  for (const exhibit of seededExhibits()) {
    const key = publishedKey(exhibit.accession, exhibit.sha256);
    if (await client.objectExists(key)) continue;
    await client.putObjectIfAbsent(key, exhibit.bytes, 'application/pdf');
  }
  seedsWritten = true;
}

async function probeOnce(): Promise<void> {
  const alive = await client.probe();
  reachable = alive;
  if (!alive) {
    bucketReady = false;
    return;
  }
  try {
    await ensureReady();
    if (!seedsWritten) await writeSeededExhibits();
  } catch {
    reachable = false;
    bucketReady = false;
  }
}

export function startVaultProbe(): void {
  void probeOnce();
  setInterval(() => {
    void probeOnce();
  }, 3000).unref();
}
