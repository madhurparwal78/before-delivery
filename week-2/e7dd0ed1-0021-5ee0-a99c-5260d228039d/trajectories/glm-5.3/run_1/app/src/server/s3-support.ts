import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { chunkSignature } from './sigv4.js';

export function s3ErrorXml(code: string, message: string, resource: string, requestId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${esc(code)}</Code><Message>${esc(message)}</Message><Resource>${esc(resource)}</Resource><RequestId>${esc(requestId)}</RequestId></Error>`;
}

export function sendS3Error(res: ServerResponse, status: number, code: string, message: string, resource: string, requestId: string, extra: Record<string, string> = {}): void {
  const body = s3ErrorXml(code, message, resource, requestId);
  res.writeHead(status, { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(body), ...extra });
  res.end(body);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface S3Fail { status: number; code: string; message: string; extra?: Record<string, string> }

/** The S3 error type every S3 handler throws. */
export class S3Error extends Error {
  readonly s3status: number;
  readonly s3code: string;
  readonly s3extra?: Record<string, string>;
  constructor(status: number, code: string, message: string, extra?: Record<string, string>) {
    super(message);
    this.s3status = status;
    this.s3code = code;
    this.s3extra = extra;
  }
}

export function s3Fail(status: number, code: string, message: string, extra?: Record<string, string>): S3Error {
  return new S3Error(status, code, message, extra);
}

/** URL encoding for encoding-type=url. */
export function s3UrlEncode(value: string): string {
  let out = '';
  for (const ch of value) {
    if (ch === ' ') { out += '+'; continue; }
    if (/[A-Za-z0-9\-_.~]/.test(ch) || ch === '/') { out += ch; continue; }
    for (const b of Buffer.from(ch, 'utf8')) out += '%' + b.toString(16).toUpperCase();
  }
  return out;
}

/** CRC32 (zip/gzip polynomial). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** CRC32C (Castagnoli). */
const CRC32C_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82F63B78 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32c(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC32C_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export interface ChecksumAlgo { name: string; digest: (buf: Buffer) => Buffer }

export const CHECKSUMS: Record<string, ChecksumAlgo> = {
  crc32: { name: 'CRC32', digest: b => { const n = crc32(b); return Buffer.from([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]); } },
  'crc32c': { name: 'CRC32C', digest: b => { const n = crc32c(b); return Buffer.from([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]); } },
  sha1: { name: 'SHA1', digest: b => createHash('sha1').update(b).digest() },
  sha256: { name: 'SHA256', digest: b => createHash('sha256').update(b).digest() },
};

/** aws-chunked decoding: signed chunks, unsigned chunks with a trailer, or plain. */
export type ChunkMode =
  | { kind: 'plain' }
  | { kind: 'signed'; signingKey: Buffer; date: string; scope: string; headerSignature: string }
  | { kind: 'trailer'; trailerName: string };

export interface DecodedBody { bytes: Buffer; error?: { code: string; status: number; message: string }; trailerChecksum?: { algo: string; value: string } }

export function decodeChunked(
  raw: Buffer, decodedLength: number | null, mode: ChunkMode,
): DecodedBody {
  const chunks: Buffer[] = [];
  let pos = 0;
  let previousSignature = mode.kind === 'signed' ? mode.headerSignature : '';
  let gotTrailer: { algo: string; value: string } | undefined;

  while (pos < raw.length) {
    const lineEnd = raw.indexOf('\r\n', pos);
    if (lineEnd < 0) return { bytes: Buffer.alloc(0), error: { code: 'IncompleteBody', status: 400, message: 'The request body could not be read.' } };
    let line = raw.subarray(pos, lineEnd).toString('ascii');
    let sizePart = line;
    let chunkSig: string | null = null;
    const semi = line.indexOf(';');
    if (semi >= 0) {
      sizePart = line.slice(0, semi);
      const sigM = /chunk-signature=([0-9a-f]{64})/.exec(line.slice(semi));
      if (sigM) chunkSig = sigM[1];
    }
    const size = parseInt(sizePart, 16);
    if (!Number.isFinite(size)) return { bytes: Buffer.alloc(0), error: { code: 'IncompleteBody', status: 400, message: 'The request body could not be read.' } };
    pos = lineEnd + 2;
    if (size === 0) {
      // After the zero chunk: signed mode has an empty line; trailer mode reads the trailer.
      if (mode.kind === 'trailer') {
        const tEnd = raw.indexOf('\r\n', pos);
        if (tEnd < 0) return { bytes: Buffer.alloc(0), error: { code: 'IncompleteBody', status: 400, message: 'The request body could not be read.' } };
        const trailerLine = raw.subarray(pos, tEnd).toString('ascii');
        const c = trailerLine.indexOf(':');
        if (c < 0) return { bytes: Buffer.alloc(0), error: { code: 'InvalidArgument', status: 400, message: 'The trailer is missing.' } };
        const name = trailerLine.slice(0, c).trim().toLowerCase();
        const value = trailerLine.slice(c + 1).trim();
        if (name !== mode.trailerName) {
          return { bytes: Buffer.alloc(0), error: { code: 'InvalidArgument', status: 400, message: 'The trailer does not match x-amz-trailer.' } };
        }
        gotTrailer = { algo: name.replace('x-amz-checksum-', ''), value };
        pos = tEnd + 2;
      }
      break;
    }
    if (pos + size > raw.length) return { bytes: Buffer.alloc(0), error: { code: 'IncompleteBody', status: 400, message: 'The request body could not be read.' } };
    const data = raw.subarray(pos, pos + size);
    if (mode.kind === 'signed') {
      if (!chunkSig) return { bytes: Buffer.alloc(0), error: { code: 'SignatureDoesNotMatch', status: 403, message: 'The chunk signature is missing.' } };
      const expected = chunkSignature(mode.signingKey, mode.date, mode.scope, previousSignature, sha256HexOf(data));
      if (expected !== chunkSig) {
        return { bytes: Buffer.alloc(0), error: { code: 'SignatureDoesNotMatch', status: 403, message: 'The chunk signature does not match.' } };
      }
      previousSignature = chunkSig;
    }
    chunks.push(data);
    pos += size;
    // consume trailing CRLF
    if (raw.subarray(pos, pos + 2).toString('ascii') === '\r\n') pos += 2;
  }
  const bytes = Buffer.concat(chunks);
  if (decodedLength !== null && bytes.length !== decodedLength) {
    return { bytes: Buffer.alloc(0), error: { code: 'IncompleteBody', status: 400, message: 'The decoded length does not match.' } };
  }
  return { bytes, trailerChecksum: gotTrailer };
}

function sha256HexOf(d: Buffer | string): string {
  return createHash('sha256').update(d).digest('hex');
}
