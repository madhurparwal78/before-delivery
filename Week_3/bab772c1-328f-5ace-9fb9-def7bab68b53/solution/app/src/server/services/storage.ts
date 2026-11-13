/** Capture objects in S3-compatible storage, signed with AWS SigV4. */

import { createHash, createHmac } from "node:crypto";
import { config, DEPENDENCY_TIMEOUT_MS } from "../config.js";
import { DependencyDown } from "../errors.js";

const SERVICE = "s3";

function sha256Hex(payload: Buffer | string): string {
  return createHash("sha256").update(payload).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

type StorageRequest = {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  key?: string;
  body?: Buffer;
  contentType?: string;
};

async function send(request: StorageRequest): Promise<{status: number; ok: boolean; bytes: Buffer}> {
  try {
    const endpoint = new URL(config.s3.endpoint);
    const path = config.s3.forcePathStyle
      ? `/${config.s3.bucket}${request.key ? `/${encodeKey(request.key)}` : ""}`
      : `${request.key ? `/${encodeKey(request.key)}` : "/"}`;
    const host = config.s3.forcePathStyle
      ? endpoint.host
      : `${config.s3.bucket}.${endpoint.host}`;
    const body = request.body ?? Buffer.alloc(0);
    const payloadHash = sha256Hex(body);
    const { stamp, date } = amzDate(new Date());

    const headers = new Map<string, string>([
      ["host", host],
      ["x-amz-content-sha256", payloadHash],
      ["x-amz-date", stamp],
    ]);
    if (request.contentType) {
      headers.set("content-type", request.contentType);
    }
    const signedHeaders = [...headers.keys()].sort();
    const canonicalHeaders = signedHeaders
      .map((name) => `${name}:${headers.get(name)}\n`)
      .join("");
    const canonicalRequest = [
      request.method,
      path,
      "",
      canonicalHeaders,
      signedHeaders.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      stamp,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

    const outgoing: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(
        ";",
      )}, Signature=${signature}`,
    };
    if (request.contentType) {
      outgoing["content-type"] = request.contentType;
    }

    const url = `${endpoint.protocol}//${host}${path}`;

    const response = await fetch(url, {
      method: request.method,
      headers: outgoing,
      body: request.method === "PUT" ? body : undefined,
      signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return {status: response.status, ok: response.ok, bytes};
  } catch (error) {
    throw new DependencyDown("storage", String(error));
  }
}

function captureKey(missionId: string, passId: string): string {
  return `captures/${missionId}/${passId}.cap`;
}

export async function probeStorage(): Promise<boolean> {
  try {
    const response = await send({ method: "HEAD" });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send({ method: "HEAD" });
  if (head.status === 404) {
    const created = await send({ method: "PUT" });
    if (!created.ok && created.status !== 409) {
      throw new DependencyDown("storage", `cannot create bucket: ${created.status}`);
    }
  }
}

export async function putCapture(
  missionId: string,
  passId: string,
  bytes: Buffer,
): Promise<void> {
  const response = await send({
    method: "PUT",
    key: captureKey(missionId, passId),
    body: bytes,
    contentType: "application/octet-stream",
  });
  if (!response.ok) {
    throw new DependencyDown("storage", `put failed: ${response.status}`);
  }
}

/** The exact stored bytes, or null when the object is absent. */
export async function getCapture(
  missionId: string,
  passId: string,
): Promise<Buffer | null> {
  const response = await send({ method: "GET", key: captureKey(missionId, passId) });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new DependencyDown("storage", `get failed: ${response.status}`);
  }
  return response.bytes;
}

export async function deleteCapture(missionId: string, passId: string): Promise<void> {
  const response = await send({ method: "DELETE", key: captureKey(missionId, passId) });
  if (!response.ok && response.status !== 404) {
    throw new DependencyDown("storage", `delete failed: ${response.status}`);
  }
}
