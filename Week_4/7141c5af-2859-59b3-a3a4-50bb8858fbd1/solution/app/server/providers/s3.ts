import { createHash, createHmac } from "node:crypto";
import { config } from "../config.ts";
import { call, ProviderDown } from "./call.ts";

const EMPTY_HASH = createHash("sha256").update("").digest("hex");

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, text: string): Buffer {
  return createHmac("sha256", key).update(text).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function address(path: string, search: string): URL {
  const base = new URL(config.s3.endpoint);
  if (!config.s3.forcePathStyle) base.hostname = `${config.s3.bucket}.${base.hostname}`;
  const prefix = config.s3.forcePathStyle ? `/${config.s3.bucket}` : "";
  return new URL(`${base.origin}${prefix}${path}${search}`);
}

/** One SigV4-signed request. */
function signed(method: string, url: URL, body?: Buffer, type?: string): Promise<Response> {
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payload = body ? sha256(body) : EMPTY_HASH;
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payload, "x-amz-date": stamp };
  const names = Object.keys(headers).sort();
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonical = [method, url.pathname, query, names.map((name) => `${name}:${headers[name]}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const key = [day, config.s3.region, "s3", "aws4_request"].reduce<Buffer | string>((secret, part) => hmac(secret, part), `AWS4${config.s3.secretAccessKey}`);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  return call(url.toString(), {
    method,
    headers: {
      ...sent,
      ...(type ? { "Content-Type": type } : {}),
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
    ...(body ? { body: new Uint8Array(body) } : {}),
  });
}

let bucketReady = false;

/** Makes the bucket if it is missing. Called lazily, so the app starts with the store down. */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const made = await signed("PUT", address("", ""));
  if (!made.ok && made.status !== 409) throw new ProviderDown(`bucket answered ${made.status}`);
  bucketReady = true;
}

export async function putObject(key: string, bytes: Buffer, type: string): Promise<void> {
  await ensureBucket();
  const answer = await signed("PUT", address(`/${encodeKey(key)}`, ""), bytes, type);
  if (!answer.ok) throw new ProviderDown(`put answered ${answer.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const answer = await signed("GET", address(`/${encodeKey(key)}`, ""));
  if (!answer.ok) throw new ProviderDown(`get answered ${answer.status}`);
  return Buffer.from(await answer.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const answer = await signed("DELETE", address(`/${encodeKey(key)}`, ""));
  if (!answer.ok) throw new ProviderDown(`delete answered ${answer.status}`);
}

export async function listKeys(prefix: string): Promise<string[]> {
  await ensureBucket();
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const search = new URLSearchParams({ "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) });
    const answer = await signed("GET", address("", `?${search}`));
    if (!answer.ok) throw new ProviderDown(`list answered ${answer.status}`);
    const text = await answer.text();
    keys.push(...[...text.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1] as string));
    token = /<NextContinuationToken>([^<]*)</.exec(text)?.[1] ?? null;
  } while (token);
  return keys;
}
