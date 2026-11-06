// Every published limit, decided once (brief: Business rules). Each check returns the brief's
// message for a failing value, or null when the value is allowed.

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// Limits given in characters count user-perceived characters (grapheme clusters).
export function characters(value: string): number {
  let n = 0;
  for (const _ of segmenter.segment(value)) n += 1;
  return n;
}

export const utf8Bytes = (value: string): number => Buffer.byteLength(value, "utf8");

export const SINGLE_UPLOAD_MAX = 50_000_000;
export const PART_MAX = 16_777_216;
export const PART_MIN = 5_242_880;
export const PART_NUMBER_MAX = 1000;
export const MULTIPART_TOTAL_MAX = 1_000_000_000;
export const JSON_BODY_MAX = 65_536;
export const DELETE_BODY_MAX = 2_097_152;
export const DELETE_ENTRIES_MAX = 1000;
export const PAGE_MAX = 1000;
export const SCAN_BUDGET = 10_000;
export const SEARCH_RESULTS_MAX = 50;
const LINK_EXPIRY_MAX_SECONDS = 604_800;
export const LINK_RATE = 30;
export const INVITE_RATE = 10;
export const RATE_WINDOW_SECONDS = 60;
export const SIGNIN_FAILURES_MAX = 5;
export const ENDPOINT_LIMIT = 5;
export const WEBHOOK_ATTEMPTS = 6;
export const RETENTION_DAYS_MAX = 3650;

const BUCKET_NAME_MESSAGE = "Bucket names are 3 to 63 lowercase letters, digits or hyphens, starting and ending with a letter or digit.";
export function bucketNameError(name: unknown): string | null {
  return typeof name === "string" && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name) && !name.startsWith("xn--")
    ? null : BUCKET_NAME_MESSAGE;
}

const PLACEMENT_MESSAGE = "Choose 1 to 4 different regions; the first is the origin.";
export function placementError(placement: unknown, known: readonly string[]): string | null {
  return Array.isArray(placement) && placement.length >= 1 && placement.length <= 4 &&
    placement.every((r) => typeof r === "string" && known.includes(r)) && new Set(placement).size === placement.length
    ? null : PLACEMENT_MESSAGE;
}

export function keyAllowed(key: string): boolean {
  const bytes = utf8Bytes(key);
  return bytes >= 1 && bytes <= 1024 && !key.startsWith("/") && !key.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(key) && !key.split("/").some((s) => s === "." || s === "..");
}

export const METADATA_MESSAGE = "User metadata is limited to 2,048 bytes in total.";
export function metadataAllowed(metadata: Record<string, string>): boolean {
  return Object.entries(metadata).reduce((sum, [k, v]) => sum + utf8Bytes(k) + utf8Bytes(v), 0) <= 2048;
}

export const TAGS_MESSAGE = "Up to 10 tags; keys 1 to 128 characters, values up to 256.";
// Reads an x-amz-tagging value (URL query encoding); null when it breaks the tag limits.
export function parseTags(raw: string | undefined): Record<string, string> | null {
  const tags: Record<string, string> = {};
  if (raw === undefined || raw === "") return tags;
  const pairs = raw.split("&");
  if (pairs.length > 10) return null;
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, " "));
      value = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    } catch {
      return null;
    }
    if (characters(key) < 1 || characters(key) > 128 || characters(value) > 256 || Object.hasOwn(tags, key)) return null;
    tags[key] = value;
  }
  return tags;
}

export const DESCRIPTION_MESSAGE = "Descriptions are limited to 140 characters.";
export const descriptionAllowed = (value: unknown): value is string => typeof value === "string" && characters(value) <= 140;

export const IDEMPOTENCY_KEY_MESSAGE = "Idempotency keys are 1 to 128 printable ASCII characters.";
export const idempotencyKeyAllowed = (value: string): boolean => /^[\x20-\x7e]{1,128}$/.test(value);

export const LINK_EXPIRY_MESSAGE = "Pick an expiry between one second and seven days.";
export const linkExpiryAllowed = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= LINK_EXPIRY_MAX_SECONDS;

export const LIFECYCLE_MESSAGES = {
  noncurrent_days: "Expire noncurrent versions after 1 to 3,650 days, or leave it off.",
  keep_newest_noncurrent: "Keep 0 to 100 newest noncurrent versions.",
  abort_multipart_days: "Abort incomplete uploads after 1 to 365 days, or leave it off.",
} as const;
const integerIn = (value: unknown, min: number, max: number): boolean =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
export const lifecycleAllowed = {
  noncurrent_days: (v: unknown) => v === null || integerIn(v, 1, 3650),
  keep_newest_noncurrent: (v: unknown) => integerIn(v, 0, 100),
  abort_multipart_days: (v: unknown) => v === null || integerIn(v, 1, 365),
};

export const RETENTION_MESSAGE = "Pick a time after now and within 3,650 days.";

export const EMAIL_MESSAGE = "Enter a valid email address.";
export const emailAllowed = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const nameAllowed = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && characters(value) <= 80;
export const passwordAllowed = (value: unknown): value is string =>
  typeof value === "string" && characters(value) >= 12 && characters(value) <= 128;

export const WEBHOOK_MESSAGES = {
  url: "Enter an http or https URL without credentials.",
  events: "Choose one or more event types.",
  buckets: "Choose buckets from this workspace, or all buckets.",
  description: DESCRIPTION_MESSAGE,
} as const;
export function webhookUrlAllowed(value: unknown): value is string {
  if (typeof value !== "string" || utf8Bytes(value) > 2048 || value.includes("#")) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

// Content type judged from the bytes as well as the declared header (brief: Uploads, Content type).
const HTML_START = /^(<!doctype html|<html|<head|<body|<script)/i;
type ContentVerdict = { contentType: string } | { refused: true };
export function judgeContent(data: Buffer, declared: string | undefined): ContentVerdict {
  let text = data.subarray(0, 4096).toString("utf8");
  if (text.startsWith("﻿")) text = text.slice(1);
  text = text.replace(/^\s+/, "");
  if (HTML_START.test(text)) return { contentType: "text/html" };
  const whole = data.toString("utf8").replace(/^﻿/, "");
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(whole)) {
    const scripted = /<script[\s>/]/i.test(whole) || /<[^>]*\son[a-z]+\s*=/i.test(whole) || /javascript\s*:/i.test(whole);
    return scripted ? { refused: true } : { contentType: "image/svg+xml" };
  }
  const type = declared?.split(";")[0]?.trim();
  return { contentType: type || "application/octet-stream" };
}
