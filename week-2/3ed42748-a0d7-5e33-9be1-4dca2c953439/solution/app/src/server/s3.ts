// A small S3 client (Signature V4) for the postcard store: put, get, delete, list and a bucket probe.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";

const TIMEOUT_MS = 4000;

const hash = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Thrown when the store cannot be reached or fails; its text never leaves the server. */
class StoreUnavailable extends Error {}

interface Request {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  key?: string;
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
}

async function call(req: Request): Promise<Response> {
  const endpoint = new URL(config.s3.endpoint);
  const { bucket, region } = config.s3;
  const keyPath = req.key ? `/${req.key.split("/").map(encode).join("/")}` : "";
  const host = config.s3.forcePathStyle ? endpoint.host : `${bucket}.${endpoint.host}`;
  const path = config.s3.forcePathStyle ? `/${encode(bucket)}${keyPath}` : keyPath || "/";
  const query = Object.entries(req.query ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join("&");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = hash(req.body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonical = [
    req.method,
    path,
    query,
    Object.keys(headers)
      .sort()
      .map((k) => `${k}:${headers[k]}\n`)
      .join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonical)}`;
  let key: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const outgoing: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (req.contentType) outgoing["content-type"] = req.contentType;
  const url = `${endpoint.protocol}//${host}${path}${query ? `?${query}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: req.method,
      headers: outgoing,
      body: req.body ? new Uint8Array(req.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StoreUnavailable("unreachable");
  }
  if (response.status >= 500) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StoreUnavailable("failing");
  }
  return response;
}

async function expectOk(response: Response): Promise<Buffer> {
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new StoreUnavailable(`status ${response.status}`);
  return body;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await call({ method: "PUT", key, body, contentType }));
}

/** The object's bytes, or null when the store has no such object. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await call({ method: "GET", key });
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  return expectOk(response);
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call({ method: "DELETE", key });
  if (response.status === 404) return void (await response.arrayBuffer());
  await expectOk(response);
}

export async function listObjects(prefix: string): Promise<Array<{ key: string; modified: number }>> {
  const out: Array<{ key: string; modified: number }> = [];
  let token: string | null = null;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const xml = (await expectOk(await call({ method: "GET", query }))).toString("utf8");
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]!)?.[1];
      const modified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(m[1]!)?.[1];
      if (key && modified) out.push({ key, modified: Date.parse(modified) });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null)
      : null;
  } while (token);
  return out;
}

export async function probeBucket(): Promise<void> {
  await expectOk(await call({ method: "HEAD" }));
}
