import { alerts, fixed } from '../shared/copy.js';
import type { ConflictCode } from '../shared/types.js';
import { config } from './config.js';

/** The one shape every API error leaves through. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(`api ${status}`);
  }
}

export function tooLarge(): ApiError {
  return new ApiError(413, { error: 'too_large' });
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, { error: 'unsupported_media_type' });
}

export function unauthenticated(): ApiError {
  return new ApiError(401, { error: 'unauthenticated' });
}

export function notFound(): ApiError {
  return new ApiError(404, { error: 'not_found' });
}

export function invalid(errors: Record<string, string>): ApiError {
  return new ApiError(422, { errors });
}

export function malformedJson(): ApiError {
  return invalid({ body: 'Send a JSON object.' });
}

/** The alert copy published for each refusal code. */
export function conflictMessage(code: ConflictCode, name = ''): string {
  switch (code) {
    case 'no_previous_sibling':
      return alerts.noPreviousSibling;
    case 'too_deep':
      return alerts.tooDeep(config.maxDepth);
    case 'at_top':
      return alerts.atTop;
    case 'at_first':
      return alerts.atFirst;
    case 'at_last':
      return alerts.atLast;
    case 'inside_itself':
      return alerts.insideItself;
    case 'share_root':
      return alerts.shareRoot;
    case 'stale_revision':
      return alerts.staleRevision(name);
    case 'nothing_to_undo':
      return alerts.nothingToUndo;
    case 'nothing_to_redo':
      return alerts.nothingToRedo;
    case 'edited_since':
      return alerts.editedSince(name);
    case 'origin_gone':
      return alerts.originGone;
    case 'already_invited':
      return fixed.alreadyInvited;
    case 'not_retryable':
      return alerts.notRetryable;
    case 'share_closed':
      return alerts.shareClosed;
    case 'invitation_lapsed':
      return fixed.inviteLapsed;
    case 'wrong_account':
      return fixed.inviteWrongAccount;
    case 'email_taken':
      return alerts.emailTaken;
  }
}

export function conflict(code: ConflictCode, extra: Record<string, unknown> = {}, name = ''): ApiError {
  return new ApiError(409, { error: code, message: conflictMessage(code, name), ...extra });
}

export function mailUnavailable(): ApiError {
  return new ApiError(503, { error: 'mail_unavailable' });
}
