import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";
import { ApiError } from "../errors.js";

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 3000, requestTimeout: 20_000 },
});

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function exists(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return true;
  } catch (error) {
    if (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey")) return false;
    throw new ApiError("storage_unavailable");
  }
}

export async function readObject(key: string): Promise<Buffer> {
  try {
    const output = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return Buffer.from((await output.Body?.transformToByteArray()) ?? []);
  } catch {
    throw new ApiError("storage_unavailable");
  }
}

/** Objects are written once and never overwritten; the checksum is of the bytes read back from storage. */
export async function storeOnce(key: string, bytes: Buffer): Promise<string> {
  if (!(await exists(key))) {
    try {
      await client.send(
        new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: bytes, ContentType: "application/pdf" }),
      );
    } catch {
      throw new ApiError("storage_unavailable");
    }
  }
  return sha256(await readObject(key));
}
