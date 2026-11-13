import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { apiError } from "./errors.js";
import { sha256Hex } from "./hash.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
const REQUEST_TIMEOUT_MS = 5000;

const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function location(key: string): { url: URL; canonicalPath: string } {
  const base = new URL(endpoint);
  const encodedKey = key.split("/").map(encode).join("/");
  if (forcePathStyle) {
    const canonicalPath = `/${encode(bucket)}/${encodedKey}`;
    return { url: new URL(canonicalPath, base), canonicalPath };
  }
  const canonicalPath = `/${encodedKey}`;
  const host = new URL(`${base.protocol}//${bucket}.${base.host}`);
  return { url: new URL(canonicalPath, host), canonicalPath };
}

function signingKey(day: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
}

function stamp(now: Date): { amzDate: string; day: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

async function signedRequest(method: "PUT" | "HEAD", key: string, body: Buffer | null, headers: Record<string, string>): Promise<Response> {
  const { url, canonicalPath } = location(key);
  const { amzDate, day } = stamp(new Date());
  const payloadHash = sha256Hex(body ?? "");
  const signed: Record<string, string> = { ...headers, host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signed[name]?.trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const scope = `${day}/${region}/s3/aws4_request`;
  const canonical = [method, canonicalPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const sent = Object.fromEntries(Object.entries(signed).filter(([name]) => name !== "host"));
  return fetch(url, { method, headers: { ...sent, authorization }, body: body && new Uint8Array(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

const imageStoreUnavailable = () => apiError(503, "image_store_unavailable");

async function storeCall(call: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try {
    response = await call();
  } catch {
    throw imageStoreUnavailable();
  }
  if (!response.ok) throw imageStoreUnavailable();
  return response;
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await storeCall(() => signedRequest("PUT", key, bytes, { "content-type": contentType }));
}

export async function statObject(key: string): Promise<{ bytes: number; contentType: string }> {
  const response = await storeCall(() => signedRequest("HEAD", key, null, {}));
  const bytes = Number(response.headers.get("content-length"));
  if (!Number.isInteger(bytes)) throw imageStoreUnavailable();
  return { bytes, contentType: response.headers.get("content-type") ?? "" };
}

// A presigned GET: the only place the S3 endpoint and access key id leave the server.
export function presignGet(key: string): string {
  const { url, canonicalPath } = location(key);
  const { amzDate, day } = stamp(new Date());
  const scope = `${day}/${region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(config.imageUrlTtlSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encode(name)}=${encode(query[name] ?? "")}`)
    .join("&");
  const canonical = ["GET", canonicalPath, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  return `${url.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
