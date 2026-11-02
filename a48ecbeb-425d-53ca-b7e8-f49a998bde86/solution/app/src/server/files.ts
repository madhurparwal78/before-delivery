import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { filesUnavailable } from "./http.js";

// MinIO over the S3 API with AWS Signature V4. Objects are written once and served only via the app.

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function objectUrl(key: string): URL {
  const endpoint = new URL(config.s3.endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (config.s3.forcePathStyle) return new URL(`${endpoint.origin}/${config.s3.bucket}${key ? `/${path}` : ""}`);
  return new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}/${path}`);
}

async function signed(method: string, url: URL, body: Buffer = Buffer.alloc(0), extra: Record<string, string> = {}): Promise<Response> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    [...url.searchParams.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&"),
    names.map((n) => `${n}:${headers[n].trim()}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  let key: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const sent: Record<string, string> = { ...headers };
  delete sent.host;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, Authorization: authorization },
      body: method === "PUT" ? body : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw filesUnavailable();
  }
}

/** Writes an object once; an object that already exists is left as it is. */
export async function putObject(key: string, body: Buffer, type: string): Promise<void> {
  const response = await signed("PUT", objectUrl(key), body, { "content-type": type, "if-none-match": "*" });
  await response.arrayBuffer();
  if (response.status === 412) return;
  if (response.status !== 200) throw filesUnavailable();
}

export async function getObject(key: string): Promise<{ body: Buffer; type: string }> {
  const response = await signed("GET", objectUrl(key));
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200) throw filesUnavailable();
  return { body, type: response.headers.get("content-type") ?? "application/octet-stream" };
}

export async function probeFiles(): Promise<boolean> {
  try {
    const response = await signed("HEAD", objectUrl(""));
    return response.status === 200;
  } catch {
    return false;
  }
}
