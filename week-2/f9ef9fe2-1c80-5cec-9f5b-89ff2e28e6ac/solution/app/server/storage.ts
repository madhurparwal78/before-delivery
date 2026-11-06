import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { reach } from "./services.js";

// Private object storage over the S3 API, signed with AWS Signature Version 4. Files are read by
// the server and streamed to the allowed reader; nothing is public or presigned.

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodePath = (key: string): string => key.split("/").map(encodeURIComponent).join("/");

class StorageError extends Error {}

function objectUrl(key: string): URL {
  const endpoint = new URL(config.storage.endpoint);
  const bucket = config.storage.bucket;
  if (config.storage.forcePathStyle) {
    return new URL(`${endpoint.origin}/${bucket}${key ? `/${encodePath(key)}` : ""}`);
  }
  return new URL(`${endpoint.protocol}//${bucket}.${endpoint.host}${key ? `/${encodePath(key)}` : "/"}`);
}

async function signedFetch(method: "GET" | "PUT" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = objectUrl(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(contentType ? { "content-type": contentType } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.storage.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.storage.secretAccessKey}`, day);
  for (const part of [config.storage.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _, ...sent } = headers;
  return fetch(url, {
    method,
    headers: {
      ...sent,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
}

export async function probe(): Promise<void> {
  const response = await signedFetch("HEAD", "");
  if (!response.ok) throw new StorageError(`bucket check ${response.status}`);
}

export async function putFile(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await reach("files", async () => {
    const response = await signedFetch("PUT", key, bytes, contentType);
    if (!response.ok) throw new StorageError(`put ${response.status}`);
  });
}

export async function getFile(key: string): Promise<Buffer> {
  return reach("files", async () => {
    const response = await signedFetch("GET", key);
    if (!response.ok) throw new StorageError(`get ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  });
}
