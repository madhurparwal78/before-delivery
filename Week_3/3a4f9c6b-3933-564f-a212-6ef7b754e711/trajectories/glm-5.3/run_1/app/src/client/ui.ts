// Status glyphs, pills and shared small view helpers.

export type GlyphName = 'healthy' | 'progressing' | 'degraded' | 'out_of_sync' | 'not_deployed'
  | 'Synced' | 'OutOfSync' | 'Healthy' | 'Progressing' | 'Missing' | 'bundles' | 'pending';

const STROKE = {
  healthy: 'var(--mint)',
  progressing: 'var(--amber)',
  degraded: 'var(--coral)',
  out_of_sync: 'var(--steel)',
  not_deployed: 'var(--grey)',
  Synced: 'var(--mint)',
  OutOfSync: 'var(--steel)',
  Healthy: 'var(--mint)',
  Progressing: 'var(--amber)',
  Missing: 'var(--grey)',
  bundles: 'var(--amber)',
  pending: 'var(--grey)',
} as const;

function svg(name: GlyphName): string {
  const c = STROKE[name];
  switch (name) {
    case 'healthy':
    case 'Healthy':
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="${c}" stroke-width="1.6"/><path d="M5.2 8.2l1.9 1.9 3.7-4" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'progressing':
    case 'Progressing':
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h11" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M10 5l3 3-3 3" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 8H3" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M6 3L3 6l3 3" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'degraded':
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2L15 13.4H1L8 2.2z" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.4v3.4" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.9" r="0.8" fill="${c}"/></svg>`;
    case 'out_of_sync':
    case 'OutOfSync':
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5h5l2 2" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M9 9.5l-2 2H2" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M14 4.5H9.6l1.2 1.2" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M10.8 10.3l1.2 1.2H14" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    case 'not_deployed':
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="${c}" stroke-width="1.6"/><path d="M3.6 12.4l8.8-8.8" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    case 'Synced':
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h11" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M10 5l3 3-3 3" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'Missing':
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="${c}" stroke-width="1.6"/><path d="M5 6.5h6M5 9.5h4" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    case 'bundles':
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 12v9" stroke="${c}" stroke-width="1.6"/></svg>`;
    case 'pending':
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="${c}" stroke-width="1.6" stroke-dasharray="2.2 2.2"/></svg>`;
  }
}

export function glyph(name: GlyphName): string {
  return `<span class="glyph">${svg(name)}</span>`;
}

export const STATUS_WORDS: Record<string, string> = {
  healthy: 'Healthy',
  progressing: 'Progressing',
  degraded: 'Degraded',
  out_of_sync: 'Out-of-sync',
  not_deployed: 'Not deployed',
  Synced: 'Synced',
  OutOfSync: 'Out-of-sync',
  Healthy: 'Healthy',
  Progressing: 'Progressing',
  Missing: 'Missing',
  Degraded: 'Degraded',
};

// The word shown for a value, never colour alone (DP-09).
export function statusPill(value: string, cls?: string): string {
  const word = STATUS_WORDS[value] ?? value;
  return `<span class="pill ${cls ?? value}">${glyph(value as GlyphName)}<span>${word}</span></span>`;
}

export function statePill(state: string): string {
  const cls = state === 'rolled_back' ? 'rolled_back' : state;
  const word = STATUS_WORDS[state] ?? state.replace(/_/g, ' ');
  return `<span class="pill ${cls}">${glyph(stateToGlyph(state))}<span>${word}</span></span>`;
}

function stateToGlyph(state: string): GlyphName {
  switch (state) {
    case 'healthy': return 'healthy';
    case 'applying':
    case 'health_wait':
    case 'queued':
    case 'window_blocked':
    case 'progressing':
      return 'progressing';
    case 'degraded':
    case 'rejected':
    case 'expired':
      return 'degraded';
    case 'out_of_sync':
    case 'rolled_back':
      return 'out_of_sync';
    case 'awaiting_approval':
    case 'requested':
    case 'approved':
      return 'pending';
    default: return 'not_deployed';
  }
}

export function esc(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | null> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    node.setAttribute(k, v);
  }
  return node;
}
