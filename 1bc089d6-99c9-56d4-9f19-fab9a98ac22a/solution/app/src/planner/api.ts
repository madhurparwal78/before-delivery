import type { RitualId } from "../shared/rituals";

export interface ApiFailure {
  ok: false;
  /** 0 when the server could not be reached at all. */
  status: number;
  code: string | null;
  message: string | null;
  fields: Record<string, string>;
  /** Seconds from the Retry-After header of a 429. */
  retryAfter: number | null;
  current?: Plan;
}

type ApiResult<T> = { ok: true; status: number; data: T } | ApiFailure;

interface PlanRitual {
  id: RitualId;
  title: string;
  minutes: number;
}

export interface Plan {
  id: string;
  email: string;
  bedtime: string;
  time_zone: string;
  rituals: PlanRitual[];
  total_minutes: number;
  note: string;
  reminders: "on" | "paused";
  version: number;
  starts_at_local: string;
  next_reminder_at: string | null;
  share_url: string | null;
}

export interface SharedPlan {
  bedtime: string;
  time_zone: string;
  rituals: PlanRitual[];
  total_minutes: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * Calls the API. A success carries the parsed body as the endpoint publishes it; a failure carries the
 * published error shape, read field by field from the parsed JSON.
 */
export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: null, message: null, fields: {}, retryAfter: null };
  }
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return { ok: true, status: response.status, data: payload as T };
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const fields = isRecord(error.fields) ? error.fields : {};
  const retryAfter = Number(response.headers.get("retry-after"));
  return {
    ok: false,
    status: response.status,
    code: text(error.code),
    message: text(error.message),
    fields: Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : []))),
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    current: isRecord(error.current) ? (error.current as unknown as Plan) : undefined,
  };
}

/** A Retry-After value in whole minutes, rounded up. */
export const retryMinutes = (failure: ApiFailure) => Math.max(1, Math.ceil((failure.retryAfter ?? 60) / 60));

export const CHECK_DETAILS = "Some details need another look.";
