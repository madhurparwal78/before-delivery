// MinIO over the S3 API with AWS Signature Version 4; one connection per request, so a store that
// comes back is picked up by the next request.
import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { config } from "./config.js";

const TIMEOUT_MS = 6000;

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

interface S3Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function request(method: string, key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const { bucket, region, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const host = forcePathStyle ? endpoint.host : `${bucket}.${endpoint.host}`;
  const path = encodePath(forcePathStyle ? `/${bucket}${key ? `/${key}` : ""}` : `/${key}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  headers["content-length"] = String(body.length);
  const transport = endpoint.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method,
        hostname: forcePathStyle ? endpoint.hostname : `${bucket}.${endpoint.hostname}`,
        port: endpoint.port || undefined,
        path,
        headers,
        agent: false,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("image store timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

export class StoreUnavailable extends Error {}

async function call(method: string, key: string, body?: Buffer, contentType?: string): Promise<S3Response> {
  let res: S3Response;
  try {
    res = await request(method, key, body, contentType);
  } catch (error) {
    throw new StoreUnavailable(String(error));
  }
  if (res.status >= 500) throw new StoreUnavailable(`image store answered ${res.status}`);
  return res;
}

/** Stores the bytes exactly as given; resolves only once the store confirms the write. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await call("PUT", key, body, contentType);
  if (res.status !== 200) throw new StoreUnavailable(`image store refused the write (${res.status})`);
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const res = await call("GET", key);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new StoreUnavailable(`image store refused the read (${res.status})`);
  return { body: res.body, contentType: String(res.headers["content-type"] ?? "application/octet-stream") };
}

export async function deleteObject(key: string): Promise<void> {
  await call("DELETE", key).catch(() => undefined);
}

/** Status probe: the bucket exists and answers. */
export async function probeStore(): Promise<boolean> {
  try {
    return (await request("HEAD", "")).status === 200;
  } catch {
    return false;
  }
}
