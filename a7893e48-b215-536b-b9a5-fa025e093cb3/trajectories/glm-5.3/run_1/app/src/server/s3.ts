import * as Minio from "minio";
import { S3 } from "./config.js";

const m = /^(.*?)(?::(\d+))?$/.exec(S3.endpoint);
const endPoint = m ? m[1] : S3.endpoint;
const port = m && m[2] ? Number(m[2]) : 80;

export const minio = new Minio.Client({
  endPoint,
  port,
  useSSL: false,
  accessKey: S3.accessKey,
  secretKey: S3.secretKey,
  region: S3.region,
});

export async function ensureBucket(): Promise<void> {
  const exists = await minio.bucketExists(S3.bucket);
  if (!exists) await minio.makeBucket(S3.bucket, S3.region);
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  await minio.putObject(S3.bucket, key, data, data.length, { "Content-Type": contentType });
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const stream = await minio.getObject(S3.bucket, key);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}
