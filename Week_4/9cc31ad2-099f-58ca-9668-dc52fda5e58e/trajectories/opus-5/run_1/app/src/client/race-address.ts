import { isLayoutId, type LayoutId, type RaceMode } from '../shared/catalogue.js';

export interface RaceAddress {
  layoutId: LayoutId;
  mode: RaceMode;
  eventId: string | null;
  laps: number | null;
  ghostRunId: string | null;
}

export const GUIDED_FIRST_RACE_ADDRESS =
  '/race?layout=saltflat-ring&mode=practice&event=guided-first-race';

export function parseRaceAddress(search: string): RaceAddress | null {
  const params = new URLSearchParams(search);
  const layoutId = params.get('layout');
  const mode = params.get('mode');
  if (!isLayoutId(layoutId)) return null;
  if (mode !== 'practice' && mode !== 'circuit' && mode !== 'drift' && mode !== 'time-trial') {
    return null;
  }
  const laps = params.get('laps');
  return {
    layoutId,
    mode,
    eventId: params.get('event'),
    laps: laps === null ? null : Number.parseInt(laps, 10),
    ghostRunId: params.get('ghost'),
  };
}

export function raceAddress(address: {
  layoutId: string;
  mode: string;
  eventId?: string | null;
  laps?: number | null;
  ghostRunId?: string | null;
}): string {
  let path = `/race?layout=${address.layoutId}&mode=${address.mode}`;
  if (address.eventId) path += `&event=${address.eventId}`;
  if (address.laps) path += `&laps=${address.laps}`;
  if (address.ghostRunId) path += `&ghost=${address.ghostRunId}`;
  return path;
}
