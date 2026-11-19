import type { ExtractInfo } from './events.ts';
import { useExtract } from './events.ts';
import { Status } from '../ui/live.tsx';

/** `2027-05-01T01:00:00.000Z` as `2027-05-01 01:00`, the server's UTC time as written. */
export function utcMinute(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function extractCopy(extract: ExtractInfo | undefined): string {
  if (!extract) return '';
  const success = extract.last_success_at ? utcMinute(extract.last_success_at) : null;
  if (extract.state === 'refresh_failed' && extract.last_failure_at) {
    const failure = utcMinute(extract.last_failure_at);
    return success ? `Refresh failed at ${failure} UTC. Showing data from ${success} UTC.` : `Refresh failed at ${failure} UTC.`;
  }
  if (!success) return '';
  return `${extract.stale ? 'Stale' : 'Fresh'}, refreshed ${success} UTC`;
}

export function nextRefreshCopy(nextRunAt: string | null | undefined): string {
  return nextRunAt ? `Next refresh ${utcMinute(nextRunAt)} UTC` : 'No schedule.';
}

/** `status "Extract state"` for a source, live from the server events. Used by the source, sheet and dashboard pages. */
export function ExtractState({ source }: { source: string }) {
  const extract = useExtract(source);
  return <Status name="Extract state" text={extractCopy(extract)} ok={extract?.state !== 'refresh_failed'} />;
}
