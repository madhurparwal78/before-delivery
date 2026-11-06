import { Client as MinioClient } from "minio";
import sharp from "sharp";
import type { AppConfig } from "./config.js";

// MinIO holds originals and derivatives in one private bucket. The browser
// never talks to MinIO except through signed grant links.
export interface Storage {
  client: MinioClient;
  bucket: string;
}

export function createStorage(config: AppConfig): Storage {
  const url = new URL(config.s3.endpoint);
  const isHttps = url.protocol === "https:";
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  const client = new MinioClient({
    endPoint: url.hostname,
    port,
    useSSL: isHttps,
    accessKey: config.s3.accessKeyId,
    secretKey: config.s3.secretAccessKey,
    region: config.s3.region,
  });
  return { client, bucket: config.s3.bucket };
}

export const MAX_UPLOAD_BYTES = 25000000;

export const originalKey = (essayId: string, frameId: string) => `originals/${essayId}/${frameId}`;
export const derivativeKey = (essayId: string, frameId: string, variant: "grid" | "story" | "preview") =>
  `derivatives/${essayId}/${frameId}/${variant}.jpg`;
export const grantKey = (licenceId: string) => `grants/${licenceId}.json`;
export const legalHoldKey = (essayId: string, frameId: string) => `legal-hold/${essayId}/${frameId}`;

export async function bucketExists(storage: Storage): Promise<boolean> {
  try {
    await storage.client.bucketExists(storage.bucket);
    return true;
  } catch {
    return false;
  }
}

export async function ensureBucket(storage: Storage): Promise<void> {
  try {
    await storage.client.makeBucket(storage.bucket);
  } catch (err) {
    // BucketAlreadyOwnedByYou / AlreadyExists are fine.
    const code = (err as { code?: string }).code ?? "";
    if (!/BucketAlready|AlreadyExists|Conflict/.test(code)) throw err;
  }
}

export async function putObject(storage: Storage, key: string, data: Buffer, contentType: string): Promise<void> {
  await storage.client.putObject(storage.bucket, key, data, data.length, { "Content-Type": contentType });
}

export async function getObject(storage: Storage, key: string): Promise<Buffer> {
  const stream = await storage.client.getObject(storage.bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function removeObject(storage: Storage, key: string): Promise<void> {
  await storage.client.removeObject(storage.bucket, key);
}

export async function copyObject(storage: Storage, sourceKey: string, destKey: string): Promise<void> {
  await storage.client.copyObject(storage.bucket, destKey, `/${storage.bucket}/${sourceKey}`);
}

export async function putOriginal(storage: Storage, essayId: string, frameId: string, data: Buffer): Promise<void> {
  await putObject(storage, originalKey(essayId, frameId), data, "image/jpeg");
}

// Derivatives carry no GPS location while the stored original keeps its bytes
// unchanged: sharp strips all metadata unless asked to keep it.
export async function makeDerivatives(storage: Storage, essayId: string, frameId: string, original: Buffer): Promise<void> {
  const image = sharp(original, { failOn: "none" });
  const grid = await image.clone().resize(600, 600, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
  const story = await image.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const previewBase = await image.clone().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const meta = await sharp(previewBase).metadata();
  const watermark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">
    <g fill="rgba(38,41,47,0.34)" font-family="IBM Plex Mono, monospace" font-size="${Math.max(28, Math.round(meta.width! / 24))}" transform="rotate(-30 ${meta.width! / 2} ${meta.height! / 2})">
      <text x="${meta.width! * 0.10}" y="${meta.height! * 0.35}">SALTPRINT PREVIEW</text>
      <text x="${meta.width! * 0.30}" y="${meta.height! * 0.75}">SALTPRINT PREVIEW</text>
    </g>
  </svg>`);
  const preview = await sharp(previewBase).composite([{ input: watermark }]).jpeg({ quality: 80 }).toBuffer();
  await putObject(storage, derivativeKey(essayId, frameId, "grid"), grid, "image/jpeg");
  await putObject(storage, derivativeKey(essayId, frameId, "story"), story, "image/jpeg");
  await putObject(storage, derivativeKey(essayId, frameId, "preview"), preview, "image/jpeg");
}

// Sniff an upload's type from its leading bytes only; the file name and the
// declared part type are ignored.
export function sniffImageType(head: Buffer): "image/jpeg" | "image/png" | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) return "image/png";
  return null;
}

export interface GrantLink {
  url: string;
  expiresAtMs: number;
}

// A grant link is a signed GET for exactly one original key, with content
// disposition naming the essay and frame. It never outlives the licence end:
// its validity is the shorter of 300 seconds and the time left on the server
// clock until the licence end.
export async function presignOriginal(
  storage: Storage,
  essayId: string,
  frameId: string,
  framePosition: number,
  type: "image/jpeg" | "image/png",
  licenceEndMs: number,
  serverNowMs: number,
): Promise<GrantLink> {
  const remainingSec = Math.max(1, Math.min(300, Math.floor((licenceEndMs - serverNowMs) / 1000)));
  const ext = type === "image/png" ? "png" : "jpg";
  const disposition = `attachment; filename="${essayId}-frame-${framePosition}.${ext}"`;
  const url = await storage.client.presignedUrl("GET", storage.bucket, originalKey(essayId, frameId), remainingSec, {
    "response-content-disposition": disposition,
    "response-content-type": type,
  });
  return { url, expiresAtMs: serverNowMs + remainingSec * 1000 };
}
