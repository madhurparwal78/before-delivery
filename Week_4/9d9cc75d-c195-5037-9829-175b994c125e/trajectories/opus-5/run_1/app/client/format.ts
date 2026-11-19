export function utcStamp(iso: string | null): string {
  if (iso === null) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export interface ExtractStateLike {
  state: 'live' | 'refreshing' | 'refresh_failed';
  stale: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  next_run_at: string | null;
}

export function extractStateText(state: ExtractStateLike): string {
  if (state.state === 'refresh_failed') {
    return `Refresh failed at ${utcStamp(state.last_failure_at)} UTC. Showing data from ${utcStamp(state.last_success_at)} UTC.`;
  }
  const stamp = utcStamp(state.last_success_at);
  return `${state.stale ? 'Stale' : 'Fresh'}, refreshed ${stamp} UTC`;
}

export function nextRefreshText(state: ExtractStateLike): string {
  if (state.next_run_at === null) return 'No schedule.';
  return `Next refresh ${utcStamp(state.next_run_at)} UTC`;
}
