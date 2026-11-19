/**
 * Minimal S3 client over AWS Signature V4. Only the four calls the site needs:
 * create the bucket if missing, put an object, head an object, delete an object.
 * Nothing here is ever sent to the browser.
 */
import { createHash, createHmac } from "node:crypto";
import { request, type ClientRequest, type IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

export type S3Object = { body: Buffer; contentType: string };

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalUri(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

export function s3Url(config: S3Config, key: string): URL {
  const base = new URL(config.endpoint);
  if (config.forcePathStyle) {
    const suffix = key ? `/${key}` : "";
    base.pathname = `/${config.bucket}${suffix}`;
  } else {
    base.host = `${config.bucket}.${base.host}`;
    base.pathname = `/${key}`;
  }
  return base;
}

type S3Result = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

function call(
  config: S3Config,
  method: string,
  key: string,
  body: Buffer | null,
  contentType: string | null,
  query = ""
): Promise<S3Result> {
  const url = s3Url(config, key);
  if (query) url.search = query;
  const host = url.host;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, "")}`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const objectPath = key ? `${config.bucket}/${key}` : config.bucket;
  const uri = config.forcePathStyle
    ? `/${canonicalUri(objectPath)}`
    : `/${canonicalUri(key)}`;
  const canonicalQuery = query
    ? query
        .split("&")
        .sort()
        .map((part) => {
          const [name, value = ""] = part.split("=");
          return `${encodeRfc3986(name)}=${encodeRfc3986(value)}`;
        })
        .join("&")
    : "";

  const headerEntries: [string, string][] = [
    ["host", host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  if (contentType) headerEntries.push(["content-type", contentType]);
  headerEntries.sort(([a], [b]) => (a < b ? -1 : 1));
  const signedHeaders = headerEntries.map(([name]) => name).join(";");
  const canonicalHeaders = headerEntries.map(([name, value]) => `${name}:${value}\n`).join("");

  const canonicalRequest = [
    method,
    uri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest, "utf8")),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = Object.fromEntries(headerEntries);
  headers.Authorization = authorization;
  if (body) headers["content-length"] = String(body.length);
  return new Promise((resolve, reject) => {
    const req: ClientRequest = request(
      url,
      { method, headers } as RequestOptions,
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
        );
        res.on("error", reject);
      }
    );
    req.setTimeout(4000, () => req.destroy(new Error("s3 timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function bucketExists(config: S3Config): Promise<boolean> {
  try {
    const result = await call(config, "GET", "", null, null, "location=");
    return result.status < 400;
  } catch {
    return false;
  }
}

export async function createBucket(config: S3Config): Promise<boolean> {
  try {
    const result = await call(config, "PUT", "", null, null);
    if (result.status === 409) return true;
    return result.status < 400;
  } catch {
    return false;
  }
}

export async function putObject(
  config: S3Config,
  key: string,
  object: S3Object
): Promise<boolean> {
  try {
    const result = await call(config, "PUT", key, object.body, object.contentType);
    return result.status < 400;
  } catch {
    return false;
  }
}

export async function headObject(config: S3Config, key: string): Promise<boolean> {
  try {
    const result = await call(config, "HEAD", key, null, null);
    return result.status < 400;
  } catch {
    return false;
  }
}

export async function getObject(config: S3Config, key: string): Promise<S3Object | null> {
  try {
    const result = await call(config, "GET", key, null, null);
    if (result.status >= 400) return null;
    const type = result.headers["content-type"];
    const contentType = Array.isArray(type) ? type[0] : type;
    return {
      body: result.body,
      contentType: contentType ?? "image/png",
    };
  } catch {
    return null;
  }
}

export async function deleteObject(config: S3Config, key: string): Promise<boolean> {
  try {
    const result = await call(config, "DELETE", key, null, null);
    return result.status < 400 || result.status === 404;
  } catch {
    return false;
  }
}
