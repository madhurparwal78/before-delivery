import { createHash, createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "./config";
import { ApiError } from "./http";
import type { LibraryRow } from "./footprint";

const PROVIDER_WAIT_MS = 5000;
const STORE_WAIT_MS = 15000;
const RENDER_WAIT_MS = 30000;
const LONGEST_BUSY_SECONDS = 365 * 24 * 3600;

const FILE_STORE_COPY = "The file store is unavailable right now. Nothing was saved.";

export function fileStoreUnavailable(message: string = FILE_STORE_COPY): ApiError {
  return new ApiError(503, "file_store_unavailable", message);
}

export function libraryUnavailable(): ApiError {
  return new ApiError(503, "factor_library_unavailable", "The factor library is unavailable right now. The last result stays.");
}

export interface EditionEntry {
  edition: string;
  validFrom: string;
}

async function libraryRead<T>(path: string): Promise<T> {
  try {
    const response = await fetch(`${config.wiremockUrl}${path}`, { signal: AbortSignal.timeout(PROVIDER_WAIT_MS) });
    if (response.status !== 200) throw libraryUnavailable();
    return (await response.json()) as T;
  } catch {
    throw libraryUnavailable();
  }
}

export async function readEditions(): Promise<EditionEntry[]> {
  const body = await libraryRead<{ editions?: EditionEntry[] }>("/v2/editions");
  if (!Array.isArray(body.editions)) throw libraryUnavailable();
  return body.editions;
}

/** Every page of one edition, following nextCursor to its end. */
export async function readFactors(edition: string): Promise<LibraryRow[]> {
  const rows: LibraryRow[] = [];
  let cursor: string | null = null;
  do {
    const query: string = `edition=${encodeURIComponent(edition)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page: { rows?: LibraryRow[]; nextCursor?: string | null } = await libraryRead(`/v2/factors?${query}`);
    if (!Array.isArray(page.rows)) throw libraryUnavailable();
    rows.push(...page.rows);
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return rows;
}

type ScoreAnswer =
  | { kind: "scored"; score: number; per100g: number; runId: string }
  | { kind: "busy"; retryAfterSeconds: number }
  | { kind: "unavailable" };

export async function askScoreService(body: unknown): Promise<ScoreAnswer> {
  try {
    const response = await fetch(`${config.wiremockUrl}/v1/textile/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_WAIT_MS),
    });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      return seconds > 0 && seconds <= LONGEST_BUSY_SECONDS ? { kind: "busy", retryAfterSeconds: Math.ceil(seconds) } : { kind: "unavailable" };
    }
    if (response.status !== 200) return { kind: "unavailable" };
    const answer = (await response.json()) as { score: number; per100g: number; runId: string };
    return typeof answer.score === "number" && typeof answer.per100g === "number"
      ? { kind: "scored", score: answer.score, per100g: answer.per100g, runId: String(answer.runId) }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** The dossier's HTML as index.html; the reply body is the PDF. */
export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(RENDER_WAIT_MS),
    });
    if (response.status !== 200) throw new Error(`Gotenberg answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw new ApiError(503, "dossier_service_unavailable", "The dossier service is unavailable right now. Nothing was saved.");
  }
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** One signed S3 call (SigV4) to the configured store. */
async function s3Call(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer): Promise<Response> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}/${encodedKey}` : `/${encodedKey}`;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
  const day = stamp.slice(0, 8);
  const payload = sha256(body ?? "");
  const headers = `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${stamp}\n`;
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const request = [method, path, "", headers, signed, payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(request)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = hmac(signingKey, toSign).toString("hex");
  return fetch(`${base.protocol}//${host}${path}`, {
    method,
    body,
    headers: {
      "x-amz-content-sha256": payload,
      "x-amz-date": stamp,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
    signal: AbortSignal.timeout(STORE_WAIT_MS),
  });
}

/** Resolves only once the store has confirmed the object. */
export async function storeObject(key: string, data: Buffer, unavailable: string = FILE_STORE_COPY): Promise<void> {
  try {
    const response = await s3Call("PUT", key, data);
    if (response.status !== 200) throw new Error(`MinIO answered ${response.status}`);
  } catch {
    throw fileStoreUnavailable(unavailable);
  }
}

export async function readObject(key: string): Promise<Buffer> {
  try {
    const response = await s3Call("GET", key);
    if (response.status !== 200) throw new Error(`MinIO answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw fileStoreUnavailable();
  }
}

/** True only once the store has confirmed the deletion. */
export async function deleteObject(key: string): Promise<boolean> {
  try {
    const response = await s3Call("DELETE", key);
    return response.status === 204 || response.status === 200;
  } catch {
    return false;
  }
}

const mailer = nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: false, ignoreTLS: true });

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await mailer.sendMail({ from: config.mailFrom, to, subject, text });
}
