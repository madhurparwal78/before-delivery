// The ephemeris client. Paging, Retry-After (both forms) and ETag
// revalidation are each handled in exactly one place.

import { DependencyError, fetchWithTimeout, requireEnv } from "./deps.js";

export class EphemerisFailure extends DependencyError {
  constructor() {
    super("ephemeris");
  }
}

export interface ReferenceVector {
  unix_ms: number;
  x_m: number;
  y_m: number;
  z_m: number;
  vx_m_s: number;
  vy_m_s: number;
  vz_m_s: number;
}

export interface FetchOutcome {
  outcome: "fetched" | "unchanged";
  vectors: ReferenceVector[];
  etag: string | null;
}

export class UnknownTargetError extends Error {
  constructor() {
    super("unknown target");
  }
}

interface ApiVector {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

interface ApiResponse {
  target: string;
  frame: string;
  units: { position: string; velocity: string; time: string };
  vectors: ApiVector[];
}

function wiremock(): string {
  return requireEnv("WIREMOCK_URL").replace(/\/$/, "");
}

function firstPageUrl(target: string, fromUnixS: number, toUnixS: number): string {
  return `${wiremock()}/v3/vectors?target=${encodeURIComponent(target)}&from=${fromUnixS}&to=${toUnixS}&step=60`;
}

function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(0, Math.round((dateMs - nowMs) / 1000));
  return null;
}

export async function fetchVectors(
  target: string,
  fromUnixS: number,
  toUnixS: number,
  ifNoneMatch: string | null,
  firstPageUrlOverride: string | null,
): Promise<FetchOutcome> {
  const start = firstPageUrlOverride ?? firstPageUrl(target, fromUnixS, toUnixS);
  const headers: Record<string, string> = {};
  if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;

  let response: Response;
  try {
    response = await fetchWithTimeout(start, { method: "GET", headers }, 3000);
  } catch {
    throw new DependencyError("ephemeris");
  }
  if (response.status === 304) {
    return { outcome: "unchanged", vectors: [], etag: ifNoneMatch };
  }
  if (response.status === 404) {
    throw new UnknownTargetError();
  }
  if (response.status === 429) {
    const wait = parseRetryAfter(response.headers.get("Retry-After"), Date.now());
    if (wait === null || wait > 30) throw new DependencyError("ephemeris");
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    try {
      response = await fetchWithTimeout(start, { method: "GET", headers }, 3000);
    } catch {
      throw new DependencyError("ephemeris");
    }
    if (response.status === 429) throw new DependencyError("ephemeris");
  }
  if (!response.ok) throw new DependencyError("ephemeris");

  const etag = response.headers.get("ETag");
  const vectors: ReferenceVector[] = [];
  let nextPage: string | null = parseLinkHeader(response.headers.get("Link"));

  const firstBody = await readBody(response);
  if (!firstBody) throw new DependencyError("ephemeris");
  appendVectors(vectors, firstBody, target);

  let guard = 0;
  while (nextPage !== null) {
    guard += 1;
    if (guard > 1000) throw new DependencyError("ephemeris");
    let page: Response;
    try {
      page = await fetchWithTimeout(nextPage, { method: "GET" }, 3000);
    } catch {
      throw new DependencyError("ephemeris");
    }
    if (page.status === 429) {
      const wait = parseRetryAfter(page.headers.get("Retry-After"), Date.now());
      if (wait === null || wait > 30) throw new DependencyError("ephemeris");
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      try {
        page = await fetchWithTimeout(nextPage, { method: "GET" }, 3000);
      } catch {
        throw new DependencyError("ephemeris");
      }
      if (page.status === 429) throw new DependencyError("ephemeris");
    }
    if (!page.ok) throw new DependencyError("ephemeris");
    const body = await readBody(page);
    if (!body) throw new DependencyError("ephemeris");
    appendVectors(vectors, body, target);
    nextPage = parseLinkHeader(page.headers.get("Link"));
  }

  return { outcome: "fetched", vectors, etag };
}

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null;
  // RFC 8288: link list; find rel="next".
  for (const part of header.split(",")) {
    const match = /^<([^>]+)>\s*;\s*rel="?next"?/i.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

async function readBody(response: Response): Promise<ApiResponse | null> {
  try {
    const body = (await response.json()) as ApiResponse;
    return body;
  } catch {
    return null;
  }
}

function appendVectors(
  out: ReferenceVector[],
  body: ApiResponse,
  _target: string,
): void {
  if (body.frame !== "MCMF") throw new DependencyError("ephemeris");
  if (
    !Array.isArray(body.vectors) ||
    typeof body.target !== "string" ||
    !body.units ||
    body.units.position !== "km" ||
    body.units.velocity !== "km/s" ||
    body.units.time !== "unix_ms"
  ) {
    throw new DependencyError("ephemeris");
  }
  for (const v of body.vectors) {
    const x = Number(v.x);
    const y = Number(v.y);
    const z = Number(v.z);
    const vx = Number(v.vx);
    const vy = Number(v.vy);
    const vz = Number(v.vz);
    const t = Number(v.t);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(vx) ||
      !Number.isFinite(vy) ||
      !Number.isFinite(vz) ||
      !Number.isFinite(t)
    ) {
      throw new DependencyError("ephemeris");
    }
    out.push({
      unix_ms: t,
      x_m: x * 1000,
      y_m: y * 1000,
      z_m: z * 1000,
      vx_m_s: vx * 1000,
      vy_m_s: vy * 1000,
      vz_m_s: vz * 1000,
    });
  }
}

export async function probeEphemeris(): Promise<boolean> {
  try {
    await fetchWithTimeout(`${wiremock()}/v3/vectors?target=TESSERA-3&from=0&to=0&step=60`, { method: "GET" }, 1000);
    return true;
  } catch {
    return false;
  }
}
