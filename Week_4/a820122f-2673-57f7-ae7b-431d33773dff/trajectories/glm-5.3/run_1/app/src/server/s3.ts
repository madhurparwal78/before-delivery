import { createHash, createHmac } from "node:crypto";
import { request } from "node:http";

/**
 * A minimal S3 client for the two operations the archive needs: put and get.
 * Speaks AWS Signature V4 over HTTP with the configured endpoint, so no SDK
 * dependency ships.
 */

export interface S3Options {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export async function s3Put(options: S3Options, key: string, body: Buffer, contentType: string): Promise<void> {
  const { hostHeader, path } = targetOf(options, key);
  await signedRequest({
    method: "PUT",
    hostname: endpointHostname(options),
    port: endpointPort(options),
    hostHeader,
    path,
    region: options.region,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    body,
    headers: { "Content-Type": contentType },
  });
}

export async function s3Get(options: S3Options, key: string): Promise<Buffer | null> {
  const { hostHeader, path } = targetOf(options, key);
  return signedRequest({
    method: "GET",
    hostname: endpointHostname(options),
    port: endpointPort(options),
    hostHeader,
    path,
    region: options.region,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    body: Buffer.alloc(0),
    headers: {},
  });
}

/** With path style the bucket is a path segment; the Host header stays the
 *  bare endpoint, which S3-compatible stores require. */
function targetOf(options: S3Options, key: string): { hostHeader: string; path: string } {
  const url = new URL(options.endpoint);
  const host = url.host;
  return options.forcePathStyle
    ? { hostHeader: host, path: `/${options.bucket}/${key}` }
    : { hostHeader: `${options.bucket}.${host}`, path: `/${key}` };
}

function endpointHostname(options: S3Options): string {
  return new URL(options.endpoint).hostname;
}

function endpointPort(options: S3Options): number {
  const url = new URL(options.endpoint);
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

interface SignedRequest {
  method: string;
  hostname: string;
  port: number;
  hostHeader: string;
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  body: Buffer;
  headers: Record<string, string>;
}

async function signedRequest(args: SignedRequest): Promise<Buffer | null> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(args.body);
  const allHeaders: Record<string, string> = {
    host: args.hostHeader,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  for (const [name, value] of Object.entries(args.headers)) {
    // Canonical names are lowercase; the signature must match what is sent.
    allHeaders[name.toLowerCase()] = value;
  }
  const headerNames = Object.keys(allHeaders).sort();
  const canonicalHeaders = headerNames.map((name) => `${name}:${allHeaders[name]!}\n`).join("");
  const signedHeaders = headerNames.join(";");
  const canonicalRequest = [
    args.method,
    args.path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${args.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${args.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, args.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${args.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise<Buffer | null>((resolve) => {
    const req = request(
      {
        hostname: args.hostname,
        port: args.port,
        path: args.path,
        method: args.method,
        headers: {
          ...allHeaders,
          Authorization: authorization,
          "Content-Length": String(args.body.length),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(Buffer.concat(chunks));
          } else {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    if (args.body.length > 0) req.write(args.body);
    req.end();
  });
}

/** Whether the store answers at all; a missing object counts as answering. */
export async function s3Reachable(options: S3Options): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const url = new URL(options.endpoint);
    const req = request(
      { hostname: url.hostname, port: Number(url.port) || 80, path: `/${options.bucket}`, method: "HEAD", timeout: 2000 },
      (response) => {
        resolve(!!response.statusCode && response.statusCode < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}
