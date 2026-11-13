import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config";
import { fail, type ApiError } from "./errors";

const client = new S3Client({
  endpoint: config.s3Endpoint,
  region: config.s3Region,
  forcePathStyle: config.s3ForcePathStyle,
  credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey },
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 2000, requestTimeout: 15000 },
});

type StorageKind = "image" | "evidence";

function unavailable(kind: StorageKind): ApiError {
  return fail(kind === "image" ? "storage_unavailable_image" : "storage_unavailable_evidence");
}

/**
 * Writes the object and reads its size back. Only when the size equals the uploaded size does the
 * caller get to create its record; anything else leaves nothing behind.
 */
export async function putVerified(key: string, bytes: Buffer, contentType: string, kind: StorageKind): Promise<void> {
  try {
    await client.send(new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, Body: bytes, ContentType: contentType }));
    const head = await client.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    if (head.ContentLength !== bytes.length) throw new Error("size mismatch");
  } catch {
    await client.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key })).catch(() => undefined);
    throw unavailable(kind);
  }
}

export async function readObject(key: string): Promise<Buffer | null> {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    return result.Body ? Buffer.from(await result.Body.transformToByteArray()) : null;
  } catch {
    return null;
  }
}

/** True while the bucket answers. */
export async function storageReachable(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }), { abortSignal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
