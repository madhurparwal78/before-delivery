// API client: fetch helpers and the published copy for errors and refusals.

import { announce, instantText, reportProblem } from './ui.js';

export interface ApiFailure {
  status: number;
  code: string;
  body: Record<string, unknown>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? 'error'));
    this.status = status;
    this.code = String(body.error ?? 'error');
    this.body = body;
  }
}

export async function api(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        ...(init.headers ?? {}),
      },
      credentials: 'same-origin',
    });
  } catch {
    reportProblem(
      "We couldn't reach Plumbline. Check your connection; nothing was saved. Try again and we'll make sure it only happens once.",
    );
    throw new ApiError(0, { error: 'network' });
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    if (response.status === 401) {
      // The caller decides; drafts are kept per form.
      throw new ApiError(401, body);
    }
    throw new ApiError(response.status, body);
  }
  return body;
}

export function fieldErrorCopy(failure: ApiError): Record<string, string> {
  const errors = (failure.body.errors ?? {}) as Record<string, string>;
  return errors;
}

/** The published refusal copy for a failed action. */
export function refusalCopy(failure: ApiError, context: Record<string, string> = {}): string {
  switch (failure.code) {
    case 'invalid_credentials':
      return "That email and password don't match. Check them and try again.";
    case 'already_signed_off': {
      const by = String(failure.body.by ?? 'Someone');
      const at = instantText(String(failure.body.at ?? new Date().toISOString()));
      return `${by} already signed off ${context.stage ?? ''} on ${at}.`.replace('  ', ' ');
    }
    case 'already_reviewed': {
      const by = String(failure.body.by ?? 'Someone');
      const at = instantText(String(failure.body.at ?? new Date().toISOString()));
      return `${by} already returned ${context.reference ?? ''} on ${at}.`;
    }
    case 'stale_version': {
      const by = String(failure.body.savedBy ?? 'Someone');
      const at = instantText(String(failure.body.savedAt ?? new Date().toISOString()));
      return `${by} saved a newer version at ${at}. Your changes weren't saved; they're shown beside the latest version.`;
    }
    case 'session_ended':
      return "Your session ended. Sign in again and we'll put your draft back.";
    case 'access_removed':
      return 'Your access to this workspace was removed. Anything unsaved was discarded.';
    case 'not_found':
      return "We couldn't find that. It may have been removed, or you may not have access.";
    case 'forbidden':
      return "Your role can't do this. Ask the studio director if you need it.";
    case 'over_approval_limit': {
      const currency = String(failure.body.currency ?? 'HKD');
      const limit = Number(failure.body.limitCents ?? 0);
      return `This variation is over your approval limit of ${amountInline(currency, limit)}. Ask the studio director to approve it.`;
    }
    case 'own_variation':
      return 'You raised this variation, so someone else has to decide it.';
    case 'illegal_transition': {
      const from = String(failure.body.from ?? '');
      const action = String(failure.body.action ?? '');
      const stateWord = stateWords[from] ?? from.replace(/_/g, ' ');
      const past = pastTense(action);
      if (context.kind === 'variation') {
        return `Variation ${context.number ?? ''} can't be ${past} because it's already ${stateWord}. It's back as it was.`;
      }
      if (action === 'move') {
        return `Snag ${context.number ?? ''} is closed, so it can't be moved. It's back where it was.`;
      }
      return `That can't be done while this is ${stateWord}.`;
    }
    case 'tender_closed': {
      const closedAt = String(failure.body.closedAt ?? new Date().toISOString());
      return `This tender closed at ${instantText(closedAt)}. Late bids and amendments can't be accepted.`;
    }
    case 'tender_still_open': {
      const closesAt = String(failure.body.closesAt ?? new Date().toISOString());
      return `Bids can be opened from ${instantText(closesAt)}.`;
    }
    case 'unpriced_exclusions': {
      const count = Number(failure.body.count ?? 0);
      return `Price every exclusion before awarding. ${count} are still unpriced.`;
    }
    case 'defects_period_running': {
      const defectsEndOn = String(failure.body.defectsEndOn ?? '');
      const [year, month, day] = defectsEndOn.split('-');
      return `Final retention can be released after ${parseInt(day, 10)} ${monthName(parseInt(month, 10))} ${year}.`;
    }
    case 'idempotency_key_reused':
      return "This retry doesn't match the variation it's retrying. Reload and check your variations.";
    case 'rate_limited': {
      const seconds = Number(failure.body.retryAfterSeconds ?? 1);
      return `You've sent 3 enquiries from ${context.email ?? 'your email'} recently. Please try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
    }
    case 'billing_unavailable':
      return `Billing is unreachable, so ${context.stage ?? 'the stage'} wasn't signed off. Nothing was recorded; try again in a few minutes.`;
    case 'storage_unavailable':
      return 'File storage is unreachable. Try the download again in a few minutes.';
    case 'member_exists':
      return 'That person is already a member.';
    default: {
      const errors = (failure.body.errors ?? {}) as Record<string, string>;
      const first = Object.values(errors)[0];
      if (first) return first;
      return "We couldn't find that. It may have been removed, or you may not have access.";
    }
  }
}

const stateWords: Record<string, string> = {
  raised: 'raised',
  under_review: 'under review',
  approved: 'approved',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  open: 'open',
  fixed: 'fixed',
  closed: 'closed',
  reopened: 'reopened',
  draft: 'a draft',
  requested: 'requested',
  signed_off: 'signed off',
  returned: 'returned',
  not_started: 'not started',
  published: 'published',
  withdrawn_cs: 'withdrawn',
  preview_sent: 'in preview',
  client_approved: 'client approved',
};

function pastTense(action: string): string {
  if (action === 'approve') return 'approved';
  if (action === 'reject') return 'rejected';
  if (action === 'withdraw') return 'withdrawn';
  if (action === 'start_review') return 'started for review';
  return `${action.replace(/_/g, ' ')}ed`;
}

function monthName(month: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] ?? '';
}

function amountInline(currency: string, cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${currency} ${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac.toString().padStart(2, '0')}`;
}

export function uploadCopy(fileName: string, failure: ApiError): string {
  const errors = (failure.body.errors ?? {}) as Record<string, string>;
  const fileError = errors.file;
  if (fileError) return `${fileName} wasn't uploaded: ${fileError}`;
  return `${fileName} wasn't uploaded.`;
}

export function announceSuccess(message: string): void {
  announce(message);
}
