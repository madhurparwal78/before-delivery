// API client and shared browser state.

import type { Reference, Reel, Sheet, Unit } from "../shared/domain.js";

export type { Reference, Reel, Sheet, Unit };

export interface ServicesStatus { search: "up" | "down"; storage: "up" | "down"; printing: "up" | "down" }

export interface ReferencesBody {
  zone: string;
  today_starts_at: string;
  saved_today: Reference[];
  earlier: Reference[];
}

export interface DailyPullBody {
  pull_day: string;
  zone: string;
  state: "picked" | "empty" | "removed";
  reference: Reference | null;
  next_pull_at: string;
  today_starts_at: string;
  server_now: string;
}

export interface SettingsBody {
  home_zone: string;
  pending_zone: { zone: string; effective_from: string; effective_date: string } | null;
  history: Array<{ zone: string; effective_from: string }>;
  unit: Unit;
  server_now: string;
}

export interface TrashBody {
  server_now: string;
  items: Array<{ id: string; title: string; maker: string | null; trashed_at: string; purge_at: string; seconds_left: number }>;
}

export interface SearchBody { source: "index" | "fallback"; results: Reference[] }

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(fail: ApiFailure) {
    super(fail.message);
    this.status = fail.status;
    this.code = fail.code;
    this.fields = fail.fields;
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error;
    throw new ApiError({
      status: res.status,
      code: err?.code ?? "unknown",
      message: err?.message ?? "Something went wrong. Try again.",
      fields: err?.fields,
    });
  }
  return body;
}

export const api = {
  status: () => request("/api/status") as Promise<{ server_now: string; services: ServicesStatus }>,
  references: () => request("/api/references") as Promise<ReferencesBody>,
  reference: (id: string) => request(`/api/references/${id}`) as Promise<Reference>,
  search: (q: string, colour?: string) =>
    request(`/api/search?q=${encodeURIComponent(q)}${colour ? `&colour_family=${encodeURIComponent(colour)}` : ""}`) as Promise<SearchBody>,
  patchReference: (id: string, body: Record<string, unknown>) =>
    request(`/api/references/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as Promise<Reference>,
  swatch: (id: string, x: number, y: number) =>
    request(`/api/references/${id}/swatch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x, y }) }) as Promise<Reference>,
  resetSwatch: (id: string) =>
    request(`/api/references/${id}/swatch`, { method: "DELETE" }) as Promise<Reference>,
  trash: (id: string) => request(`/api/references/${id}`, { method: "DELETE" }) as Promise<Reference>,
  restore: (id: string) => request(`/api/references/${id}/restore`, { method: "POST" }) as Promise<Reference>,
  trashList: () => request("/api/trash") as Promise<TrashBody>,
  dailyPull: () => request("/api/daily-pull") as Promise<DailyPullBody>,
  settings: () => request("/api/settings") as Promise<SettingsBody>,
  saveZone: (zone: string) =>
    request("/api/settings/home-zone", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zone }) }) as Promise<SettingsBody>,
  saveUnit: (unit: Unit) =>
    request("/api/settings/unit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unit }) }) as Promise<SettingsBody>,
  reels: () => request("/api/reels") as Promise<{ reels: Array<{ id: string; name: string; demo: boolean; version: number; stop_count: number; playable_count: number }> }>,
  reel: (id: string) => request(`/api/reels/${id}`) as Promise<Reel>,
  createReel: (name: string) =>
    request("/api/reels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }) as Promise<Reel>,
  appendStop: (reelId: string, referenceId: string) =>
    request(`/api/reels/${reelId}/stops`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference_id: referenceId }) }) as Promise<Reel>,
  reorderStops: (reelId: string, version: number, referenceIds: string[]) =>
    request(`/api/reels/${reelId}/stops`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version, reference_ids: referenceIds }) }) as Promise<Reel>,
  removeStop: (reelId: string, version: number, referenceIds: string[]) =>
    request(`/api/reels/${reelId}/stops`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version, reference_ids: referenceIds }) }) as Promise<Reel>,
  sheets: (reelId: string) => request(`/api/reels/${reelId}/sheets`) as Promise<{ sheets: Sheet[] }>,
  requestSheet: (reelId: string, paper: "a4" | "letter", unit: Unit, idempotencyKey: string) =>
    request(`/api/reels/${reelId}/sheets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ paper, unit }),
    }) as Promise<Sheet>,
  retrySheet: (sheetId: string) => request(`/api/sheets/${sheetId}/retry`, { method: "POST" }) as Promise<Sheet>,
  capture: (form: FormData, idempotencyKey: string) =>
    fetch("/api/references", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: form })
      .then(async (res) => {
        const text = await res.text();
        const body = text ? JSON.parse(text) : {};
        if (!res.ok) {
          const err = (body as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error;
          throw new ApiError({
            status: res.status,
            code: err?.code ?? "unknown",
            message: err?.message ?? "Something went wrong. Try again.",
            fields: err?.fields,
          });
        }
        return body as Reference;
      }),
};
