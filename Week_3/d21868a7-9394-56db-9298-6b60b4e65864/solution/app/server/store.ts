// The evidence store: a minimal S3 client (AWS Signature Version 4) for the one private bucket.
import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { config } from "./config.ts";

const TIMEOUT_MS = 5000;

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

function objectUrl(key: string): URL {
  const { endpoint, bucket, forcePathStyle } = config.store;
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (forcePathStyle) return new URL(key ? `${endpoint}/${bucket}/${path}` : `${endpoint}/${bucket}`);
  const base = new URL(endpoint);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${path}`);
}

interface StoreReply {
  status: number;
  body: Buffer;
}

// node:http rather than fetch: fetch refuses the ports on the Fetch standard's blocked list, and the
// store must be reached at whatever S3_ENDPOINT names.
function send(url: URL, method: string, headers: Record<string, string>, body?: Buffer): Promise<StoreReply> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method, headers, timeout: TIMEOUT_MS }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks) }));
      incoming.on("error", reject);
    });
    outgoing.on("timeout", () => outgoing.destroy(new Error("store timed out")));
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function signedRequest(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<StoreReply> {
  const { region, accessKeyId, secretAccessKey } = config.store;
  const url = objectUrl(key);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return send(url, method, {
    ...headers,
    "content-length": String(body?.length ?? 0),
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  }, body);
}

const ok = (reply: StoreReply) => reply.status >= 200 && reply.status < 300;

/** Creates the configured bucket; an outage copy has none until its store first answers. */
async function createBucket(): Promise<void> {
  const reply = await signedRequest("PUT", "");
  if (!ok(reply) && !reply.body.toString().includes("BucketAlreadyOwnedByYou")) throw new Error(`store refused bucket: ${reply.status}`);
}

/** Resolves once the store confirmed the write; rejects when it is unreachable or refuses. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let reply = await signedRequest("PUT", key, body, contentType);
  if (reply.status === 404 && reply.body.toString().includes("NoSuchBucket")) {
    await createBucket();
    reply = await signedRequest("PUT", key, body, contentType);
  }
  if (!ok(reply)) throw new Error(`store refused ${key}: ${reply.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const reply = await signedRequest("GET", key);
  if (!ok(reply)) throw new Error(`store refused ${key}: ${reply.status}`);
  return reply.body;
}

export async function deleteObject(key: string): Promise<void> {
  const reply = await signedRequest("DELETE", key);
  if (!ok(reply) && reply.status !== 404) throw new Error(`store refused delete ${key}: ${reply.status}`);
}
