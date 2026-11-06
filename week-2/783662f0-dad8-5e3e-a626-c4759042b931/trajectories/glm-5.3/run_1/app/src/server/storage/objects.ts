/** MinIO object storage with all-or-nothing write pairs: data object, then manifest. */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, type GetObjectOutput } from "@aws-sdk/client-s3";
import { config } from "../config.js";
import { createHash } from "node:crypto";

export interface Manifest {
  kind: string;
  server_id: string;
  object: string;
  sha256: string;
  bytes: number;
  created_at: string;
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export class ObjectMissingError extends Error {
  constructor(key: string) {
    super(`Object ${key} does not exist`);
    this.name = "ObjectMissingError";
  }
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (client !== null) return client;
  const cfg = config().s3;
  client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return client;
}

async function put(key: string, body: string | Uint8Array): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: config().s3.bucket, Key: key, Body: body }));
}

async function get(key: string): Promise<string> {
  let res: GetObjectOutput;
  try {
    res = await s3().send(new GetObjectCommand({ Bucket: config().s3.bucket, Key: key }));
  } catch {
    throw new ObjectMissingError(key);
  }
  const body = res.Body;
  if (body === undefined) throw new ObjectMissingError(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body as NodeJS.ReadableStream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function getBytes(key: string): Promise<Uint8Array> {
  const text = await get(key);
  return new TextEncoder().encode(text);
}

async function del(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: config().s3.bucket, Key: key }));
}

export async function isReachable(): Promise<boolean> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: config().s3.bucket }));
    return true;
  } catch {
    return false;
  }
}

function sha256(data: string): string {
  return createHash("sha256").update(new TextEncoder().encode(data)).digest("hex");
}

export interface WritePairInput {
  kind: string;
  serverId: string;
  dataKey: string;
  manifestKey: string;
  data: string | Uint8Array;
}

/** Writes the data object, then the manifest object. On failure deletes what was written. */
export async function writePair(input: WritePairInput): Promise<void> {
  const dataText = typeof input.data === "string" ? input.data : new TextDecoder().decode(input.data);
  let dataWritten = false;
  try {
    await put(input.dataKey, input.data);
    dataWritten = true;
    const manifest: Manifest = {
      kind: input.kind,
      server_id: input.serverId,
      object: input.dataKey,
      sha256: sha256(dataText),
      bytes: typeof input.data === "string" ? new TextEncoder().encode(input.data).byteLength : input.data.byteLength,
      created_at: new Date().toISOString(),
    };
    await put(input.manifestKey, JSON.stringify(manifest));
  } catch (err) {
    if (dataWritten) {
      try {
        await del(input.dataKey);
      } catch {
        // best effort cleanup
      }
    }
    throw new StorageUnavailableError(String(err));
  }
}

export async function deletePair(dataKey: string, manifestKey: string): Promise<void> {
  const errors: unknown[] = [];
  try {
    await del(dataKey);
  } catch (err) {
    errors.push(err);
  }
  try {
    await del(manifestKey);
  } catch (err) {
    errors.push(err);
  }
  if (errors.length > 0) throw new StorageUnavailableError(String(errors[0]));
}

export async function readObject(key: string): Promise<string> {
  return get(key);
}

export async function readObjectBytes(key: string): Promise<Uint8Array> {
  return getBytes(key);
}

export async function readManifest(key: string): Promise<Manifest> {
  const text = await get(key);
  return JSON.parse(text) as Manifest;
}

export async function putObject(key: string, body: Uint8Array): Promise<void> {
  await put(key, body);
}

export function verifySha256(data: string, manifest: Manifest): boolean {
  return sha256(data) === manifest.sha256;
}
