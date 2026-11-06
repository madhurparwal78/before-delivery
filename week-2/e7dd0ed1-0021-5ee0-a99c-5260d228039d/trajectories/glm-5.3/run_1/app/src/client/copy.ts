import { fmtInt, fmtTime, shortVersion } from '../shared/format.js';

/** Feedback copy strings from the brief, kept in one place. */
export const copy = {
  storageOutage: "Farshore can't reach storage right now. Nothing was changed; try again in a minute.",
  stepUpCancelled: 'Nothing changed. Confirmation was cancelled.',
  suspendedBanner: 'This workspace is suspended. Uploads, downloads and share links are paused.',
};

export function bucketStatus(kind: 'creating' | 'created' | 'name' | 'placement' | 'taken', name = '', regions: string[] = []): string {
  switch (kind) {
    case 'creating': return `Creating ${name}…`;
    case 'created': return `Created ${name} in ${regions.join(', ')}.`;
    case 'name': return "This name doesn't meet the bucket naming rules.";
    case 'placement': return 'Choose one origin and up to three other regions.';
    case 'taken': return 'That name is taken. Bucket names are unique across all of Farshore.';
  }
}

export function releaseReadiness(kind: 'ready' | 'waiting' | 'failed', placed: number, short: string, pending = 0, failedCount = 0): string {
  if (kind === 'ready') return `Ready to ship: all ${placed} regions hold version ${short}.`;
  if (kind === 'failed') return `Not ready: ${failedCount} failed. Retry before shipping.`;
  return `Waiting on ${pending} of ${placed} regions.`;
}

export function replicaListLine(name: string, role: string, state: string, settleMs: number | null): string {
  if (state === 'settled' && role === 'origin') return `${name}: origin, settled`;
  if (state === 'settled') return `${name}: settled in ${fmtInt(settleMs ?? 0)} ms`;
  if (state === 'failed') return `${name}: failed`;
  if (state === 'superseded') return `${name}: superseded`;
  return `${name}: pending`;
}

export function replicaAnnouncement(kind: 'settle' | 'fail' | 'retry' | 'new' | 'restored', name = '', settleMs = 0, short = '', regions = 0): string {
  switch (kind) {
    case 'settle': return `${name} settled in ${fmtInt(settleMs)} ms`;
    case 'fail': return `${name} failed`;
    case 'retry': return `${name} retrying`;
    case 'new': return `New version ${short}. Copies pending in ${regions === 1 ? '1 region' : `${regions} regions`}.`;
    case 'restored': return `Restored version ${short}. Copies pending in ${regions === 1 ? '1 region' : `${regions} regions`}.`;
  }
}

export function versionsLine(kind: 'retention' | 'holdOn' | 'holdOff' | 'deleted' | 'refusedRetention' | 'refusedHold' | 'shortening', short: string, until?: string): string {
  switch (kind) {
    case 'retention': return `Version ${short} held until ${fmtTime(until ?? '')}.`;
    case 'holdOn': return `Legal hold on for version ${short}.`;
    case 'holdOff': return `Legal hold off for version ${short}.`;
    case 'deleted': return `Version ${short} deleted.`;
    case 'refusedRetention': return `Version ${short} is held until ${fmtTime(until ?? '')}; it can't be deleted.`;
    case 'refusedHold': return `Version ${short} is on legal hold; it can't be deleted.`;
    case 'shortening': return 'Retention can be extended but not shortened.';
  }
}

export function billingSyncLine(kind: 'in_sync' | 'pending' | 'delayed', confirmedThrough: string | null): string {
  const through = confirmedThrough ? fmtTime(confirmedThrough) : 'nothing yet this month';
  if (kind === 'in_sync') return `Billing in sync. Confirmed through ${through}.`;
  if (kind === 'pending') return 'Billing sync pending. Closed hours post within a minute.';
  return `Billing sync delayed. Metered totals here are complete; billing has confirmed usage through ${through}.`;
}

export function shareStatus(kind: 'pending' | 'success' | 'copied' | 'expiry' | 'revoked' | 'outage', expires?: string): string {
  switch (kind) {
    case 'pending': return 'Creating link…';
    case 'success': return `Link ready. It expires ${fmtTime(expires ?? '')}.`;
    case 'copied': return 'Link copied.';
    case 'expiry': return 'Pick an expiry between one second and seven days.';
    case 'revoked': return 'Link revoked. It stops working on the next request.';
    case 'outage': return copy.storageOutage;
  }
}

export function versionListItem(v: { version_id: string; size: number; created_at: string; current: boolean; noncurrent_since: string | null; retain_until: string | null; legal_hold: boolean }): string {
  let line = `${shortVersion(v.version_id)} · ${fmtInt(v.size)} bytes · ${fmtTime(v.created_at)}`;
  line += v.current ? ', current' : `, noncurrent since ${fmtTime(v.noncurrent_since)}`;
  if (v.retain_until) line += `, held until ${fmtTime(v.retain_until)}`;
  if (v.legal_hold) line += ', legal hold';
  return line;
}
