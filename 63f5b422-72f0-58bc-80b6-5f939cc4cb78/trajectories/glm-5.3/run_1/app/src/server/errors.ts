// API error handling: one error shape for every route, and the one precedence ladder.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

export type ApiError =
  | { code: 'body_too_large' }
  | { code: 'unsupported_image' }
  | { code: 'image_too_large' }
  | { code: 'unauthenticated' }
  | { code: 'not_found'; message?: string }
  | { code: 'forbidden_role'; message?: string }
  | { code: 'cross_origin' }
  | { code: 'idempotency_key_reused' }
  | { code: 'invalid'; fields: Record<string, string> }
  | { code: 'invalid_move'; fields: Record<string, string> }
  | { code: 'image_not_confirmed'; fields: Record<string, string> }
  | { code: 'email_taken' }
  | { code: 'invalid_credentials'; message?: string }
  | { code: 'node_deleted'; message: string }
  | { code: 'token_in_use'; message: string }
  | { code: 'component_in_use'; message: string }
  | { code: 'field_in_use'; message: string }
  | { code: 'undo_skipped'; message: string }
  | { code: 'nothing_to_undo' | 'nothing_to_redo' }
  | { code: 'publish_in_progress' }
  | { code: 'not_live' }
  | { code: 'already_resolved' | 'not_resolved' }
  | { code: 'already_member'; message: string }
  | { code: 'already_invited'; message: string }
  | { code: 'owner_role_fixed' }
  | { code: 'not_pending' }
  | { code: 'invite_invalid'; message?: string }
  | { code: 'storage_unavailable' }
  | { code: 'mail_unavailable' };

export class HttpError extends Error {
  constructor(public status: number, public err: ApiError) { super(err.code); }
}

export function invalid(fields: Record<string, string>): HttpError {
  return new HttpError(422, { code: 'invalid', fields });
}

export function invalidMove(fields: Record<string, string>): HttpError {
  return new HttpError(422, { code: 'invalid_move', fields });
}

export function notFound(): HttpError {
  return new HttpError(404, { code: 'not_found', message: 'Not found.' });
}

export function forbiddenRole(): HttpError {
  return new HttpError(403, { code: 'forbidden_role', message: 'You do not have permission to do that.' });
}

export function conflictError(code: string, message: string): HttpError {
  return new HttpError(409, { code: code as ApiError['code'], message } as ApiError);
}

export function errorBody(err: ApiError): string {
  const body: Record<string, unknown> = { code: err.code, message: errorMessage(err) };
  if ('fields' in err && err.fields) body.fields = err.fields;
  return JSON.stringify({ error: body });
}

function errorMessage(err: ApiError): string {
  if ('message' in err && err.message) return err.message;
  switch (err.code) {
    case 'body_too_large': return 'That request body is too large.';
    case 'unsupported_image': return 'Only PNG, JPEG or WebP images can be uploaded.';
    case 'image_too_large': return 'That image is over 5,000,000 bytes.';
    case 'unauthenticated': return 'You need to sign in.';
    case 'not_found': return 'Not found.';
    case 'forbidden_role': return 'You do not have permission to do that.';
    case 'cross_origin': return 'Requests from other origins are not accepted.';
    case 'idempotency_key_reused': return 'That idempotency key was used for another page.';
    case 'invalid': case 'invalid_move': case 'image_not_confirmed': return 'Some values are not valid.';
    case 'email_taken': return 'An account with this email already exists.';
    case 'invalid_credentials': return 'Email or password is wrong.';
    case 'nothing_to_undo': return 'Nothing to undo.';
    case 'nothing_to_redo': return 'Nothing to redo.';
    case 'publish_in_progress': return 'A publish is already running.';
    case 'not_live': return 'This page is not live.';
    case 'already_resolved': return 'That thread is already resolved.';
    case 'not_resolved': return 'That thread is not resolved.';
    case 'owner_role_fixed': return "The owner's role cannot change.";
    case 'not_pending': return 'That invitation is no longer pending.';
    case 'invite_invalid': return 'This invitation is not valid.';
    case 'storage_unavailable': return 'File storage is unavailable.';
    case 'mail_unavailable': return 'Mail is unavailable.';
    default: return 'Request failed.';
  }
}
