import * as crypto from 'node:crypto';

/**
 * Object bytes reach MinIO only as AES-256-GCM segments under the version's own data key.
 * Each segment is nonce(12) | ciphertext | tag(16) over at most SEGMENT plaintext bytes.
 */
const SEGMENT = 1 << 23;
const OVERHEAD = 28;

export function newDataKey(): Buffer {
  return crypto.randomBytes(32);
}

export function ciphertextLength(plaintextLength: number): number {
  if (plaintextLength === 0) return OVERHEAD;
  const full = Math.floor(plaintextLength / SEGMENT);
  const rest = plaintextLength % SEGMENT;
  return full * (SEGMENT + OVERHEAD) + (rest > 0 ? rest + OVERHEAD : 0);
}

function encryptSegment(dataKey: Buffer, plaintext: Buffer): Buffer {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

function decryptSegment(dataKey: Buffer, segment: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, segment.subarray(0, 12));
  decipher.setAuthTag(segment.subarray(segment.length - 16));
  return Buffer.concat([decipher.update(segment.subarray(12, segment.length - 16)), decipher.final()]);
}

export function encryptBytes(dataKey: Buffer, plaintext: Buffer): Buffer {
  const parts: Buffer[] = [];
  if (plaintext.length === 0) return encryptSegment(dataKey, plaintext);
  for (let offset = 0; offset < plaintext.length; offset += SEGMENT) {
    parts.push(encryptSegment(dataKey, plaintext.subarray(offset, Math.min(offset + SEGMENT, plaintext.length))));
  }
  return Buffer.concat(parts);
}

export function decryptBytes(dataKey: Buffer, ciphertext: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < ciphertext.length) {
    const size = Math.min(SEGMENT + OVERHEAD, ciphertext.length - offset);
    parts.push(decryptSegment(dataKey, ciphertext.subarray(offset, offset + size)));
    offset += size;
  }
  return Buffer.concat(parts);
}

export async function* encryptStream(dataKey: Buffer, source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let pendingLength = 0;
  let wroteAny = false;
  for await (const chunk of source) {
    pending.push(chunk);
    pendingLength += chunk.length;
    while (pendingLength >= SEGMENT) {
      const joined = Buffer.concat(pending);
      yield encryptSegment(dataKey, joined.subarray(0, SEGMENT));
      wroteAny = true;
      pending = [joined.subarray(SEGMENT)];
      pendingLength = pending[0].length;
    }
  }
  if (pendingLength > 0 || !wroteAny) yield encryptSegment(dataKey, Buffer.concat(pending));
}

export function md5Hex(bytes: Buffer): string {
  return crypto.createHash('md5').update(bytes).digest('hex');
}

export function quotedEtag(hex: string): string {
  return `"${hex}"`;
}

/** The ETag of a multipart version: MD5 of the concatenated binary part MD5s, then "-<count>". */
export function multipartEtag(partMd5Hex: string[]): string {
  const digest = crypto.createHash('md5').update(Buffer.concat(partMd5Hex.map((hex) => Buffer.from(hex, 'hex')))).digest('hex');
  return `"${digest}-${partMd5Hex.length}"`;
}
