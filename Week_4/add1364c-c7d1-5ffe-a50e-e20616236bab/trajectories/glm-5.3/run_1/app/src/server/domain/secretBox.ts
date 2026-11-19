import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Login secrets are stored only in encrypted form. The key comes from
 * `LOCKSET_SECRET_KEY` (64 hexadecimal characters) or is derived from
 * `AUTH_CLIENT_SECRET`. The key is never stored in Postgres.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(locksetSecretKey: string | null, authClientSecret: string) {
    if (locksetSecretKey && /^[0-9a-fA-F]{64}$/.test(locksetSecretKey)) {
      this.key = Buffer.from(locksetSecretKey, 'hex');
    } else {
      this.key = createHash('sha256').update(`lockset:${authClientSecret}`).digest();
    }
  }

  /** Encrypt a secret at rest; returns ciphertext bytes with the nonce prefix. */
  encrypt(secret: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, tag, encrypted]);
  }

  /** Decrypt ciphertext produced by `encrypt`. */
  decrypt(box: Buffer): string {
    const nonce = box.subarray(0, 12);
    const tag = box.subarray(12, 28);
    const encrypted = box.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  /** A non-reversible, non-full fingerprint of a secret, for exposure checks. */
  fingerprint(secret: string): string {
    return createHash('sha256').update(`fp:${secret}`).digest('hex').slice(0, 16);
  }
}
