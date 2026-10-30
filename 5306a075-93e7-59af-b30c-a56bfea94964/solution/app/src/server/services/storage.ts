// S3-compatible object storage over fetch, signed with AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
const TIMEOUT_MS = 8000;

/** Storage did not answer, or answered with an error: the caller reports 503 or keeps work pending. */
export class StorageUnavailable extends Error {}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function objectUrl(key: string, query: Record<string, string>): URL {
  const base = new URL(endpoint);
  const path = key.split("/").map(encodeSegment).join("/");
  const url = forcePathStyle
    ? new URL(`${base.origin}/${bucket}${key === "" ? "" : `/${path}`}`)
    : new URL(`${base.protocol}//${bucket}.${base.host}/${path}`);
  for (const [name, value] of Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1))) url.searchParams.append(name, value);
  return url;
}

async function request(method: string, key: string, options: { query?: Record<string, string>; body?: Buffer; contentType?: string } = {}): Promise<Response> {
  const url = objectUrl(key, options.query ?? {});
  const body = options.body ?? Buffer.alloc(0);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (options.contentType) headers["content-type"] = options.contentType;
  const signedNames = Object.keys(headers).sort();
  const canonicalQuery = [...url.searchParams].map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`).join("&");
  const canonical = [method, url.pathname, canonicalQuery, signedNames.map((n) => `${n}:${headers[n]}\n`).join(""), signedNames.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
  delete headers.host;
  try {
    return await fetch(url, { method, headers, body: method === "PUT" ? body : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new StorageUnavailable(error instanceof Error ? error.message : String(error));
  }
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new StorageUnavailable(`${what}: storage answered ${response.status} ${await response.text()}`);
  return response;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await request("PUT", key, { body, contentType }), `PUT ${key}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await expectOk(await request("GET", key), `GET ${key}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await request("DELETE", key);
  if (!response.ok && response.status !== 404) await expectOk(response, `DELETE ${key}`);
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const xml = await (await expectOk(await request("GET", "", { query }), `LIST ${prefix}`)).text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push((match[1] ?? "").replace(/&(\w+);/g, (_, name: string) => XML_ENTITIES[name] ?? `&${name};`));
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null : null;
  } while (token);
  return keys;
}
