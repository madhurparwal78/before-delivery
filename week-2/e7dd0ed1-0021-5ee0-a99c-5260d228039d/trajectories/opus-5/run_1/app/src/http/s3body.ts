import { s3Error } from '../errors';
import { checksumAlgorithms, checksumBase64, isValidChecksumValue, type ChecksumAlgorithm } from '../crypto/checksums';
import { chunkSignature, constantTimeEquals, sha256Hex, type SigV4Credential } from '../crypto/sigv4';
import { md5Hex } from '../crypto/objects';
import { header, readBody, PayloadTooLarge, type Context } from './core';

export interface SigningContext {
  secret: string;
  credential: SigV4Credential;
  amzDate: string;
  headerSignature: string;
}

export interface DecodedBody {
  bytes: Buffer;
  checksum: { algorithm: ChecksumAlgorithm; value: string } | null;
}

const streamingSigned = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
const streamingUnsignedTrailer = 'STREAMING-UNSIGNED-PAYLOAD-TRAILER';
const notImplementedModes = [
  'STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER',
  'STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD',
  'STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD-TRAILER',
];

export function payloadMode(ctx: Context): string {
  return header(ctx, 'x-amz-content-sha256') ?? 'UNSIGNED-PAYLOAD';
}

export function isChunkedMode(mode: string): boolean {
  return mode === streamingSigned || mode === streamingUnsignedTrailer;
}

function checksumFromHeaders(ctx: Context): { algorithm: ChecksumAlgorithm; value: string } | null {
  const given = checksumAlgorithms
    .map((algorithm) => ({ algorithm, value: header(ctx, `x-amz-checksum-${algorithm}`) }))
    .filter((entry) => entry.value !== undefined);
  if (given.length === 0) return null;
  if (given.length > 1) throw s3Error('InvalidArgument', 'Send at most one checksum.');
  const entry = given[0];
  if (!isValidChecksumValue(entry.algorithm, entry.value as string)) throw s3Error('InvalidArgument', 'The checksum value is not valid.');
  return { algorithm: entry.algorithm, value: entry.value as string };
}

function parseSignedChunks(raw: Buffer, signing: SigningContext): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  let previous = signing.headerSignature;
  for (;;) {
    const lineEnd = raw.indexOf('\r\n', offset, 'utf8');
    if (lineEnd < 0) throw s3Error('IncompleteBody');
    const headerLine = raw.subarray(offset, lineEnd).toString('utf8');
    const match = /^([0-9a-fA-F]+);chunk-signature=([0-9a-f]{64})$/.exec(headerLine);
    if (!match) throw s3Error('IncompleteBody');
    const size = parseInt(match[1], 16);
    const dataStart = lineEnd + 2;
    if (dataStart + size + 2 > raw.length && size > 0) throw s3Error('IncompleteBody');
    const data = raw.subarray(dataStart, dataStart + size);
    const expected = chunkSignature(signing.secret, signing.credential, signing.amzDate, previous, data);
    if (!constantTimeEquals(expected, match[2])) throw s3Error('SignatureDoesNotMatch');
    previous = match[2];
    if (size === 0) return Buffer.concat(parts);
    parts.push(data);
    offset = dataStart + size + 2;
  }
}

