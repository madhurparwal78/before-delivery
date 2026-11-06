// MinIO over the S3 REST API with AWS Signature V4 (node:crypto + fetch).
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";

export class StorageUnavailable extends Error {}

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
const base = new URL(endpoint);
const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
const pathPrefix = forcePathStyle ? `/${bucket}` : "";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
const encode = (part: string) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface S3Request {
  method: "GET" | "PUT" | "DELETE";
  key?: string;
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
}

async function send({ method, key, query = {}, body = Buffer.alloc(0), contentType }: S3Request): Promise<Response> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const path = `${pathPrefix}/${key ? key.split("/").map(encode).join("/") : ""}`;
  const canonicalQuery = Object.keys(query).sort().map((k) => `${encode(k)}=${encode(query[k])}`).join("&");
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const signedNames = Object.keys(headers).sort();
  const canonical = [method, path, canonicalQuery, signedNames.map((n) => `${n}:${headers[n]}\n`).join(""),
    signedNames.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey: Buffer = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  sent.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
  const url = `${base.protocol}//${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, { method, headers: sent, body: method === "PUT" ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new StorageUnavailable("storage unreachable");
  }
  if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`);
  return response;
}

async function expectOk(response: Response, action: string): Promise<void> {
  if (!response.ok) throw new StorageUnavailable(`${action} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await send({ method: "PUT", key, body, contentType }), `put ${key}`);
}

/** The object's bytes, or null when there is no such object. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send({ method: "GET", key });
  if (response.status === 404) return null;
  await expectOk(response, `get ${key}`);
  return Buffer.from(await response.arrayBuffer());
}

async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: "DELETE", key });
  if (response.status !== 404) await expectOk(response, `delete ${key}`);
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const response = await send({ method: "GET", query });
    await expectOk(response, `list ${prefix}`);
    const xml = await response.text();
    keys.push(...[...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => decodeXml(m[1])));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(/<NextContinuationToken>([^<]*)</.exec(xml)?.[1] ?? "") : null;
  } while (token);
  return keys;
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** Deletes everything under a prefix, then lists it again; the count removed. Throws if anything remains. */
export async function clearPrefix(prefix: string): Promise<number> {
  const keys = await listKeys(prefix);
  for (let i = 0; i < keys.length; i += 16) await Promise.all(keys.slice(i, i + 16).map(deleteObject));
  if ((await listKeys(prefix)).length > 0) throw new StorageUnavailable(`${prefix} is not empty after delete`);
  return keys.length;
}
