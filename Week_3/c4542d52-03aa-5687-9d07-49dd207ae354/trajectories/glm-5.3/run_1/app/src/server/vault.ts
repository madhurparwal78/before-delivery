import { loadConfig } from './config.js';
import { VaultError, s3PutVerified, s3Get, type S3Config } from './s3client.js';

export { VaultError };

function cfg(): S3Config {
  const { s3 } = loadConfig();
  return {
    endpoint: s3.endpoint,
    region: s3.region || 'us-east-1',
    bucket: s3.bucket,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
  };
}

/**
 * Writes bytes once under the key and reads them back to verify: the
 * signature counts only after both happen (DP-11).
 */
export async function sealDocument(key: string, bytes: Buffer): Promise<string> {
  try {
    return await s3PutVerified(cfg(), key, bytes, 'text/plain; charset=utf-8');
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError();
  }
}

/** Reads the object's bytes unchanged (DP-45). */
export async function readDocument(key: string): Promise<Buffer> {
  try {
    const got = await s3Get(cfg(), key);
    return got.body;
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError();
  }
}

