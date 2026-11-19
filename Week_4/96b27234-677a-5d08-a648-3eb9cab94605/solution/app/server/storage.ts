import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { Refusal } from "./http.js";

const SAVE_TEXT = "File storage is unavailable. Nothing was saved.";
const READ_TEXT = "File storage is unavailable.";

class StorageDown extends Error {}

let flaggedDown = false;
export const setMinioDown = (down: boolean): void => {
  flaggedDown = down;
};
export const minioFlaggedDown = (): boolean => flaggedDown;

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

const encodeKey = (key: string): string => key.split("/").map((part) => encodeURIComponent(part)).join("/");

async function request(method: "GET" | "PUT" | "DELETE" | "HEAD", key: string, body?: Buffer): Promise<{ status: number; bytes: Buffer }> {
  if (flaggedDown) throw new StorageDown();
  const { endpoint, bucket, region, accessKeyId, secretAccessKey } = config.s3;
  const url = new URL(endpoint);
  const path = `/${bucket}${key ? `/${encodeKey(key)}` : ""}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedNames = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    "",
    signedNames.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedNames.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
  try {
    const response = await fetch(`${url.origin}${path}`, {
      method,
      headers,
      ...(body ? { body: new Uint8Array(body) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  } catch {
    throw new StorageDown();
  }
}

export const versionKey = (assetId: string, version: number): string => `assets/${assetId}/v${version}.glb`;

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  const { status } = await request("PUT", key, bytes);
  if (status !== 200) throw new StorageDown();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const { status, bytes } = await request("GET", key);
  if (status === 404) return null;
  if (status !== 200) throw new StorageDown();
  return bytes;
}

export async function deleteObject(key: string): Promise<void> {
  const { status } = await request("DELETE", key);
  if (status !== 204 && status !== 200 && status !== 404) throw new StorageDown();
}

export async function storageReachable(): Promise<boolean> {
  try {
    const { status } = await request("HEAD", "");
    return status === 200;
  } catch {
    return false;
  }
}

/** Runs a storage call, turning an unreachable store into the refusal the brief states. */
export async function saving<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageDown) throw new Refusal(503, SAVE_TEXT);
    throw error;
  }
}

export async function reading<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageDown) throw new Refusal(503, READ_TEXT);
    throw error;
  }
}
