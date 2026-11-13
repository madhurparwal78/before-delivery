import { config } from './config.js';

// MinIO object client via aws4fetch SigV4 signing.

interface AwsClient {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
}

async function getClient(): Promise<AwsClient> {
  const mod = (await import('aws4fetch')) as unknown as {
    AwsClient: new (opts: { accessKeyId: string; secretAccessKey: string; region: string; service: string }) => AwsClient;
  };
  return new mod.AwsClient({
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    region: config.s3.region,
    service: 's3',
  });
}

export interface ObjectResult {
  ok: boolean;
  bytes?: Uint8Array;
  conflict?: boolean;
}

async function signedFetch(path: string, init: RequestInit): Promise<Response> {
  const client = await getClient();
  return client.fetch(`${config.s3.endpoint}/${config.s3.bucket}${path}`, init);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export async function ensureBucket(): Promise<boolean> {
  try {
    const existing = await signedFetch('', { method: 'GET' });
    if (existing.ok) return true;
    const create = await signedFetch('', { method: 'PUT' });
    return create.ok;
  } catch {
    return false;
  }
}

export async function putObjectIfAbsent(key: string, bytes: Uint8Array): Promise<ObjectResult> {
  try {
    const existing = await signedFetch(`/${key}`, { method: 'GET' });
    if (existing.ok) {
      const prior = new Uint8Array(await existing.arrayBuffer());
      if (bytesEqual(prior, bytes)) return { ok: true };
      return { ok: false, conflict: true };
    }
    const put = await signedFetch(`/${key}`, {
      method: 'PUT',
      body: new Uint8Array(bytes),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!put.ok) return { ok: false };
    // Acceptance requires an acknowledged write plus a subsequent read of the exact bytes.
    const verify = await signedFetch(`/${key}`, { method: 'GET' });
    if (!verify.ok) return { ok: false };
    const stored = new Uint8Array(await verify.arrayBuffer());
    if (!bytesEqual(stored, bytes)) return { ok: false, conflict: true };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function getObject(key: string): Promise<ObjectResult> {
  try {
    const response = await signedFetch(`/${key}`, { method: 'GET' });
    if (!response.ok) return { ok: false };
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true, bytes };
  } catch {
    return { ok: false };
  }
}

export const levelsKey = (digest: string): string => `levels/${digest}.json`;
export const evidenceKey = (digest: string): string => `evidence/${digest}.json`;
