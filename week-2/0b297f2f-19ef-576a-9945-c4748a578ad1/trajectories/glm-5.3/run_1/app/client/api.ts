import type { ApiErrorBody, Unit } from './types.js';

export interface ApiResult<T> {
  status: number;
  body: T | ApiErrorBody;
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { staffId?: string; idempotencyKey?: string; raw?: boolean } = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.staffId !== undefined) headers['X-Staff-Id'] = options.staffId;
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    payload = JSON.stringify(body);
  }
  const response = await fetch(path, {
    method,
    headers,
    body: payload,
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return { status: response.status, body: (await response.json()) as T };
  }
  return { status: response.status, body: (await response.text()) as unknown as T };
}

export function isApiError<T>(result: ApiResult<T>): result is ApiResult<T> & { body: ApiErrorBody } {
  return (
    typeof result.body === 'object' && result.body !== null && 'error' in (result.body as object)
  );
}

export function errorBody(result: ApiResult<unknown>): ApiErrorBody {
  return result.body as ApiErrorBody;
}

export function getStaffId(): string {
  return localStorage.getItem('hangline.staff') ?? 'cur-ines';
}

export function setStaffId(id: string): void {
  localStorage.setItem('hangline.staff', id);
}

export function getUnit(): Unit {
  return localStorage.getItem('hangline.unit') === 'in' ? 'in' : 'cm';
}

export function setUnit(unit: Unit): void {
  localStorage.setItem('hangline.unit', unit);
}