function parseUnsignedTrailerChunks(
  raw: Buffer,
  trailerName: string | undefined,
): { bytes: Buffer; checksum: { algorithm: ChecksumAlgorithm; value: string } | null } {
  const parts: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const lineEnd = raw.indexOf('\r\n', offset, 'utf8');
    if (lineEnd < 0) throw s3Error('IncompleteBody');
    const headerLine = raw.subarray(offset, lineEnd).toString('utf8');
    if (!/^[0-9a-fA-F]+$/.test(headerLine)) throw s3Error('IncompleteBody');
    const size = parseInt(headerLine, 16);
    const dataStart = lineEnd + 2;
    if (size === 0) {
      const tail = raw.subarray(dataStart).toString('utf8');
      const lines = tail.split('\r\n').filter((line) => line !== '');
      if (trailerName === undefined || lines.length !== 1) throw s3Error('InvalidArgument', 'Send exactly the named trailer.');
      const separator = lines[0].indexOf(':');
      const name = lines[0].slice(0, separator).trim().toLowerCase();
      const value = lines[0].slice(separator + 1).trim();
      if (name !== trailerName.trim().toLowerCase()) throw s3Error('InvalidArgument', 'Send exactly the named trailer.');
      const algorithm = checksumAlgorithms.find((candidate) => `x-amz-checksum-${candidate}` === name);
      if (!algorithm) throw s3Error('InvalidArgument', 'Name a supported checksum trailer.');
      if (!isValidChecksumValue(algorithm, value)) throw s3Error('InvalidArgument', 'The checksum value is not valid.');
      return { bytes: Buffer.concat(parts), checksum: { algorithm, value } };
    }
    if (dataStart + size + 2 > raw.length) throw s3Error('IncompleteBody');
    parts.push(raw.subarray(dataStart, dataStart + size));
    offset = dataStart + size + 2;
  }
}

export function declaredDecodedLength(ctx: Context): number | null {
  const mode = payloadMode(ctx);
  if (!isChunkedMode(mode)) {
    const length = header(ctx, 'content-length');
    return length === undefined ? null : Number(length);
  }
  const decoded = header(ctx, 'x-amz-decoded-content-length');
  if (decoded === undefined || !/^\d+$/.test(decoded)) throw s3Error('InvalidArgument', 'Send x-amz-decoded-content-length.');
  return Number(decoded);
}

/**
 * Reads a PutObject or UploadPart body in whichever payload mode the SDK used, verifies the chunk
 * signatures, decoded length, checksums and Content-MD5, and returns only the decoded bytes.
 */
export async function readS3Body(ctx: Context, signing: SigningContext, limit: number): Promise<DecodedBody> {
  const mode = payloadMode(ctx);
  if (notImplementedModes.includes(mode)) throw s3Error('NotImplemented');
  const encoding = header(ctx, 'content-encoding') ?? '';
  if (isChunkedMode(mode) && !encoding.includes('aws-chunked')) {
    throw s3Error('InvalidArgument', 'Chunked payloads need Content-Encoding: aws-chunked.');
  }
  const declared = declaredDecodedLength(ctx);
  if (declared !== null && declared > limit) throw s3Error('EntityTooLarge');

  let raw: Buffer;
  try {
    raw = await readBody(ctx, Math.max(limit * 2, limit + 1024 * 1024));
  } catch (error) {
    if (error instanceof PayloadTooLarge) throw s3Error('EntityTooLarge');
    throw error;
  }

  let bytes: Buffer;
  let checksum = checksumFromHeaders(ctx);
  if (mode === streamingSigned) {
    bytes = parseSignedChunks(raw, signing);
  } else if (mode === streamingUnsignedTrailer) {
    const parsed = parseUnsignedTrailerChunks(raw, header(ctx, 'x-amz-trailer'));
    bytes = parsed.bytes;
    if (checksum !== null && parsed.checksum !== null) throw s3Error('InvalidArgument', 'Send at most one checksum.');
    checksum = parsed.checksum ?? checksum;
  } else {
    bytes = raw;
    if (mode !== 'UNSIGNED-PAYLOAD' && /^[0-9a-f]{64}$/.test(mode) && sha256Hex(bytes) !== mode) throw s3Error('BadDigest');
  }

  if (declared !== null && bytes.length !== declared) throw s3Error('IncompleteBody');
  if (bytes.length > limit) throw s3Error('EntityTooLarge');
  const contentMd5 = header(ctx, 'content-md5');
  if (contentMd5 !== undefined && Buffer.from(md5Hex(bytes), 'hex').toString('base64') !== contentMd5.trim()) {
    throw s3Error('BadDigest');
  }
  if (checksum !== null && checksumBase64(checksum.algorithm, bytes) !== checksum.value) throw s3Error('BadDigest');
  return { bytes, checksum };
}
