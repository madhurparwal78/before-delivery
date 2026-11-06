// MinIO holds every object byte, in the bucket named by S3_BUCKET:
//   regions/<region id>/<bucket name>/<version id>   a version's copy in one region
//   uploads/<upload id>/<part number>                 a staged multipart part
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { config } from "./config.js";
import { etagFromDigests } from "./integrity.js";
import { amzDate, canonicalQuery, credentialScope, canonicalRequest, EMPTY_SHA256, hmac, signingKey, stringToSign, uriEncode } from "./sigv4.js";

export class StorageUnavailable extends Error {}
class StorageMissing extends Error {}

export const regionObjectKey = (region: string, bucket: string, versionId: string): string =>
  `regions/${region}/${bucket}/${versionId}`;
export const partObjectKey = (uploadId: string, partNumber: number): string => `uploads/${uploadId}/${partNumber}`;

const endpoint = new URL(config.s3.endpoint);

async function send(method: string, key: string, options: {
  query?: Array<[string, string]>; body?: Buffer; headers?: Record<string, string>;
} = {}): Promise<Response> {
  const now = new Date();
  const date = amzDate(now);
  const day = date.slice(0, 8);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${uriEncode(key, true)}`
    : `/${uriEncode(key, true)}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const payloadHash = options.body ? createHash("sha256").update(options.body).digest("hex") : EMPTY_SHA256;
  const headers: Record<string, string> = {
    ...options.headers,
    host,
    "x-amz-date": date,
    "x-amz-content-sha256": payloadHash,
  };
  const query = canonicalQuery(options.query ?? []);
  const scope = credentialScope(day, config.s3.region, "s3");
  const canonical = canonicalRequest({ method, path, query, headers: Object.entries(headers), payloadHash });
  const signature = hmac(signingKey(config.s3.secretAccessKey, day, config.s3.region, "s3"),
    stringToSign(date, scope, canonical)).toString("hex");
  const signed = Object.keys(headers).sort().join(";");
  const { host: _host, ...sent } = headers;
  const url = `${endpoint.protocol}//${host}${path}${query ? `?${query}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
      },
      ...(options.body ? { body: new Uint8Array(options.body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new StorageUnavailable(error instanceof Error ? error.message : "storage request failed");
  }
  if (response.status >= 500) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailable(`storage answered ${response.status}`);
  }
  return response;
}

async function expectOk(response: Response, what: string): Promise<string> {
  const text = await response.text();
  if (response.status === 404) throw new StorageMissing(what);
  if (response.status >= 300) throw new Error(`${what}: storage answered ${response.status} ${text.slice(0, 200)}`);
  return text;
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  await expectOk(await send("PUT", key, { body, headers: { "content-length": String(body.length) } }), `put ${key}`);
}

export async function getObject(key: string): Promise<Readable> {
  const response = await send("GET", key);
  if (response.status !== 200 || !response.body) {
    await expectOk(response, `get ${key}`);
    throw new Error(`get ${key}: empty body`);
  }
  return Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (response.status !== 404) await expectOk(response, `delete ${key}`);
  else await response.arrayBuffer();
}

export async function copyObject(source: string, target: string): Promise<void> {
  const copySource = `/${config.s3.bucket}/${uriEncode(source, true)}`;
  const text = await expectOk(await send("PUT", target, { headers: { "x-amz-copy-source": copySource } }), `copy ${source}`);
  if (text.includes("<Error>")) throw new Error(`copy ${source}: ${text.slice(0, 200)}`);
}

function xmlValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  if (!match?.[1]) throw new Error(`storage response without ${tag}`);
  return match[1];
}

// Assembles staged parts into one object without passing the bytes through this process.
export async function assembleParts(target: string, sources: string[]): Promise<void> {
  const created = await expectOk(await send("POST", target, { query: [["uploads", ""]] }), `create ${target}`);
  const uploadId = xmlValue(created, "UploadId");
  try {
    const parts: string[] = [];
    for (const [index, source] of sources.entries()) {
      const copied = await expectOk(await send("PUT", target, {
        query: [["partNumber", String(index + 1)], ["uploadId", uploadId]],
        headers: { "x-amz-copy-source": `/${config.s3.bucket}/${uriEncode(source, true)}` },
      }), `copy part ${source}`);
      parts.push(`<Part><PartNumber>${index + 1}</PartNumber><ETag>${xmlValue(copied, "ETag")}</ETag></Part>`);
    }
    const body = Buffer.from(`<CompleteMultipartUpload>${parts.join("")}</CompleteMultipartUpload>`);
    const done = await expectOk(await send("POST", target, { query: [["uploadId", uploadId]], body }), `complete ${target}`);
    if (done.includes("<Error>")) throw new Error(`complete ${target}: ${done.slice(0, 200)}`);
  } catch (error) {
    await send("DELETE", target, { query: [["uploadId", uploadId]] }).then((r) => r.arrayBuffer()).catch(() => undefined);
    throw error;
  }
}

// Recomputes the plaintext size and ETag of a decrypted copy: the MD5 of the bytes, or for a multipart
// version the MD5 of the part MD5s over the recorded part sizes.
export async function measurePlaintext(stream: AsyncIterable<Buffer>, partSizes: number[] | null): Promise<{ size: number; etag: string }> {
  let size = 0;
  const whole = createHash("md5");
  const partDigests: Buffer[] = [];
  let part = createHash("md5");
  let partIndex = 0;
  let partLeft = partSizes?.[0] ?? 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (!partSizes) {
      whole.update(chunk);
      continue;
    }
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(partLeft, chunk.length - offset);
      part.update(chunk.subarray(offset, offset + take));
      offset += take;
      partLeft -= take;
      if (partLeft === 0) {
        partDigests.push(part.digest());
        part = createHash("md5");
        partIndex += 1;
        partLeft = partSizes[partIndex] ?? Number.POSITIVE_INFINITY;
      }
    }
  }
  return { size, etag: etagFromDigests(partSizes ? partDigests : whole.digest()) };
}
