/**
 * MinIO client over AWS Signature Version 4. The bucket is private: browsers only
 * ever fetch files through the app's own endpoints.
 *
 * Object keys:
 *   covers/<projectId>/<uuid>.<jpg|png|webp>
 *   spec-sheets/<variantCode>.pdf
 *   quotes/<projectId>/<shareId>.pdf
 */

import { createHash, createHmac } from "node:crypto";
import { loadConfig } from "../config.js";
import { expectOk, providerFetch, ProviderUnavailable } from "./provider.js";

const config = loadConfig();

const sha256Hex = (payload: Buffer | string): string => createHash("sha256").update(payload).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(args: {
  method: string;
  key: string;
  body: Buffer;
  contentType?: string;
}): SignedRequest {
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${args.key ? `/${encodeKeyPath(args.key)}` : ""}`
    : `/${encodeKeyPath(args.key)}`;
  const url = new URL(`${config.s3.endpoint}${path}`);

  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(args.body);

  const signedHeaderValues: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (args.contentType) signedHeaderValues["content-type"] = args.contentType;

  const names = Object.keys(signedHeaderValues).sort();
  const canonicalHeaders = names.map((name) => `${name}:${(signedHeaderValues[name] ?? "").trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    args.method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    url: url.toString(),
    headers: {
      ...signedHeaderValues,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function send(args: {
  method: string;
  key: string;
  body?: Buffer;
  contentType?: string;
  allowed: readonly number[];
  timeoutMs?: number;
}): Promise<{ status: number; bytes: Buffer }> {
  const body = args.body ?? Buffer.alloc(0);
  const signed = signRequest({
    method: args.method,
    key: args.key,
    body,
    ...(args.contentType ? { contentType: args.contentType } : {}),
  });

  let response: Response;
  try {
    response = await fetch(signed.url, {
      method: args.method,
      headers: signed.headers,
      body: body.length > 0 ? body : undefined,
      signal: AbortSignal.timeout(args.timeoutMs ?? 10_000),
    });
  } catch (cause) {
    throw new ProviderUnavailable("minio", cause);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (cause) {
    throw new ProviderUnavailable("minio", cause);
  }

  if (!args.allowed.includes(response.status)) {
    throw new ProviderUnavailable(
      "minio",
      new Error(`unexpected ${response.status} from MinIO for ${args.key}`),
    );
  }
  return { status: response.status, bytes };
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await send({ method: "PUT", key, body, contentType, allowed: [200, 201] });
}

/** A cover or quote counts as ready only once the stored object is confirmed to exist. */
export async function objectExists(key: string): Promise<boolean> {
  const result = await send({ method: "HEAD", key, allowed: [200, 404] });
  return result.status === 200;
}

export async function getObject(key: string): Promise<Buffer | null> {
  const result = await send({ method: "GET", key, allowed: [200, 404] });
  return result.status === 200 ? result.bytes : null;
}

export async function ping(timeoutMs: number): Promise<void> {
  const response = await providerFetch("minio", `${config.s3.endpoint}/minio/health/live`, { timeoutMs });
  expectOk("minio", response, [200]);
}

export const objectKeys = {
  cover: (projectId: string, uuid: string, extension: string): string =>
    `covers/${projectId}/${uuid}.${extension}`,
  specSheet: (variantCode: string): string => `spec-sheets/${variantCode}.pdf`,
  quote: (projectId: string, shareId: string): string => `quotes/${projectId}/${shareId}.pdf`,
} as const;
