// Minimal S3 client for the evidence store (AWS SigV4, path-style or virtual),
// used for stroke records and pack objects. Only the bucket named in S3_BUCKET
// is ever addressed.
import { createHash, createHmac, createSign } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export type S3Result = { status: number; body: Buffer; headers: Record<string, string> };

export async function s3Request(
  cfg: S3Config,
  method: "GET" | "PUT" | "DELETE" | "HEAD" | "POST",
  key: string | null,
  body: Buffer,
  contentType?: string,
): Promise<S3Result> {
  const url = new URL(cfg.endpoint);
  const isHttps = url.protocol === "https:";
  const path = key === null ? `/${cfg.bucket}/` : `/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const host = url.host;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  if (body.length > 0 && method !== "DELETE") headers["content-length"] = String(body.length);

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h}:${headers[h]!.trim()}\n`)
    .join("");

  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const doRequest = isHttps ? httpsRequest : httpRequest;
  return new Promise<S3Result>((resolve, reject) => {
    const req = doRequest(
      {
        host: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        method,
        path,
        headers,
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const h: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) h[k] = Array.isArray(v) ? v.join(",") : String(v);
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: h });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
    if (body.length > 0) req.write(body);
    req.end();
  });
}

export async function s3EnsureBucket(cfg: S3Config): Promise<void> {
  const res = await s3Request(cfg, "HEAD", null, Buffer.alloc(0));
  if (res.status === 200) return;
  // create exactly this bucket (S3 v2 style; MinIO accepts a plain PUT)
  const put = await s3Request(cfg, "PUT", null, Buffer.alloc(0));
  if (put.status !== 200 && put.status !== 201 && put.status !== 409) {
    throw new Error(`bucket create failed: ${put.status}`);
  }
}

export async function s3Put(cfg: S3Config, key: string, body: Buffer, contentType: string): Promise<boolean> {
  try {
    const res = await s3Request(cfg, "PUT", key, body, contentType);
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function s3Get(cfg: S3Config, key: string): Promise<Buffer | null> {
  try {
    const res = await s3Request(cfg, "GET", key, Buffer.alloc(0));
    if (res.status === 200) return res.body;
    return null;
  } catch {
    return null;
  }
}

export async function s3Delete(cfg: S3Config, key: string): Promise<boolean> {
  try {
    const res = await s3Request(cfg, "DELETE", key, Buffer.alloc(0));
    return res.status === 204 || res.status === 200 || res.status === 404;
  } catch {
    return false;
  }
}
