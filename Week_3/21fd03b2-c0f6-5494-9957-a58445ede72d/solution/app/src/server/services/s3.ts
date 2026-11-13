import { createHash, createHmac } from "node:crypto";
import { config } from "../config";
import { StorageError } from "../errors";

const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
const EMPTY_HASH = createHash("sha256").update("").digest("hex");

const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodePath = (path: string): string => path.split("/").map((part) => encodeURIComponent(part)).join("/");

async function signed(method: string, path: string, body: Uint8Array | null, timeoutMs: number): Promise<Response> {
  const url = new URL(endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = body ? createHash("sha256").update(body).digest("hex") : EMPTY_HASH;
  const canonicalPath = encodePath(path);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [method, canonicalPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    return await fetch(`${endpoint}${canonicalPath}`, { method, headers, body: body ?? undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new StorageError("file storage is unreachable");
  }
}

async function expect(response: Response, ok: number[]): Promise<Response> {
  if (ok.includes(response.status)) return response;
  await response.arrayBuffer().catch(() => undefined);
  throw new StorageError(`file storage answered ${response.status}`);
}

export const s3 = {
  async put(key: string, bytes: Uint8Array): Promise<void> {
    await expect(await signed("PUT", `/${bucket}/${key}`, bytes, 20000), [200]);
  },

  async get(key: string): Promise<Uint8Array | null> {
    const response = await signed("GET", `/${bucket}/${key}`, null, 20000);
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      return null;
    }
    await expect(response, [200]);
    return new Uint8Array(await response.arrayBuffer());
  },

  /** Throws StorageError unless the bucket answers, so callers refuse before recording anything. */
  async ping(): Promise<void> {
    await expect(await signed("HEAD", `/${bucket}`, null, 2000), [200]);
  },

  /** Creates the bucket when it is missing (a fresh instance on its own bucket). */
  async ensureBucket(): Promise<void> {
    const head = await signed("HEAD", `/${bucket}`, null, 3000);
    if (head.status === 200) return;
    if (head.status === 404) await expect(await signed("PUT", `/${bucket}`, null, 5000), [200, 409]);
    else throw new StorageError(`file storage answered ${head.status}`);
  },
};
