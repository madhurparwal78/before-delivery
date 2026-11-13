import type { Content, InterviewDetail, Scenario } from "../shared/content.js";
import type { ScenarioId } from "../shared/scenarios.js";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function failure(response: Response): Promise<ApiError> {
  const body: { message?: string } = await response.json().catch(() => ({}));
  return new ApiError(response.status, body.message ?? `the site answered ${response.status}`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw await failure(response);
  const body: T = await response.json();
  return body;
}

export function loadContent(): Promise<Content> {
  return getJson<Content>("/api/content");
}

/** The interview; an unknown slug rejects with an ApiError that carries the site's own message. */
export function loadInterview(slug: string): Promise<InterviewDetail> {
  return getJson<InterviewDetail>(`/api/interviews/${encodeURIComponent(slug)}`);
}

export function loadScenario(id: ScenarioId): Promise<Scenario> {
  return getJson<Scenario>(`/api/scenarios/${id}`);
}

/** Fetches the printed product sheet; the file name comes from the site's own answer. */
export async function loadSheet(): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch("/api/product/sheet");
  if (!response.ok) throw await failure(response);
  const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "";
  return { blob: await response.blob(), filename };
}
