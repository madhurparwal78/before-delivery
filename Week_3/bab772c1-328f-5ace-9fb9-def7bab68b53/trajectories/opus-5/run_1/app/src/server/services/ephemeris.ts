/** The Hollis Selenodesy Ephemeris client: paging, `Retry-After` and ETag revalidation. */

import { config, DEPENDENCY_TIMEOUT_MS } from "../config.js";
import type { Vector } from "../../shared/model.js";

export type EphemerisResult =
  | { outcome: "updated"; vectors: Vector[]; etag: string | null; firstPageUrl: string }
  | { outcome: "unchanged" }
  | { outcome: "unavailable" }
  | { outcome: "unknown_target" };

const MAX_RETRY_AFTER_SECONDS = 30;

export function firstPageUrl(target: string, fromUnixS: number, toUnixS: number): string {
  const url = new URL("/v3/vectors", config.ephemerisUrl);
  url.searchParams.set("target", target);
  url.searchParams.set("from", String(fromUnixS));
  url.searchParams.set("to", String(toUnixS));
  url.searchParams.set("step", "60");
  return url.toString();
}

function retryAfterSeconds(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const asNumber = Number(header);
  if (Number.isInteger(asNumber) && asNumber >= 0) {
    return asNumber;
  }
  const asDate = Date.parse(header);
  if (Number.isNaN(asDate)) {
    return null;
  }
  return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
}

function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(",")) {
    const match = /^\s*<([^>]+)>\s*;\s*(.+)$/.exec(part);
    if (match && /rel\s*=\s*"?next"?/i.test(match[2])) {
      return match[1];
    }
  }
  return null;
}

type RawVector = { t: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };

function readPage(body: unknown): Vector[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const page = body as { frame?: unknown; vectors?: unknown };
  if (page.frame !== "MCMF" || !Array.isArray(page.vectors)) {
    return null;
  }
  const vectors: Vector[] = [];
  for (const item of page.vectors) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const raw = item as Partial<RawVector>;
    const numbers = [raw.t, raw.x, raw.y, raw.z, raw.vx, raw.vy, raw.vz];
    if (numbers.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      return null;
    }
    const vector = item as RawVector;
    vectors.push({
      unix_ms: Math.round(vector.t),
      x_m: vector.x * 1000,
      y_m: vector.y * 1000,
      z_m: vector.z * 1000,
      vx_m_s: vector.vx * 1000,
      vy_m_s: vector.vy * 1000,
      vz_m_s: vector.vz * 1000,
    });
  }
  return vectors;
}

async function requestPage(url: string, etag: string | null): Promise<Response | null> {
  const headers = etag ? { "if-none-match": etag } : undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (response.status !== 429) {
    return response;
  }
  const wait = retryAfterSeconds(response.headers.get("retry-after"));
  if (wait === null || wait > MAX_RETRY_AFTER_SECONDS) {
    return null;
  }
  await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  try {
    const retried = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS),
    });
    return retried.status === 429 ? null : retried;
  } catch {
    return null;
  }
}

/** Fetches every page of the mission's span; `etag` revalidates the stored vectors. */
export async function fetchVectors(
  target: string,
  fromUnixS: number,
  toUnixS: number,
  etag: string | null,
): Promise<EphemerisResult> {
  const first = firstPageUrl(target, fromUnixS, toUnixS);
  let url: string | null = first;
  let pageEtag: string | null = null;
  const vectors: Vector[] = [];
  let page = 0;
  while (url) {
    const response = await requestPage(url, page === 0 ? etag : null);
    if (!response) {
      return { outcome: "unavailable" };
    }
    if (page === 0 && response.status === 304) {
      return { outcome: "unchanged" };
    }
    if (response.status === 404) {
      const body: unknown = await response.json().catch(() => null);
      const code = (body as { code?: unknown } | null)?.code;
      return code === "unknown_target" ? { outcome: "unknown_target" } : { outcome: "unavailable" };
    }
    if (!response.ok) {
      return { outcome: "unavailable" };
    }
    const body: unknown = await response.json().catch(() => null);
    const parsed = readPage(body);
    if (!parsed) {
      return { outcome: "unavailable" };
    }
    vectors.push(...parsed);
    if (page === 0) {
      pageEtag = response.headers.get("etag");
    }
    url = nextPageUrl(response.headers.get("link"));
    page += 1;
  }
  vectors.sort((a, b) => a.unix_ms - b.unix_ms);
  return { outcome: "updated", vectors, etag: pageEtag, firstPageUrl: first };
}
