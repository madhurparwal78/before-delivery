import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { notFound, storageUnavailable } from "./errors.js";

const client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 2000, requestTimeout: 15000 },
});

const Bucket = config.s3.bucket;
let reachable = false;

export const storageReachable = (): boolean => reachable;

export async function checkStorage(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(2500) });
    reachable = true;
  } catch {
    reachable = false;
  }
  return reachable;
}

export function watchStorage(): void {
  setInterval(() => void checkStorage(), 4000).unref();
}

/** Only a failure to reach storage marks it unreachable; a missing object is just a missing object. */
const isMissing = (error: unknown): boolean => error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound");

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  if (!reachable) throw storageUnavailable();
  try {
    return await work();
  } catch (error) {
    if (isMissing(error)) throw notFound();
    reachable = false;
    throw storageUnavailable();
  }
}

interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
}

export async function putObjects(objects: StoredObject[]): Promise<void> {
  await guarded(async () => {
    await Promise.all(
      objects.map((object) =>
        client.send(new PutObjectCommand({ Bucket, Key: object.key, Body: object.body, ContentType: object.contentType })),
      ),
    );
  });
}

export async function getObject(key: string): Promise<Buffer> {
  return guarded(async () => {
    const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
    if (!response.Body) throw new Error("empty object");
    return Buffer.from(await response.Body.transformToByteArray());
  });
}

/** Removes every object under a prefix. Failures are left for the next sweep. */
export async function deletePrefix(prefix: string): Promise<boolean> {
  try {
    const listed = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }));
    const keys = (listed.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
    if (keys.length > 0) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
    return true;
  } catch {
    return false;
  }
}
