import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Config } from "./env.ts";

let s3: S3Client | null = null;
let bucketNameValue = "";

export class StorageUnavailable extends Error {}

export function initStorage(cfg: Config): void {
  s3 = new S3Client({
    region: cfg.s3Region,
    endpoint: cfg.s3Endpoint,
    forcePathStyle: cfg.s3ForcePathStyle,
    credentials: {
      accessKeyId: cfg.s3AccessKeyId,
      secretAccessKey: cfg.s3SecretAccessKey,
    },
    // A down storage endpoint must be reported quickly, not after long retries.
    maxAttempts: 1,
    requestHandler: { requestTimeout: 3000, connectionTimeout: 2000 },
  });
  bucketNameValue = cfg.s3Bucket;
}

export async function ensureBucket(cfg: Config): Promise<void> {
  if (!s3) return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: cfg.s3Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: cfg.s3Bucket }));
  }
}

/** The storage probe: true only when MinIO actually answers for this copy. */
export async function probeStorage(cfg: Config): Promise<boolean> {
  if (!s3) return false;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: cfg.s3Bucket }));
    return true;
  } catch (err) {
    const name = (err as { name?: string; Code?: string }).name ?? "";
    const code = (err as { Code?: string }).Code ?? "";
    if (name.includes("NotFound") || String(code).includes("404") || name.includes("NoSuchBucket")) {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: cfg.s3Bucket }));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  if (!s3) throw new StorageUnavailable("storage not initialised");
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: bytes, ContentType: contentType }));
  } catch {
    throw new StorageUnavailable("put failed");
  }
}

export async function getObject(key: string): Promise<Buffer> {
  if (!s3) throw new StorageUnavailable("storage not initialised");
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
    const chunks: Buffer[] = [];
    if (res.Body) {
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch {
    throw new StorageUnavailable("get failed");
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (!s3) throw new StorageUnavailable("storage not initialised");
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
  } catch {
    throw new StorageUnavailable("delete failed");
  }
}

function bucketName(): string {
  return bucketNameValue;
}

/** Types sent as application/octet-stream so they can never execute in the browser. */
const opaqueTypes = ["text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/javascript"];

export function downloadContentType(stored: string): string {
  const bare = stored.split(";")[0].trim().toLowerCase();
  return opaqueTypes.includes(bare) ? "application/octet-stream" : stored;
}

export function downloadFilename(original: string): { fallback: string; encoded: string } {
  const safe: string[] = [];
  for (const ch of original) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e && ch !== '"' && ch !== "\\") {
      safe.push(ch);
    } else {
      safe.push("_");
    }
  }
  let encoded = "";
  for (const ch of original) {
    if (/[A-Za-z0-9!#$&+\-.^_`|~]/.test(ch)) {
      encoded += ch;
    } else {
      for (const byte of Buffer.from(ch, "utf8")) {
        encoded += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return { fallback: safe.join(""), encoded };
}

export function storageKeyFor(workspaceSlug: string, attachmentId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9.\-_]/g, "_");
  return `${workspaceSlug}/${attachmentId}/${safe}`;
}
