// The published feedback copy, announced through the two live regions.

import { DeskError } from './api';
import { localTime } from './dom';

export function announce(message: string): void {
  const region = document.getElementById('desk-updates');
  if (region) region.textContent = message;
}

let carried: string | null = null;

// announceAcross keeps a success sentence through the navigation that follows
// it, so the owner still reads it on the screen they land on.
export function announceAcross(message: string): void {
  carried = message;
  announce(message);
}

export function flushCarried(): void {
  if (carried === null) return;
  announce(carried);
  carried = null;
}

export function problem(message: string): void {
  const region = document.getElementById('desk-problems');
  if (region) region.textContent = message;
}

export function clearProblem(): void {
  problem('');
}

export const outageCopy: Record<string, { label: string; text: string }> = {
  git_host: {
    label: 'Repository host outage',
    text: "The repository host isn't answering. Publishing will fail until it's back; your strings are safe here.",
  },
  ai_engine: {
    label: 'AI engine outage',
    text: "The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated.",
  },
  webhooks: {
    label: 'Webhook outage',
    text: 'Webhook delivery is paused. Events are kept and sent once the service is back.',
  },
};

// failureCopy turns a server error into the published sentence for an action.
export function failureCopy(error: DeskError, context: Record<string, string> = {}): string {
  const info = error.info;
  if (info.unreachable) return info.message;
  const held = typeof info.details?.held_until === 'string' ? localTime(info.details.held_until) : '';
  switch (info.code) {
    case 'invalid_credentials':
      return "That email and password don't match.";
    case 'payload_too_large':
      return 'That file is larger than 5,000,000 bytes.';
    case 'slug_taken':
      return 'That slug is already used by another project.';
    case 'branch_exists':
      return 'A branch with that name already exists.';
    case 'branch_limit':
      return 'This project already has five open branches. Merge or abandon one first.';
    case 'key_exists':
      return 'Another key on this branch already has that name.';
    case 'branch_not_open':
      return 'This branch is in review, so keys and translations are locked.';
    case 'branch_closed':
      return "This branch is merged or abandoned, so it can't change.";
    case 'illegal_transition':
      return `That change isn't allowed from ${context.from ?? statusFrom(info)}.`;
    case 'assignment_expired':
      return 'This assignment expired. Ask the engineer to assign it again.';
    case 'key_removed':
      return `This key was removed on ${context.branch ?? ''}.`;
    case 'no_segments_to_review':
      return `There are no unassigned segments that need review in ${context.language ?? ''} on ${context.branch ?? ''}.`;
    case 'conflict_held':
      return `This conflict is being resolved in another session until ${held}.`;
    case 'hold_required':
      return 'Your hold on this conflict ran out. Hold it again to resolve it.';
    case 'conflicts_unresolved': {
      const left = Array.isArray(info.details?.conflicts) ? info.details.conflicts.length : 0;
      return `Resolve every conflict before merging. ${left} left.`;
    }
    case 'restore_superseded':
      return "Later changes were made after this, so it can't be restored exactly.";
    case 'already_restored':
      return 'This was already restored.';
    case 'reviewer_exists':
      return 'That reviewer already has access to this project.';
    case 'publish_in_progress':
      return 'Another publish is still running for this project.';
    case 'ai_engine_unavailable':
      return outageCopy.ai_engine.text;
    case 'webhooks_unavailable':
      return "The webhook service isn't answering. The endpoint wasn't saved; try again in a few minutes.";
    case 'storage_unavailable':
      return "File storage isn't answering. Nothing was saved; try again in a few minutes.";
    case 'validation_failed':
      return Object.values(info.fields ?? {})[0] ?? 'Some fields need attention.';
    default:
      return info.message;
  }
}

function statusFrom(info: { details?: Record<string, unknown> }): string {
  const from = info.details?.from;
  return typeof from === 'string' ? wordFor(from) : '';
}

function wordFor(state: string): string {
  const words: Record<string, string> = {
    untranslated: 'Untranslated',
    drafted: 'Drafted',
    scored: 'Scored',
    needs_review: 'Needs review',
    approved: 'Approved',
    open: 'Open',
    in_review: 'In review',
    merged: 'Merged',
    abandoned: 'Abandoned',
  };
  return words[state] ?? state;
}

// publishFailureCopy spells a failed publish out for people.
export function publishFailureCopy(reason: string | null): string {
  switch (reason) {
    case 'git_host_unavailable':
      return "Publish failed: the repository host isn't answering.";
    case 'pull_request_rejected':
      return 'Publish failed: the repository host rejected the pull request.';
    case 'not_confirmed':
      return "Publish failed: the repository host didn't confirm the pull request.";
    default:
      return 'Publish failed.';
  }
}

// showFieldErrors puts the server's field messages under each field.
export function showFieldErrors(form: HTMLElement, fields: Record<string, string> | undefined): void {
  form.querySelectorAll('.field-error').forEach((node) => node.remove());
  form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
  if (!fields) return;
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const control = form.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (!control) continue;
    control.setAttribute('aria-invalid', 'true');
    const note = document.createElement('p');
    note.className = 'field-error';
    note.textContent = message;
    control.insertAdjacentElement('afterend', note);
    if (!first) first = control;
  }
  first?.focus();
}
