import type { WorkspaceDto } from '../shared/types.js';
import { dayLabel } from '../shared/time.js';
import { RequestFailed } from './api.js';

const REASONS: Record<string, string> = {
  version_conflict: 'it was changed on another device',
  workspace_read_only: 'this workspace is read-only',
  day_in_past: 'that day has already passed',
  already_scheduled: "it's already on the calendar",
  estimate_required: 'add an estimate first',
  crosses_midnight: 'it would run past midnight',
};

export function reasonOf(error: unknown): string {
  if (error instanceof RequestFailed) {
    return REASONS[error.code] ?? "the server didn't respond";
  }
  return "the server didn't respond";
}

export function minutes(value: number): string {
  return `${value}m`;
}

export function overByLabel(over: number): string {
  return `Over by ${over}m`;
}

export function subscriptionCopy(workspace: WorkspaceDto): string | null {
  switch (workspace.state) {
    case 'trialing': {
      const remaining = Math.max(
        1,
        Math.ceil((new Date(workspace.trialEndsAt).getTime() - Date.now()) / 86_400_000),
      );
      return remaining === 1 ? 'Trial: 1 day left' : `Trial: ${remaining} days left`;
    }
    case 'past_due':
      return 'Payment failed. Planning stays open while billing retries.';
    case 'read_only':
      return 'This workspace is read-only. Planning resumes when the subscription is active.';
    case 'cancelled':
      return 'This subscription is cancelled. Your plans stay readable.';
    case 'active':
      return null;
  }
}

export function trialEndCopy(trialEndsAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(trialEndsAt));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '01';
  return dayLabel(`${read('year')}-${read('month')}-${read('day')}`);
}

export function importSummary(result: {
  created: number;
  updated: number;
  unchanged: number;
  merged: number;
  rejected: { line: number; reason: string }[];
  orphaned: { externalId: string; title: string }[];
}): string {
  let copy = `Imported: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged.`;
  if (result.merged > 0) copy += ` ${result.merged} merged.`;
  if (result.rejected.length > 0) copy += ` ${result.rejected.length} rows skipped.`;
  if (result.orphaned.length > 0) copy += ` ${result.orphaned.length} not in this file.`;
  return copy;
}

export function calendarImportSummary(result: {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}): string {
  return `Calendar imported: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped.`;
}
