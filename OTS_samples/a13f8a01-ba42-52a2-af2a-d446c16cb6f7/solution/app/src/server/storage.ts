import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import http from "node:http";
import https from "node:https";
import { config } from "./config.js";
import { StorageUnavailable } from "./errors.js";

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  maxAttempts: 1,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  requestHandler: {
    connectionTimeout: 2000,
    requestTimeout: 10000,
    httpAgent: new http.Agent({ keepAlive: false }),
    httpsAgent: new https.Agent({ keepAlive: false }),
  },
});

const bucket = config.s3.bucket;

async function attempt<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

export function putObject(key: string, body: string | Buffer, contentType: string): Promise<void> {
  return attempt(async () => {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  });
}

export function getObject(key: string): Promise<Buffer> {
  return attempt(async () => {
    const answer = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!answer.Body) throw new Error(`object ${key} has no body`);
    return Buffer.from(await answer.Body.transformToByteArray());
  });
}

export function hasObject(key: string): Promise<boolean> {
  return attempt(async () => {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "NotFound") return false;
      throw error;
    }
  });
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export function deletePrefix(prefix: string): Promise<void> {
  return attempt(async () => {
    const keys = await listKeys(prefix);
    for (let start = 0; start < keys.length; start += 1000) {
      const batch = keys.slice(start, start + 1000).map((Key) => ({ Key }));
      const answer = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }));
      if (answer.Errors?.length) throw new Error(`could not delete ${answer.Errors.length} objects under ${prefix}`);
    }
  });
}

export async function storageAnswers(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}
