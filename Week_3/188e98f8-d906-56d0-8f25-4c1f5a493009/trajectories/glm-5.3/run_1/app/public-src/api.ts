import type { Answer, Dispute, LeagueTable, Round } from "./util";

export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
  readonly count?: number;
  readonly fields?: Record<string, string>;
}

export interface ApiResult<T> {
  readonly status: number;
  readonly body: T | ApiError;
  readonly replayed: boolean;
}

async function request<T>(path: string, init: RequestInit, idempotencyKey?: string): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  if (idempotencyKey !== undefined) {
    headers.set("Idempotency-Key", idempotencyKey);
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const replayed = response.headers.get("Idempotent-Replayed") === "true";
  if (response.status === 204) {
    return { status: 204, body: undefined as unknown as T, replayed };
  }
  let body: T | ApiError;
  try {
    body = (await response.json()) as T | ApiError;
  } catch {
    body = { status: response.status, code: "network_error" } as ApiError;
  }
  return { status: response.status, body, replayed };
}

export function getRounds(): Promise<ApiResult<{ night: number; server_time: string; rounds: Round[] }>> {
  return request("/api/rounds", { method: "GET" });
}

export function getTable(): Promise<ApiResult<LeagueTable>> {
  return request("/api/table", { method: "GET" });
}

export function getRound(n: number): Promise<ApiResult<{ round: Round }>> {
  return request(`/api/rounds/${n}`, { method: "GET" });
}

export function postSession(code: string): Promise<ApiResult<{ role: string; team_id: number | null; team_name: string | null }>> {
  return request("/api/session", { method: "POST", body: JSON.stringify({ code }) });
}

export function getSession(): Promise<ApiResult<{ role: string; team_id: number | null; team_name: string | null }>> {
  return request("/api/session", { method: "GET" });
}

export function deleteSession(): Promise<ApiResult<void>> {
  return request("/api/session", { method: "DELETE" });
}

export function getRoundAnswers(n: number): Promise<ApiResult<{ round: number; answers: Answer[] }>> {
  return request(`/api/rounds/${n}/answers`, { method: "GET" });
}

export function submitRoundAnswers(
  n: number,
  answers: readonly { question: number; text: string }[],
  key?: string,
): Promise<ApiResult<{ round: number; accepted: Answer[] }>> {
  return request(`/api/rounds/${n}/answers`, { method: "POST", body: JSON.stringify({ answers }) }, key);
}

export function putMark(n: number, answerId: number, points: 0 | 1): Promise<ApiResult<{ answer: Answer }>> {
  return request(`/api/rounds/${n}/marks`, {
    method: "PUT",
    body: JSON.stringify({ answer_id: answerId, points }),
  });
}

export function postMarked(n: number): Promise<ApiResult<{ round: Round }>> {
  return request(`/api/rounds/${n}/marked`, { method: "POST" });
}

export function openRound(n: number): Promise<ApiResult<{ round: Round }>> {
  return request(`/api/rounds/${n}/open`, { method: "POST" });
}

export function closeRound(n: number): Promise<ApiResult<{ round: Round }>> {
  return request(`/api/rounds/${n}/close`, { method: "POST" });
}

export function publishRound(n: number): Promise<ApiResult<{ round: Round; table: LeagueTable }>> {
  return request(`/api/rounds/${n}/publish`, { method: "POST" });
}

export function uploadSheet(n: number, file: File): Promise<ApiResult<{ round: Round }>> {
  return request(`/api/rounds/${n}/sheet`, { method: "PUT", body: file });
}

export function patchTeam(id: number, name: string): Promise<ApiResult<{ team: { id: number; name: string } }>> {
  return request(`/api/teams/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function postDispute(answerId: number, reason: string): Promise<ApiResult<{ dispute: Dispute }>> {
  return request("/api/disputes", { method: "POST", body: JSON.stringify({ answer_id: answerId, reason }) });
}

export function getDisputes(): Promise<ApiResult<{ disputes: Dispute[] }>> {
  return request("/api/disputes", { method: "GET" });
}

export function postRuling(id: number, ruling: "upheld" | "dismissed"): Promise<ApiResult<{ dispute: Dispute }>> {
  return request(`/api/disputes/${id}/ruling`, { method: "POST", body: JSON.stringify({ ruling }) });
}

export function getArchive(
  limit: number,
  cursor: string | null,
): Promise<ApiResult<{ answers: Answer[]; limit: number; next_cursor: string | null; has_more: boolean }>> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cursor !== null) params.set("cursor", cursor);
  return request(`/api/answers?${params.toString()}`, { method: "GET" });
}

export function searchAnswers(query: string, round: number | undefined): Promise<ApiResult<{ answers: Answer[]; count: number; truncated: boolean }>> {
  return request("/api/answers/search", {
    method: "POST",
    body: JSON.stringify(round === undefined ? { query } : { query, round }),
  });
}

export function isApiError(body: unknown): body is ApiError {
  return typeof body === "object" && body !== null && "error" in body;
}
