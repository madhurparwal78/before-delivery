import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { fail } from "./errors";

const TIMEOUT_MS = 30_000;

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface Target {
  url: URL;
  canonicalPath: string;
}

function target(key: string, query: Record<string, string>): Target {
  const base = new URL(config.s3.endpoint);
  const bucketPath = config.s3.forcePathStyle ? `/${config.s3.bucket}` : "";
  if (!config.s3.forcePathStyle) base.hostname = `${config.s3.bucket}.${base.hostname}`;
  const path = `${bucketPath}${key ? `/${key.split("/").map(encode).join("/")}` : "/"}`;
  const canonicalPath = path === "" ? "/" : path;
  const url = new URL(base.origin + canonicalPath);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return { url, canonicalPath };
}

async function signedRequest(method: string, key: string, query: Record<string, string>, body: Buffer, contentType?: string): Promise<Response> {
  const { url, canonicalPath } = target(key, query);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [method, canonicalPath, canonicalQuery, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    return await fetch(url, {
      method,
      headers,
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return fail("storage_unavailable");
  }
}

async function expect(response: Response, ...accepted: number[]): Promise<Response> {
  if (!accepted.includes(response.status)) {
    await response.arrayBuffer().catch(() => undefined);
    return fail("storage_unavailable");
  }
  return response;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await expect(await signedRequest("PUT", key, {}, body, contentType), 200);
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const response = await expect(await signedRequest("GET", key, {}, Buffer.alloc(0)), 200, 404);
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await expect(await signedRequest("DELETE", key, {}, Buffer.alloc(0)), 204, 200, 404);
  await response.arrayBuffer();
}

export async function listObjects(prefix: string): Promise<string[]> {
  const found: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const response = await expect(await signedRequest("GET", "", query, Buffer.alloc(0)), 200);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) found.push(unescapeXml(match[1] ?? ""));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
  } while (token);
  return found;
}

const unescapeXml = (text: string): string =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export const photoKey = (reference: string, index: number): string => `claims/${reference}/photos/${index}`;
export const dispatchNoteKey = (reference: string): string => `claims/${reference}/dispatch-note.html`;
const claimPrefix = (reference: string): string => `claims/${reference}/`;

/** Removes every object under a claim's prefix; used both to undo a failed start and to erase an owner. */
export async function deleteClaimObjects(reference: string): Promise<void> {
  for (const key of await listObjects(claimPrefix(reference))) await deleteObject(key);
}
