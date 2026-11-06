// MinIO through the S3 API, signed with AWS Signature Version 4 from the configured credentials.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

export class StorageUnreachable extends Error {}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { url: string; host: string; canonicalUri: string } {
  const endpoint = new URL(config.s3.endpoint);
  const keyPath = key.split("/").map(encodeSegment).join("/");
  if (config.s3.forcePathStyle) {
    const canonicalUri = `/${encodeSegment(config.s3.bucket)}${key ? `/${keyPath}` : ""}`;
    return { url: `${endpoint.origin}${canonicalUri}`, host: endpoint.host, canonicalUri };
  }
  const host = `${config.s3.bucket}.${endpoint.host}`;
  const canonicalUri = `/${keyPath}`;
  return { url: `${endpoint.protocol}//${host}${canonicalUri}`, host, canonicalUri };
}

async function send(method: string, key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const { url, host, canonicalUri } = target(key);
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, canonicalUri, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers.host;
  try {
    return await fetch(url, { method, headers, body: method === "PUT" ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(8000) });
  } catch (error) {
    throw new StorageUnreachable(`S3 ${method} ${key}: ${String(error)}`);
  }
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new StorageUnreachable(`${what}: HTTP ${response.status} ${await response.text()}`);
  return response;
}

export const storage = {
  async ensureBucket(): Promise<void> {
    const head = await send("HEAD", "");
    if (head.status === 404) await expectOk(await send("PUT", ""), "create bucket");
    else await expectOk(head, "head bucket");
  },
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await expectOk(await send("PUT", key, body, contentType), `put ${key}`);
  },
  async get(key: string): Promise<Buffer> {
    const response = await expectOk(await send("GET", key), `get ${key}`);
    return Buffer.from(await response.arrayBuffer());
  },
  async remove(key: string): Promise<void> {
    const response = await send("DELETE", key);
    if (response.status !== 404) await expectOk(response, `delete ${key}`);
  },
};
