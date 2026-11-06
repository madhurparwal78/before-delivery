import * as Minio from "minio";
import { config } from "./config.js";

const endpointUrl = new URL(config.s3.endpoint);
const client = new Minio.Client({
  endPoint: endpointUrl.hostname,
  port: endpointUrl.port ? Number(endpointUrl.port) : endpointUrl.protocol === "https:" ? 443 : 80,
  useSSL: endpointUrl.protocol === "https:",
  region: config.s3.region,
  accessKey: config.s3.accessKeyId,
  secretKey: config.s3.secretAccessKey,
});

const bucket = () => config.s3.bucket;

export const ensureBucket = async (): Promise<void> => {
  try {
    const exists = await client.bucketExists(bucket());
    if (!exists) await client.makeBucket(bucket(), config.s3.region);
  } catch {
    // MinIO being down never blocks boot; the next operation retries fresh.
  }
};

export type PutOutcome = { kind: "ok" } | { kind: "unavailable" };

export const putObject = async (
  objectKey: string,
  content: Buffer,
  contentType: string,
): Promise<PutOutcome> => {
  try {
    await client.putObject(bucket(), objectKey, content, content.length, { "Content-Type": contentType });
    return { kind: "ok" };
  } catch {
    return { kind: "unavailable" };
  }
};

export const signedUrl = async (objectKey: string): Promise<string | null> => {
  try {
    return await client.presignedGetObject(bucket(), objectKey, 60);
  } catch {
    return null;
  }
};

export const objectExists = async (objectKey: string): Promise<boolean> => {
  try {
    await client.statObject(bucket(), objectKey);
    return true;
  } catch {
    return false;
  }
};
