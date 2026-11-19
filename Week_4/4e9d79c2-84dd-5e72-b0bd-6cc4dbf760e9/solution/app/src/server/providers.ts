// The real services behind the screens. Each call waits a bounded time and throws ProviderDown on any failure.
import { createHash, createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import type { Untrusted } from "./http.js";

export class ProviderDown extends Error {}
/** The provider answered and has no such record. */
export class ProviderMissing extends Error {}
const THIRD_PARTY_WAIT_MS = 5000;
const OBJECT_WAIT_MS = 20000;

const guarded = async (url: string, init: RequestInit, wait: number): Promise<Response> => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(wait) });
  } catch {
    throw new ProviderDown(url);
  }
};

// WireMock: the five invented third-party APIs, called only from this server.
const providerJson = async (path: string, init: RequestInit = {}): Promise<Untrusted> => {
  const response = await guarded(`${config.wiremockUrl}${path}`, init, THIRD_PARTY_WAIT_MS);
  if (!response.ok) throw new ProviderDown(path, { cause: response.status });
  try {
    return await response.json();
  } catch {
    throw new ProviderDown(path);
  }
};
export const addressFind = (q: string): Promise<Untrusted> => providerJson(`/v1/find?q=${encodeURIComponent(q)}`);
export const addressGet = (id: string): Promise<Untrusted> =>
  providerJson(`/v1/get/${encodeURIComponent(id)}`).catch((error: unknown) => {
    throw error instanceof ProviderDown && error.cause === 404 ? new ProviderMissing(id) : error;
  });
export const routeLegs = (vehicleClass: "coach" | "minibus", stops: string[]): Promise<Untrusted> =>
  providerJson("/v1/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vehicleClass, stops: stops.map((text) => ({ text })) }) });
export const flightStatus = (code: string, date: string): Promise<Untrusted> => providerJson(`/v1/flights/${encodeURIComponent(code)}?date=${date}`);
export const bankHolidays = (): Promise<Untrusted> => providerJson("/bank-holidays.json");
export const directoryPage = (cursor: string | null): Promise<Untrusted> => providerJson(cursor ? `/v2/operators?cursor=${encodeURIComponent(cursor)}` : "/v2/operators");

// MinIO by signed S3 requests.
const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeKey = (key: string): string => key.split("/").map(encodeURIComponent).join("/");

const s3 = async (method: string, key: string, query: Record<string, string> = {}, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> => {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}${key ? `/${encodeKey(key)}` : ""}` : `/${encodeKey(key)}`;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
  const day = stamp.slice(0, 8);
  const payload = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": stamp };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const queryText = Object.keys(query).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&");
  const canonical = [method, path, queryText, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const signing = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = hmac(signing, `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`).toString("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const { host: _host, ...sent } = headers;
  const url = `${base.protocol}//${host}${path}${queryText ? `?${queryText}` : ""}`;
  return guarded(url, { method, headers: sent, body: body.length ? body : undefined }, OBJECT_WAIT_MS);
};
export const putObject = async (key: string, data: Buffer, contentType: string): Promise<void> => {
  const response = await s3("PUT", key, {}, data, contentType);
  if (!response.ok) throw new ProviderDown(`PUT ${response.status}`);
};
export const getObject = async (key: string): Promise<Buffer> => {
  const response = await s3("GET", key);
  if (!response.ok) throw new ProviderDown(`GET ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
export const deleteObject = async (key: string): Promise<void> => {
  const response = await s3("DELETE", key);
  if (!response.ok && response.status !== 404) throw new ProviderDown(`DELETE ${response.status}`);
};
/** Asks MinIO whether it can answer at all. */
export const askStore = async (): Promise<void> => {
  const response = await s3("GET", "", { "list-type": "2", "max-keys": "1" });
  if (!response.ok) throw new ProviderDown(`LIST ${response.status}`);
};

// Gotenberg renders every PDF from HTML this app sends.
export const renderPdf = async (html: string): Promise<Buffer> => {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  const response = await guarded(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form }, OBJECT_WAIT_MS);
  if (!response.ok) throw new ProviderDown(`render ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

// ntfy carries the driver's push.
export const pushToDriver = async (telephoneFolded: string, title: string, message: string): Promise<void> => {
  const auth = Buffer.from(`${config.ntfyUsername}:${config.ntfyPassword}`).toString("base64");
  const response = await guarded(`${config.ntfyUrl}/driver-${telephoneFolded}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, Title: title, "Content-Type": "text/plain; charset=utf-8" },
    body: message,
  }, THIRD_PARTY_WAIT_MS);
  if (!response.ok) throw new ProviderDown(`push ${response.status}`);
};

// Mailpit over SMTP.
const mailer = nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: false, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000 });
export const sendMail = async (to: string, subject: string, text: string): Promise<void> => {
  try {
    await mailer.sendMail({ from: config.mailFrom, to, subject, text });
  } catch {
    throw new ProviderDown("mail");
  }
};
