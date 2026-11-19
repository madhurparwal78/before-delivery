import { createHash, createHmac } from "node:crypto";
import { settings } from "./config";
import { ApiError } from "./errors";

const TIMEOUT_MS = 5000;

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** A signed (AWS Signature Version 4) request to the object store; any failure to reach or use it is "storage unavailable". */
async function request(method: "PUT" | "HEAD" | "GET", key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = settings.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = `${forcePathStyle ? `/${encodeSegment(bucket)}` : ""}/${key.split("/").map(encodeSegment).join("/")}`;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [method, path, "", `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const headers: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) headers["content-type"] = contentType;
  try {
    const response = await fetch(`${base.protocol}//${host}${path}`, { method, headers, body: method === "PUT" ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`object store answered ${response.status}`);
    return response;
  } catch {
    throw new ApiError(503, "storage_unavailable");
  }
}

export async function storeObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await request("PUT", key, body, contentType);
  await request("HEAD", key);
}

export async function fetchObject(key: string): Promise<Response> {
  return request("GET", key);
}
