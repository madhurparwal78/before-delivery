// Object storage (S3-compatible MinIO). The browser never talks to storage.

import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DependencyError, requireEnv, optionalEnv } from "./deps.js";

let client: S3Client | null = null;
let bucket: string | null = null;

function s3(): { client: S3Client; bucket: string } {
  if (!client || !bucket) {
    const endpoint = requireEnv("S3_ENDPOINT");
    const region = optionalEnv("S3_REGION") ?? "us-east-1";
    const forcePathStyle = (optionalEnv("S3_FORCE_PATH_STYLE") ?? "true") === "true";
    const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");
    client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: { requestTimeout: 3000 },
    });
    bucket = requireEnv("S3_BUCKET");
  }
  return { client, bucket };
}

export function objectKey(missionId: string, passId: string): string {
  return `captures/${missionId}/${passId}.cap`;
}

export async function putCapture(
  missionId: string,
  passId: string,
  bytes: Buffer,
): Promise<void> {
  const { client: c, bucket: b } = s3();
  try {
    await c.send(
      new PutObjectCommand({
        Bucket: b,
        Key: objectKey(missionId, passId),
        Body: bytes,
        ContentType: "application/octet-stream",
      }),
    );
  } catch (err) {
    throw new DependencyError("storage");
  }
}

export async function getCapture(missionId: string, passId: string): Promise<Buffer> {
  const { client: c, bucket: b } = s3();
  try {
    const result = await c.send(
      new GetObjectCommand({ Bucket: b, Key: objectKey(missionId, passId) }),
    );
    const body = result.Body;
    if (!body) throw new DependencyError("storage");
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err instanceof DependencyError) throw err;
    throw new DependencyError("storage");
  }
}

export async function headCapture(missionId: string, passId: string): Promise<boolean> {
  const { client: c, bucket: b } = s3();
  try {
    await c.send(new HeadObjectCommand({ Bucket: b, Key: objectKey(missionId, passId) }));
    return true;
  } catch {
    throw new DependencyError("storage");
  }
}

export async function deleteCapture(missionId: string, passId: string): Promise<void> {
  const { client: c, bucket: b } = s3();
  try {
    await c.send(new DeleteObjectCommand({ Bucket: b, Key: objectKey(missionId, passId) }));
  } catch {
    throw new DependencyError("storage");
  }
}

export async function probeStorage(): Promise<boolean> {
  try {
    const { client: c, bucket: b } = s3();
    await c.send(new HeadObjectCommand({ Bucket: b, Key: "perilune/healthprobe" }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") return true;
    // Any answer means the service is up.
    const code = (err as { $$metadata?: { httpStatusCode?: number } }).$$metadata?.httpStatusCode;
    if (code !== undefined) return true;
    return false;
  }
}
