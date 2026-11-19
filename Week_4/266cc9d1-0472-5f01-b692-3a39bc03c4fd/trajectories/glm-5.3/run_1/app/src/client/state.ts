import { api, type Staff, type Corridor, type Tower, type Finding, type SetRecord, type Asset, type FlightAnswer } from './api.js';
import { clamp, summaryLine } from './format.js';

/**
 * Workspace state: the scrub sequence and the "latest scrub input wins" rule
 * live here, in one place.
 */

export type ScrubState = {
  chainage: number;
  spanFrom: number;
  spanTo: number;
  nearFindings: string[];
  flight: FlightAnswer | null;
  flightSeq: number;
  flightPending: boolean;
};

export type CameraPose = { lon: number; lat: number; height: number; heading: number; pitch: number };

export type ViewStatus = {
  storage: 'ok' | 'unreachable';
  mail: 'ok' | 'unreachable';
  checkedAt: string | null;
};

export type WorkspaceData = {
  corridor: Corridor;
  towers: Tower[];
  activeAssets: { tileset: string | null; terrain: string | null; czml: string | null };
  coverage: Array<{ from_m: number; to_m: number }>;
  set: SetRecord | null;
  findings: Finding[];
  assets: Asset[];
};

export function spanFor(towers: Tower[], chainage: number): { from: number; to: number; label: string } {
  for (let i = 0; i < towers.length - 1; i++) {
    if (chainage >= towers[i].chainage_m && chainage < towers[i + 1].chainage_m) {
      return { from: towers[i].number, to: towers[i + 1].number, label: `Span ${towers[i].number}–${towers[i + 1].number}` };
    }
  }
  const last = towers[towers.length - 1];
  return { from: towers[towers.length - 2].number, to: last.number, label: `Span ${towers[towers.length - 2].number}–${last.number}` };
}

export function nearFindings(findings: Finding[], chainage: number, reach = 25): Finding[] {
  return findings.filter((f) => Math.abs(f.chainage_m - chainage) <= reach);
}

export function valueText(findings: Finding[], chainage: number, span: { from: number; to: number }, corridorLength: number): string {
  const k = nearFindings(findings, chainage).length;
  const c = Math.round(chainage);
  const near = k === 0 ? 'no findings nearby' : k === 1 ? '1 finding nearby' : `${k} findings nearby`;
  void corridorLength;
  return `Chainage ${c.toLocaleString('en-US')} metres, span ${span.from} to ${span.to}, ${near}`;
}

/** Where the corridor's chainage is not covered by flight. */
export function uncoveredRanges(coverage: Array<{ from_m: number; to_m: number }>, length: number): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  for (const c of [...coverage].sort((a, b) => a.from_m - b.from_m)) {
    if (c.from_m > cursor + 0.05) out.push({ from: cursor, to: c.from_m });
    cursor = Math.max(cursor, c.to_m);
  }
  if (cursor < length - 0.05) out.push({ from: cursor, to: length });
  return out.filter((r) => r.to - r.from > 0.05);
}

export function isCovered(coverage: Array<{ from_m: number; to_m: number }>, chainage: number): boolean {
  return coverage.some((c) => chainage >= c.from_m && chainage <= c.to_m);
}

/** Nearest tower chainage strictly before/after the playhead. */
export function towerStep(towers: Tower[], chainage: number, dir: 'prev' | 'next'): number | null {
  const chainages = towers.map((t) => t.chainage_m);
  if (dir === 'prev') {
    const before = chainages.filter((c) => c < chainage);
    return before.length > 0 ? Math.max(...before) : null;
  }
  const after = chainages.filter((c) => c > chainage);
  return after.length > 0 ? Math.min(...after) : null;
}

export function violationsOf(findings: Finding[]): number {
  return findings.filter((f) => f.status === 'violation').length;
}

export function railSummary(findings: Finding[]): string {
  return summaryLine(findings.length, violationsOf(findings));
}

/** URL view state. */
export type UrlView = { ch?: number; t?: string; f?: string; cam?: CameraPose };

export function parseViewParams(params: URLSearchParams): UrlView {
  const out: UrlView = {};
  const ch = params.get('ch');
  if (ch !== null && Number.isFinite(Number(ch))) out.ch = Number(ch);
  const t = params.get('t');
  if (t !== null) out.t = t;
  const f = params.get('f');
  if (f !== null) out.f = f;
  const cam = params.get('cam');
  if (cam) {
    const parts = cam.split(',').map(Number);
    if (parts.length === 5 && parts.every((p) => Number.isFinite(p))) {
      out.cam = { lon: parts[0], lat: parts[1], height: parts[2], heading: parts[3], pitch: parts[4] };
    }
  }
  return out;
}

export function formatViewUrl(base: string, view: UrlView): string {
  const params = new URLSearchParams();
  if (view.ch !== undefined) params.set('ch', view.ch.toFixed(1));
  if (view.t !== undefined) params.set('t', view.t);
  if (view.f !== undefined) params.set('f', view.f);
  if (view.cam !== undefined) {
    params.set('cam', `${view.cam.lon.toFixed(7)},${view.cam.lat.toFixed(7)},${view.cam.height.toFixed(1)},${view.cam.heading.toFixed(1)},${view.cam.pitch.toFixed(1)}`);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function loadSession(): Promise<Staff | null> {
  try {
    const r = await api<{ staff: Staff }>('/api/session');
    return r.staff;
  } catch {
    return null;
  }
}

export async function loadWorkspace(corridorId: string): Promise<WorkspaceData> {
  const detail = await api<{ corridor: Corridor; towers: Tower[]; active_assets: WorkspaceData['activeAssets']; coverage: WorkspaceData['coverage'] }>(
    `/api/corridors/${corridorId}`
  );
  let set: SetRecord | null = null;
  let findings: Finding[] = [];
  if (detail.corridor.current_set) {
    try {
      const setRes = await api<{ set: SetRecord; findings: Finding[] }>(`/api/findings-sets/${detail.corridor.current_set.id}`);
      set = setRes.set;
      findings = setRes.findings;
    } catch { /* set may be closed; corridor still shows it */ }
  }
  let assets: Asset[] = [];
  try {
    const assetRes = await api<{ assets: Asset[] }>(`/api/corridors/${corridorId}/assets`);
    assets = assetRes.assets;
  } catch { assets = []; }
  return {
    corridor: detail.corridor,
    towers: detail.towers,
    activeAssets: detail.active_assets,
    coverage: detail.coverage ?? [],
    set,
    findings,
    assets,
  };
}

export function stepChainage(current: number, delta: number, length: number): number {
  return clamp(current + delta, 0, length);
}
