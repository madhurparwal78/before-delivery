import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { config } from "./config.js";
import { Errors } from "./errors.js";

export type ImageKind = { ext: "jpg" | "png" | "webp"; contentType: string };

export function detectImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { ext: "png", contentType: "image/png" };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

/** Removes every embedded metadata block: JPEG APP segments (EXIF, XMP),
 *  PNG text chunks and WebP EXIF/XMP chunks. */
export function stripMetadata(buf: Buffer, kind: ImageKind): Buffer {
  if (kind.ext === "jpg") return stripJpeg(buf);
  if (kind.ext === "png") return stripPng(buf);
  return stripWebp(buf);
}

function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4) return buf;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) {
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    const marker = buf[i + 1];
    if (marker === undefined) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    const len = buf.readUInt16BE(i + 2);
    // Keep only the JPEG's own structures, drop APPn and COM segments.
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      i += 2 + len;
      continue;
    }
    out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat(out);
}

function stripPng(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("ascii");
    const isText = type === "tEXt" || type === "zTXt" || type === "iTXt";
    if (type === "IEND") {
      out.push(buf.subarray(i, i + 12));
      return Buffer.concat(out);
    }
    if (!isText) {
      out.push(buf.subarray(i, i + 12 + len));
    }
    i += 12 + len;
  }
  return Buffer.concat(out);
}

function stripWebp(buf: Buffer): Buffer {
  // VP8X-chunked files may carry EXIF/XMP chunks; drop them and fix nothing else,
  // since chunk offsets are not used by the container.
  if (buf.subarray(12, 16).toString("ascii") !== "VP8X") return buf;
  const out: Buffer[] = [buf.subarray(0, 12)];
  let i = 12 + 10;
  while (i + 8 <= buf.length) {
    const tag = buf.subarray(i, i + 4).toString("ascii");
    const size = buf.readUInt32LE(i + 4) + (buf.readUInt32LE(i + 4) % 2);
    if (tag === "EXIF" || tag === "XMP ") {
      i += 8 + size;
      continue;
    }
    out.push(buf.subarray(i, i + 8 + size));
    i += 8 + size;
  }
  return Buffer.concat(out);
}

export class Storage {
  private client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
      const stream = res.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw Errors.storageUnavailable();
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    } catch {
      throw Errors.storageUnavailable();
    }
  }

  async reachable(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage = new Storage();
