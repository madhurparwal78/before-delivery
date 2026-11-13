// The API client: fetch helpers that track connectivity and 401s (DP-67).
import type {
  Account, Kit, ObjectHistory, Observation, Packet, ProgramDetail, ProgramSummary,
  SessionSummary, SessionWithObservations, Site, SyncChange, SyncResult,
} from "../shared/api.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(code);
  }
}

export const networkState = {
  offline: false,
  signedOutWhileWaiting: false,
};

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    networkState.offline = true;
    throw new ApiError(0, "network");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const obj = (payload ?? {}) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) headers["Retry-After"] = retryAfter;
    throw new ApiError(
      response.status,
      String(obj["error"] ?? "error"),
      (obj["fields"] as Record<string, string> | undefined) ?? undefined,
      obj as Record<string, unknown>,
      headers,
    );
  }
  return payload as T;
}

export const apiGet = {
  me: () => api<{ account: Account }>("GET", "/auth/me"),
  kit: () => api<Kit>("GET", "/kit"),
  sites: () => api<{ sites: Site[] }>("GET", "/sites"),
  objects: () => api<{ objects: import("../shared/api.js").CatalogueRow[] }>("GET", "/objects"),
  history: (objectId: string) => api<ObjectHistory>("GET", `/objects/${objectId}/history`),
  sessions: () => api<{ sessions: SessionSummary[] }>("GET", "/sessions"),
  session: (id: string) => api<SessionWithObservations>("GET", `/sessions/${id}`),
  observation: (id: string) => api<Observation>("GET", `/observations/${id}`),
  strokes: (id: string) => fetch(`/api/observations/${id}/strokes`).then(async (r) => {
    if (r.status === 200) return { ok: true as const, text: await r.text() };
    if (r.status === 503) return { ok: false as const, reason: "storage" as const };
    return { ok: false as const, reason: "notfound" as const };
  }),
  programs: () => api<{ programs: ProgramSummary[] }>("GET", "/programs"),
  program: (id: string) => api<ProgramDetail>("GET", `/programs/${id}`),
  packets: () => api<{ packets: Packet[] }>("GET", "/packets"),
  packet: (id: string) => api<Packet>("GET", `/packets/${id}`),
};

export const apiPost = {
  signup: (body: { email: string; password: string; display_name: string }) =>
    api<{ account: Account }>("POST", "/auth/signup", body),
  signin: (body: { email: string; password: string }) =>
    api<{ account: Account }>("POST", "/auth/signin", body),
  signout: () => api<void>("POST", "/auth/signout"),
  telescope: (body: { name: string; aperture: number | string; aperture_unit: string; focal_length_mm: number | string }) =>
    api<{ id: string }>("POST", "/kit/telescopes", body),
  eyepiece: (body: { name: string; focal_length_mm: number | string; apparent_field_deg: number | string }) =>
    api<{ id: string }>("POST", "/kit/eyepieces", body),
  barlow: (body: { name: string; factor: number | string }) =>
    api<{ id: string }>("POST", "/kit/barlows", body),
  site: (body: { name: string; latitude: number | string; longitude: number | string; time_zone: string }) =>
    api<{ id: string }>("POST", "/sites", body),
  follow: (programId: string) => api<{ following: boolean }>("POST", `/programs/${programId}/follow`),
  unfollow: (programId: string) => api<{ following: boolean }>("DELETE", `/programs/${programId}/follow`),
  createPacket: (body: { program_id: string; observation_ids: string[] }) => api<Packet>("POST", "/packets", body),
  packetRows: (packetId: string, body: { revision: number; observation_ids: string[] }) => api<Packet>("PUT", `/packets/${packetId}/rows`, body),
  packetCheck: (packetId: string, body: { revision: number }) => api<Packet>("POST", `/packets/${packetId}/check`, body),
  packetRender: (packetId: string, body: { revision: number }) => api<Packet>("POST", `/packets/${packetId}/render`, body),
  packetSend: (packetId: string, body: { revision: number }) => api<Packet>("POST", `/packets/${packetId}/send`, body),
  sync: (device: string, changes: readonly SyncChange[]) =>
    api<{ results: SyncResult[] }>("POST", "/sync", { device, changes: [...changes] }),
};

