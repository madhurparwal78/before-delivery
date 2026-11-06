// ETags, the four flexible checksums and aws-chunked body decoding (brief: S3 payload modes and
// checksums; Versions and conditional writes, ETags).
import { createHash } from "node:crypto";
import { S3Error } from "./errors.js";
import { hmac, EMPTY_SHA256 } from "./sigv4.js";

// The quoted ETag from the MD5 of a whole object, or from the MD5s of its parts: the MD5 of the
// concatenated part digests followed by "-<part count>".
export function etagFromDigests(digest: Buffer | Buffer[]): string {
  if (!Array.isArray(digest)) return `"${digest.toString("hex")}"`;
  return `"${createHash("md5").update(Buffer.concat(digest)).digest("hex")}-${digest.length}"`;
}

export const md5Etag = (data: Buffer): string => etagFromDigests(createHash("md5").update(data).digest());

export const multipartEtag = (partEtags: string[]): string =>
  etagFromDigests(partEtags.map((etag) => Buffer.from(etag.replace(/"/g, ""), "hex")));

export function verifyContentMd5(header: string | undefined, data: Buffer): void {
  if (header !== undefined && createHash("md5").update(data).digest("base64") !== header) throw new S3Error("BadDigest");
}

// A hex x-amz-content-sha256 must be the SHA-256 of the body as sent.
export function verifyPayloadSha256(mode: string, raw: Buffer): void {
  if (/^[0-9a-f]{64}$/.test(mode) && createHash("sha256").update(raw).digest("hex") !== mode) throw new S3Error("BadDigest");
}

export type ChecksumAlgorithm = "crc32" | "crc32c" | "sha1" | "sha256";
export const CHECKSUM_ALGORITHMS: readonly ChecksumAlgorithm[] = ["crc32", "crc32c", "sha1", "sha256"];
const DIGEST_LENGTH: Record<ChecksumAlgorithm, number> = { crc32: 4, crc32c: 4, sha1: 20, sha256: 32 };

function crcTable(polynomial: number): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? polynomial ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC32_TABLE = crcTable(0xedb88320);
const CRC32C_TABLE = crcTable(0x82f63b78);

function crc(table: Uint32Array, data: Buffer): Buffer {
  let c = 0xffffffff;
  for (const byte of data) c = (table[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  const out = Buffer.alloc(4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return out;
}

function checksum(algorithm: ChecksumAlgorithm, data: Buffer): string {
  switch (algorithm) {
    case "crc32": return crc(CRC32_TABLE, data).toString("base64");
    case "crc32c": return crc(CRC32C_TABLE, data).toString("base64");
    case "sha1": return createHash("sha1").update(data).digest("base64");
    case "sha256": return createHash("sha256").update(data).digest("base64");
  }
}

function validChecksumValue(algorithm: ChecksumAlgorithm, value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  return Buffer.from(value, "base64").length === DIGEST_LENGTH[algorithm];
}

export interface SuppliedChecksum {
  algorithm: ChecksumAlgorithm;
  value: string;
}

// Reads the x-amz-checksum-<algorithm> headers and the x-amz-trailer declaration; more than one
// checksum, or an unknown trailer, answers InvalidArgument.
export function declaredChecksum(headers: Record<string, string | undefined>): { header: SuppliedChecksum | null; trailer: ChecksumAlgorithm | null } {
  const given = CHECKSUM_ALGORITHMS.filter((a) => headers[`x-amz-checksum-${a}`] !== undefined);
  const trailerName = headers["x-amz-trailer"];
  let trailer: ChecksumAlgorithm | null = null;
  if (trailerName !== undefined) {
    trailer = CHECKSUM_ALGORITHMS.find((a) => `x-amz-checksum-${a}` === trailerName.trim().toLowerCase()) ?? null;
    if (!trailer) throw new S3Error("InvalidArgument", "x-amz-trailer must name one checksum header.");
  }
  if (given.length + (trailer ? 1 : 0) > 1) throw new S3Error("InvalidArgument", "Send one checksum per request.");
  const algorithm = given[0];
  if (!algorithm) return { header: null, trailer };
  const value = headers[`x-amz-checksum-${algorithm}`] ?? "";
  if (!validChecksumValue(algorithm, value)) throw new S3Error("InvalidArgument", "The checksum value is not valid base64 of the right length.");
  return { header: { algorithm, value }, trailer };
}

export function verifyChecksum(supplied: SuppliedChecksum, data: Buffer): void {
  if (checksum(supplied.algorithm, data) !== supplied.value) throw new S3Error("BadDigest", "The checksum does not match the body.");
}

interface ChunkSigning {
  key: Buffer;
  amzDate: string;
  scope: string;
  seedSignature: string;
}

interface DecodedBody {
  data: Buffer;
  trailer: SuppliedChecksum | null;
}

const CRLF = Buffer.from("\r\n");

function lineAt(raw: Buffer, offset: number): { line: string; next: number } {
  const end = raw.indexOf(CRLF, offset);
  if (end < 0) throw new S3Error("IncompleteBody");
  return { line: raw.subarray(offset, end).toString("latin1"), next: end + 2 };
}

// Decodes an aws-chunked body: signed chunks (STREAMING-AWS4-HMAC-SHA256-PAYLOAD) whose chain of
// chunk signatures is checked, or unsigned chunks followed by one checksum trailer.
export function decodeChunked(raw: Buffer, decodedLength: number, signing: ChunkSigning | null,
                              trailer: ChecksumAlgorithm | null): DecodedBody {
  const pieces: Buffer[] = [];
  let offset = 0;
  let previous = signing?.seedSignature ?? "";
  for (;;) {
    const { line, next } = lineAt(raw, offset);
    const [sizeText, ...extensions] = line.split(";");
    if (!sizeText || !/^[0-9a-fA-F]+$/.test(sizeText)) throw new S3Error("IncompleteBody");
    const size = parseInt(sizeText, 16);
    if (next + size > raw.length) throw new S3Error("IncompleteBody");
    const chunk = raw.subarray(next, next + size);
    if (signing) {
      const given = extensions.find((e) => e.startsWith("chunk-signature="))?.slice("chunk-signature=".length);
      if (!given || !/^[0-9a-f]{64}$/.test(given)) throw new S3Error("IncompleteBody");
      const toSign = ["AWS4-HMAC-SHA256-PAYLOAD", signing.amzDate, signing.scope, previous, EMPTY_SHA256,
        createHash("sha256").update(chunk).digest("hex")].join("\n");
      if (hmac(signing.key, toSign).toString("hex") !== given) throw new S3Error("SignatureDoesNotMatch");
      previous = given;
    }
    if (size === 0) {
      offset = next;
      break;
    }
    pieces.push(chunk);
    if (!raw.subarray(next + size, next + size + 2).equals(CRLF)) throw new S3Error("IncompleteBody");
    offset = next + size + 2;
  }
  let suppliedTrailer: SuppliedChecksum | null = null;
  const lines: string[] = [];
  while (offset < raw.length) {
    const { line, next } = lineAt(raw, offset);
    offset = next;
    if (line === "") break;
    lines.push(line);
  }
  if (offset !== raw.length) throw new S3Error("IncompleteBody");
  if (trailer) {
    const [only, ...extra] = lines;
    const separator = only?.indexOf(":") ?? -1;
    if (!only || extra.length || separator < 0 || only.slice(0, separator).trim().toLowerCase() !== `x-amz-checksum-${trailer}`) {
      throw new S3Error("InvalidArgument", "The trailer must carry exactly the declared checksum.");
    }
    const value = only.slice(separator + 1).trim();
    if (!validChecksumValue(trailer, value)) throw new S3Error("InvalidArgument", "The checksum value is not valid base64 of the right length.");
    suppliedTrailer = { algorithm: trailer, value };
  } else if (lines.length) {
    throw new S3Error("InvalidArgument", "This request declared no trailer.");
  }
  const data = Buffer.concat(pieces);
  if (data.length !== decodedLength) throw new S3Error("IncompleteBody");
  return { data, trailer: suppliedTrailer };
}
