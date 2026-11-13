// The one mapping from API error codes to published copy (brief: Feedback states) used by the public pages and the dashboard.
import { ApiError } from '../api.ts';
import { COPY, copy } from '../../shared/copy.ts';

export const GENERIC_ERROR = 'Something went wrong. Try again.';

function apiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}

/** Messages of a 422 keyed by field; empty for any other failure. */
export function fieldMessages(error: unknown): Record<string, string> {
  const api = apiError(error);
  return api && api.status === 422 ? api.fields : {};
}

export function signinFailure(error: unknown): { message: string; unconfirmedEmail?: string } {
  const api = apiError(error);
  if (api?.code === 'invalid_credentials') return { message: COPY.signinWrong };
  if (api?.code === 'unverified') {
    const email = String(api.body.email ?? '');
    return { message: copy.unconfirmed(email), unconfirmedEmail: email };
  }
  if (api?.code === 'signin_locked') {
    return { message: copy.lockedOut(Math.ceil(Number(api.body.retry_after_seconds ?? 0) / 60)) };
  }
  return { message: GENERIC_ERROR };
}

export type VerifyFailure =
  | { kind: 'expired' | 'replaced'; message: string; email: string }
  | { kind: 'unknown'; message: string };

export function verifyFailure(error: unknown): VerifyFailure {
  const api = apiError(error);
  const email = String(api?.body.email ?? '');
  if (api?.code === 'verify_link_expired') return { kind: 'expired', message: COPY.verifyExpired, email };
  if (api?.code === 'verify_link_replaced') return { kind: 'replaced', message: COPY.verifyReplaced, email };
  return { kind: 'unknown', message: COPY.verifyUnknown };
}

/** Copy for a failed confirmation-mail request (sign-up or resend). */
export function resendFailure(error: unknown): string {
  return apiError(error)?.code === 'mail_unavailable' ? COPY.mailUnavailableConfirmation : GENERIC_ERROR;
}

export function quoteFailure(error: unknown): string {
  return apiError(error)?.code === 'mail_unavailable' ? COPY.mailUnavailableQuote : GENERIC_ERROR;
}

export function uploadFailure(error: unknown, name: string): string {
  const api = apiError(error);
  if (api?.code === 'file_too_large') return copy.tooLarge(name, Number(api.body.limit_bytes ?? 0));
  if (api?.status === 422 && api.fields.file) return api.fields.file;
  if (api?.code === 'storage_unavailable') return COPY.storageUnavailableUpload;
  return GENERIC_ERROR;
}

export function restoreFailure(error: unknown): string {
  return apiError(error)?.code === 'storage_unavailable' ? COPY.storageUnavailableUpload : GENERIC_ERROR;
}

export function deleteFailure(error: unknown, name: string): string {
  return apiError(error)?.code === 'folder_not_empty' ? copy.folderNotEmpty(name) : GENERIC_ERROR;
}

export function isUnauthenticated(error: unknown): boolean {
  return apiError(error)?.status === 401;
}
