// S3-compatible object storage for condition photos, signed with AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { providerFetch } from "./status.js";

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

const encodeKey = (key: string) => key.split("/").map((piece) => encodeURIComponent(piece)).join("/");

function target(key: string): { url: string; host: string; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) {
    const path = `/${config.s3.bucket}${key ? `/${encodeKey(key)}` : ""}`;
    return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
  }
  const host = `${config.s3.bucket}.${endpoint.host}`;
  const path = `/${key ? encodeKey(key) : ""}`;
  return { url: `${endpoint.protocol}//${host}${path}`, host, path };
}

async function signedFetch(method: string, key: string, body: Buffer | null, extra: Record<string, string>): Promise<Response> {
  const { url, host, path } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  for (const [name, value] of Object.entries(extra)) headers[name.toLowerCase()] = value;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]!.trim()}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const piece of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, piece);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  return providerFetch("storage", url, {
    method,
    headers: {
      ...sent,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
    body: body ? new Uint8Array(body) : undefined,
  });
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

export async function putPhotoObject(key: string, data: Buffer, contentType: string, capturedAt: string): Promise<void> {
  await expectOk(await signedFetch("PUT", key, data, { "content-type": contentType, "x-amz-meta-captured-at": capturedAt }), "S3 PUT");
}

export async function getPhotoObject(key: string): Promise<Buffer> {
  const response = await expectOk(await signedFetch("GET", key, null, {}), "S3 GET");
  return Buffer.from(await response.arrayBuffer());
}

export async function deletePhotoObject(key: string): Promise<void> {
  await expectOk(await signedFetch("DELETE", key, null, {}), "S3 DELETE");
}

export async function probeStorage(): Promise<void> {
  await expectOk(await signedFetch("HEAD", "", null, {}), "S3 HEAD bucket");
}
