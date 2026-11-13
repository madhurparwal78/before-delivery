import { Cur, Lang, TierName } from '../shared/types';

export interface Settings {
  mapDebounceMs: number;
  typeDebounceMs: number;
  toastMs: number;
  pageSize: number;
  importMaxBytes: number;
}

export interface Me {
  user: { username: string; role: string; manages: string[] } | null;
  lang: Lang;
  cur: Cur;
  tier: TierName;
  completed_stays: number;
  perks: string[];
}

export const state = {
  settings: { mapDebounceMs: 400, typeDebounceMs: 200, toastMs: 5000, pageSize: 20, importMaxBytes: 1000000 } as Settings,
  me: { user: null, lang: 'en', cur: 'EUR', tier: 'Wren', completed_stays: 0, perks: [] } as Me,
  lang: 'en' as Lang,
  cur: 'EUR' as Cur,
  serverNowMs: Date.now(),
  serverNowAtPage: performance.now(),
};

export function setServerNow(instant: string): void {
  state.serverNowMs = new Date(instant).getTime();
  state.serverNowAtPage = performance.now();
}

/** The server clock, carried forward by page time since it last arrived. */
export function serverNow(): number {
  return state.serverNowMs + (performance.now() - state.serverNowAtPage);
}

export function browserZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}
