// The two invented services at WireMock, read only in answer to a person's
// action, never at start and never on a timer, except that the server polls
// a render it started. It waits at most 5 seconds for an answer.

import type { Config } from "./config";
import { type Instant } from "../shared/tz";

const CALL_TIMEOUT_MS = 5000;

export type Track = { id: string; title: string; composer: string; seconds: number };
export type SearchPage = { tracks: Track[]; nextCursor: string | null };
export type PriceRow = { validFrom: string; perMarket: string };

// A provider failure is one answer: unavailable.
export class ProviderUnavailable extends Error {}

async function callJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const seconds = retryAfter === null ? 60 : Number(retryAfter);
      throw new RateLimited(Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 60);
    }
    if (!res.ok) throw new ProviderUnavailable();
    return await res.json();
  } catch (e) {
    if (e instanceof RateLimited || e instanceof ProviderUnavailable) throw e;
    throw new ProviderUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

export class RateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("rate limited");
  }
}

export class Hollowreed {
  constructor(private readonly config: Config) {}

  private url(path: string): string {
    return `${this.config.wiremockUrl}${path}`;
  }

  async searchTracks(q: string, cursor: string | null): Promise<SearchPage> {
    const params = new URLSearchParams({ q });
    if (cursor !== null) params.set("cursor", cursor);
    const raw = await callJson(this.url(`/v2/tracks?${params.toString()}`), { method: "GET" });
    const page = raw as { tracks?: unknown; nextCursor?: unknown };
    const tracks = Array.isArray(page.tracks) ? page.tracks : [];
    return {
      tracks: tracks.map((t) => {
        const track = t as Record<string, unknown>;
        return {
          id: String(track.id ?? ""),
          title: String(track.title ?? ""),
          composer: String(track.composer ?? ""),
          seconds: Number(track.seconds ?? 0),
        };
      }),
      nextCursor: typeof page.nextCursor === "string" && page.nextCursor.length > 0 ? page.nextCursor : null,
    };
  }

  async prices(): Promise<PriceRow[]> {
    const raw = await callJson(this.url("/v2/prices"), { method: "GET" });
    const body = raw as { prices?: unknown };
    const rows = Array.isArray(body.prices) ? body.prices : [];
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return { validFrom: String(row.validFrom ?? ""), perMarket: String(row.perMarket ?? "") };
    });
  }

  async buyLicence(input: {
    trackId: string;
    market: string;
    from: string;
    until: string;
    fee: string;
  }): Promise<{ licenceId: string }> {
    const raw = await callJson(this.url("/v2/licences"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = raw as { licenceId?: unknown };
    return { licenceId: String(body.licenceId ?? "") };
  }
}

export type RenderAsk = {
  cutId: string;
  frameRate: string;
  width: number;
  burnTimecode: boolean;
  clips: { frame: number; durationFrames: number; sha256: string | null }[];
};

export type RenderState =
  | { state: "queued" }
  | { state: "running"; progress: number }
  | { state: "done"; url: string; size: number; sha256: string }
  | { state: "failed"; reason: string };

export class Quaymill {
  constructor(private readonly config: Config) {}

  private url(path: string): string {
    return `${this.config.wiremockUrl}${path}`;
  }

  private idempotencyKey(ask: RenderAsk): string {
    return `${ask.cutId}-${ask.width}-${ask.burnTimecode}`;
  }

  async ask(ask: RenderAsk): Promise<{ id: string }> {
    const raw = await callJson(this.url("/v1/renders"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": this.idempotencyKey(ask),
      },
      body: JSON.stringify(ask),
    });
    const body = raw as { id?: unknown };
    return { id: String(body.id ?? "") };
  }

  async poll(id: string): Promise<RenderState> {
    const raw = await callJson(this.url(`/v1/renders/${id}`), { method: "GET" });
    const body = raw as Record<string, unknown>;
    const state = String(body.state ?? "");
    if (state === "queued") return { state: "queued" };
    if (state === "running") return { state: "running", progress: Number(body.progress ?? 0) };
    if (state === "done") {
      return {
        state: "done",
        url: String(body.url ?? ""),
        size: Number(body.size ?? 0),
        sha256: String(body.sha256 ?? ""),
      };
    }
    return { state: "failed", reason: String(body.reason ?? "") };
  }

  // A film is plain bytes fetched from the same service and copied into the
  // file store byte for byte.
  async fetchFilm(url: string): Promise<Buffer> {
    const target = url.startsWith("http") ? url : `${this.config.wiremockUrl}${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const res = await fetch(target, { signal: controller.signal });
      if (!res.ok) throw new ProviderUnavailable();
      return Buffer.from(await res.arrayBuffer());
    } catch {
      throw new ProviderUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }
}

// A busy answer holds every call to the service until that instant.
export type Busy = { until: Instant; message: string };
