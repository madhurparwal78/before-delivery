// The filing vault (MinIO). The only module that talks to S3. No host, port
// or error code ever leaves this module.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";

let client: S3Client | null = null;
let bucketName = "";
let lastProbe: { available: boolean; at: number } = { available: false, at: 0 };
let probeTimer: NodeJS.Timeout | null = null;

export class VaultError extends Error {}

function envValue(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error("missing configuration");
  return v;
}

export function initVault(): void {
  bucketName = envValue("S3_BUCKET");
  client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: envValue("S3_ACCESS_KEY_ID"),
      secretAccessKey: envValue("S3_SECRET_ACCESS_KEY"),
    },
    requestHandler: { requestTimeout: 4_000, connectionTimeout: 3_000 },
  });
  // Create-only writes: the publish step must never rewrite an exhibits/ key.
  client.middlewareStack.add(
    (next) => async (args) => {
      const input = args.input as { createOnly?: boolean };
      if (input.createOnly) {
        const request = args.request as { headers?: Record<string, string> } | undefined;
        if (request?.headers) request.headers["if-none-match"] = "*";
      }
      return next(args);
    },
    { step: "build", name: "tracewell-create-only" },
  );
}

async function probe(): Promise<boolean> {
  if (!client) return false;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (e: unknown) {
    const name = (e as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchBucket") {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucketName }));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export async function refreshVaultStatus(): Promise<boolean> {
  const available = await probe();
  lastProbe = { available, at: Date.now() };
  return available;
}

export function startVaultProbing(): void {
  if (probeTimer) return;
  void refreshVaultStatus();
  probeTimer = setInterval(() => {
    void refreshVaultStatus().then((available) => {
      // Seeded exhibits are written within 10 seconds of the vault coming back.
      if (available) void writeMissingSeededExhibits();
    });
  }, 4_000);
  probeTimer.unref?.();
}

let seededExhibitWriter: ((available: boolean) => Promise<void>) | null = null;

/** The seed registers its exhibit writer here; probing drives it after recovery. */
export function registerSeededExhibitWriter(writer: (available: boolean) => Promise<void>): void {
  seededExhibitWriter = writer;
}

async function writeMissingSeededExhibits(): Promise<void> {
  if (seededExhibitWriter) await seededExhibitWriter(true).catch(() => undefined);
}

export function vaultAvailable(): boolean {
  if (Date.now() - lastProbe.at > 10_000) return false;
  return lastProbe.available;
}

export async function stageIncoming(
  restatementId: string,
  body: Buffer,
): Promise<{ key: string; sha256: string }> {
  const uploadId = randomUUID();
  const key = `incoming/${restatementId}/${uploadId}.pdf`;
  await putObject(key, body);
  const readBack = await getObject(key);
  if (readBack === null) throw new VaultError("vault unreachable");
  return { key, sha256: hashBytes(readBack) };
}

/** Create-only publish. If the key already exists, the existing object is kept. */
export async function publishExhibit(accession: string, sha256: string, body: Buffer): Promise<void> {
  const key = `exhibits/${accession}/${sha256}.pdf`;
  try {
    if (!client) throw new VaultError("vault unreachable");
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: "application/pdf",
    });
    (command.input as { createOnly?: boolean }).createOnly = true;
    await client.send(command);
  } catch (e: unknown) {
    const name = (e as { name?: string }).name;
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === "PreconditionFailed" || status === 412 || status === 304) return;
    throw new VaultError("vault unreachable");
  }
}

export async function readExhibitBytes(accession: string, sha256: string): Promise<Buffer | null> {
  return getObject(`exhibits/${accession}/${sha256}.pdf`);
}

export async function ensureSeededExhibit(accession: string, sha256: string, body: Buffer): Promise<boolean> {
  const key = `exhibits/${accession}/${sha256}.pdf`;
  const existing = await getObject(key);
  if (existing !== null) return true;
  try {
    await publishExhibit(accession, sha256, body);
    return true;
  } catch {
    return false;
  }
}

async function putObject(key: string, body: Buffer): Promise<void> {
  try {
    if (!client) throw new VaultError("vault unreachable");
    await client.send(
      new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: "application/pdf" }),
    );
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError("vault unreachable");
  }
}

async function getObject(key: string): Promise<Buffer | null> {
  if (!client) return null;
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) return null;
    return Buffer.from(bytes);
  } catch {
    return null;
  }
}

export function hashBytes(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}
