/** Same-origin calls to the app's own API. */
import { sha256OfBlob } from './sha256';
import {
  AuditEntryPayload,
  BoardPayload,
  CitationPayload,
  ClockPayload,
  ErrorPayload,
  RestatementPayload,
  StaffUserPayload,
  TapePayload,
} from './types';

export interface ApiFailure {
  kind: 'failure';
  status: number;
  code: string;
  fields: Record<string, string> | null;
}

export interface ApiNetworkFailure {
  kind: 'network';
}

export interface ApiSuccess<T> {
  kind: 'success';
  status: number;
  value: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure | ApiNetworkFailure;

async function request<T>(
  method: string,
  path: string,
  options: { json?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return { kind: 'network' };
  }
  if (response.status === 204) {
    return { kind: 'success', status: response.status, value: undefined as T };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const failure = payload as ErrorPayload | null;
    return {
      kind: 'failure',
      status: response.status,
      code: failure?.error?.code ?? 'internal',
      fields: failure?.error?.fields ?? null,
    };
  }
  return { kind: 'success', status: response.status, value: payload as T };
}

export const getBoard = (): Promise<ApiResult<BoardPayload>> => request('GET', '/api/board');

export const getCitation = (figure: string, date: string): Promise<ApiResult<CitationPayload>> =>
  request('GET', `/api/citations/${encodeURIComponent(figure)}/${encodeURIComponent(date)}`);

export const getClock = (): Promise<ApiResult<ClockPayload>> => request('GET', '/api/clock');

export const getTape = (): Promise<ApiResult<TapePayload>> => request('GET', '/api/operator/tape');

export const putTape = (state: 'playing' | 'paused'): Promise<ApiResult<TapePayload>> =>
  request('PUT', '/api/operator/tape', { json: { state } });

export const putClock = (at: string | null): Promise<ApiResult<ClockPayload>> =>
  request('PUT', '/api/operator/clock', { json: { at } });

export const postSession = (
  email: string,
  password: string,
): Promise<ApiResult<{ user: StaffUserPayload }>> =>
  request('POST', '/api/session', { json: { email, password } });

export const getSessionUser = (): Promise<ApiResult<{ user: StaffUserPayload }>> =>
  request('GET', '/api/session');

export const deleteSessionRequest = (): Promise<ApiResult<void>> => request('DELETE', '/api/session');

export const listRestatements = (): Promise<ApiResult<{ restatements: RestatementPayload[] }>> =>
  request('GET', '/api/restatements');

export const getRestatement = (id: string): Promise<ApiResult<{ restatement: RestatementPayload }>> =>
  request('GET', `/api/restatements/${encodeURIComponent(id)}`);

export const getAudit = (id: string): Promise<ApiResult<{ entries: AuditEntryPayload[] }>> =>
  request('GET', `/api/restatements/${encodeURIComponent(id)}/audit`);

export const createRestatement = (
  json: Record<string, unknown>,
): Promise<ApiResult<{ restatement: RestatementPayload }>> =>
  request('POST', '/api/restatements', { json });

export const patchRestatement = (
  id: string,
  json: Record<string, unknown>,
): Promise<ApiResult<{ restatement: RestatementPayload }>> =>
  request('PATCH', `/api/restatements/${encodeURIComponent(id)}`, { json });

export const submitRestatement = (
  id: string,
): Promise<ApiResult<{ restatement: RestatementPayload }>> =>
  request('POST', `/api/restatements/${encodeURIComponent(id)}/submit`, { json: {} });

export const returnRestatement = (
  id: string,
  note: string,
): Promise<ApiResult<{ restatement: RestatementPayload }>> =>
  request('POST', `/api/restatements/${encodeURIComponent(id)}/return`, { json: { note } });

export const clearRestatement = (
  id: string,
  checked: string[],
  version: number,
): Promise<ApiResult<{ restatement: RestatementPayload }>> =>
  request('POST', `/api/restatements/${encodeURIComponent(id)}/clear`, { json: { checked, version } });

export const releaseRestatement = (
  id: string,
  idempotencyKey: string,
): Promise<ApiResult<{ outcome: 'queued' | 'published'; restatement: RestatementPayload }>> =>
  request('POST', `/api/restatements/${encodeURIComponent(id)}/release`, {
    json: { confirm: true },
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export const withdrawRestatement = (
  id: string,
  version: number,
  note: string,
): Promise<ApiResult<{ restatement: RestatementPayload }>> =>
  request('POST', `/api/restatements/${encodeURIComponent(id)}/withdraw`, { json: { version, note } });

export interface UploadOutcome {
  kind: 'verified' | 'mismatch' | 'not_pdf' | 'not_filing_safe' | 'too_large' | 'no_accession' | 'vault_down' | 'unauthenticated' | 'unexpected';
  restatement?: RestatementPayload;
}

const NOT_PDF_MESSAGE = 'The exhibit is not a complete PDF.';

export async function uploadExhibit(
  id: string,
  file: File,
  sha256: string,
): Promise<UploadOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/restatements/${encodeURIComponent(id)}/exhibit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', 'X-Exhibit-SHA256': sha256 },
      body: file,
      credentials: 'same-origin',
    });
  } catch {
    return { kind: 'vault_down' };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 201) {
    return {
      kind: 'verified',
      restatement: (payload as { restatement: RestatementPayload }).restatement,
    };
  }
  const failure = payload as ErrorPayload | null;
  const code = failure?.error?.code ?? 'internal';
  const fields = failure?.error?.fields ?? {};
  if (code === 'vault_unavailable') return { kind: 'vault_down' };
  if (code === 'payload_too_large') return { kind: 'too_large' };
  if (code === 'unauthenticated') return { kind: 'unauthenticated' };
  if (code === 'validation_failed') {
    if (fields.file === NOT_PDF_MESSAGE) return { kind: 'not_pdf' };
    if (fields.file !== undefined) return { kind: 'not_filing_safe' };
    if (fields.accession !== undefined) return { kind: 'no_accession' };
    if (fields.sha256 !== undefined) return { kind: 'mismatch' };
  }
  return { kind: 'unexpected' };
}

export async function sha256Of(file: File): Promise<string> {
  return sha256OfBlob(file);
}
