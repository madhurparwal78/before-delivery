import type { Config } from "../config/env.js";
import { PROVIDER_TIMEOUT_MS } from "../config/env.js";
import type { FactorRow } from "../engine/footprint.js";
import type { Lang } from "../engine/copy.js";

/**
 * The two invented providers on WireMock: the factor library and the score service.
 * The app waits at most 5 seconds for either; a later answer counts as unreachable.
 */
export interface EditionInfo {
  edition: string;
  validFrom: string;
}

export class Providers {
  constructor(private config: Config) {}

  private async fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const status = res.status;
        const retryAfterRaw = res.headers.get("retry-after");
        const retryAfter = retryAfterRaw !== null ? Number.parseInt(retryAfterRaw, 10) : null;
        throw new ProviderHttpError(status, Number.isFinite(retryAfter) ? retryAfter : null);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /v2/editions */
  async readEditions(): Promise<EditionInfo[]> {
    const out = await this.fetchJson(`${this.config.wiremockUrl}/v2/editions`);
    const parsed = out as { editions: EditionInfo[] };
    return parsed.editions;
  }

  /** GET /v2/factors?edition=…, then every page while nextCursor answers. */
  async readFactors(edition: string): Promise<FactorRow[]> {
    const rowsOut: FactorRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const url = cursor
        ? `${this.config.wiremockUrl}/v2/factors?edition=${encodeURIComponent(edition)}&cursor=${encodeURIComponent(cursor)}`
        : `${this.config.wiremockUrl}/v2/factors?edition=${encodeURIComponent(edition)}`;
      const pageOut = (await this.fetchJson(url)) as { rows: FactorRow[]; nextCursor: string | null };
      rowsOut.push(...pageOut.rows);
      if (!pageOut.nextCursor) break;
      cursor = pageOut.nextCursor;
    }
    return rowsOut;
  }

  /** POST /v1/textile/score */
  async askScore(body: unknown): Promise<{ score: number; per100g: number; runId: string }> {
    const out = await this.fetchJson(`${this.config.wiremockUrl}/v1/textile/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = out as { score: number; per100g: number; runId: string };
    return { score: parsed.score, per100g: parsed.per100g, runId: parsed.runId };
  }
}

export class ProviderHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds: number | null) {
    super(`provider answered ${status}`);
  }
}

/** The score service's request body, exactly as published. */
export interface ScoreInputs {
  gtin: string;
  garment: string;
  massGrams: string;
  washes: number;
  materials: { id: string; sharePercent: string; tier1: string; tier2: string; tier3: string }[];
  repairService: boolean;
  rangeSize: number;
}

export type ScoreOutcome =
  | { kind: "answered"; score: number; per100g: number; runId: string }
  | { kind: "busy"; busyUntil: Date }
  | { kind: "unreachable" };

/** Ask the score service, mapping its answers to the published states. */
export async function askScoreOutcome(providers: Providers, body: ScoreInputs): Promise<ScoreOutcome> {
  try {
    const out = await providers.askScore(body);
    return { kind: "answered", ...out };
  } catch (e) {
    if (e instanceof ProviderHttpError) {
      if (e.status === 429 && e.retryAfterSeconds !== null) {
        return { kind: "busy", busyUntil: new Date(Date.now() + e.retryAfterSeconds * 1000) };
      }
      return { kind: "unreachable" };
    }
    return { kind: "unreachable" };
  }
}

export type { Lang };
