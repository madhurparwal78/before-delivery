// MinIO holds exports and imports. Calls answer 503 when unreachable; the
// app keeps serving.

import { AwsClient } from "aws4fetch";
import { CONFIG } from "./config.js";
import { Errors } from "./errors.js";

const client = new AwsClient({
  accessKeyId: CONFIG.s3.accessKeyId,
  secretAccessKey: CONFIG.s3.secretAccessKey,
  service: "s3",
  region: CONFIG.s3.region,
});

function bucketUrlUnused(): URL {
  if (CONFIG.s3.forcePathStyle) {
    return new URL(`${CONFIG.s3.endpoint}/${CONFIG.s3.bucket}`);
  }
  return new URL(`${CONFIG.s3.endpoint.replace(/^https?:\/\//, (m) => m)}`.replace(CONFIG.s3.endpoint, `${CONFIG.s3.bucket}.${CONFIG.s3.endpoint}`));
}

function objectUrl(key: string): URL {
  const u = new URL(`${CONFIG.s3.endpoint.replace(/\/$/, "")}/${CONFIG.s3.bucket}/${key}`);
  return u;
}

export async function putObject(key: string, bytes: Buffer, contentType = "application/json"): Promise<void> {
  const url = objectUrl(key);
  try {
    const signed = await client.sign(new Request(url, {
      method: "PUT",
      body: new Uint8Array(bytes),
      headers: { "Content-Type": contentType },
    }));
    const res = await fetch(signed);
    if (!res.ok) throw new Error("put failed " + res.status);
    return;
  } catch {
    throw Errors.storageUnavailable();
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const url = objectUrl(key);
  try {
    const signed = await client.sign(new Request(url, { method: "GET" }));
    const res = await fetch(signed);
    if (!res.ok) throw new Error("get failed");
    return Buffer.from(await res.arrayBuffer());
  } catch {
    throw Errors.storageUnavailable();
  }
}

export async function storageHealthy(): Promise<boolean> {
  try {
    const url = objectUrl("");
    const signed = await client.sign(new Request(url, { method: "GET" }));
    const res = await fetch(signed, { signal: AbortSignal.timeout(2000) });
    return res.status === 200 || res.status === 403 || res.status === 404;
  } catch {
    return false;
  }
}
