import {
  HOUR_MS,
  formatInstantSeconds,
  offsetLabel,
  zoneAbbreviation,
} from './porttime.ts';

export const NOTICE_HOURS = 2;

export type NoticeCutoff = {
  instant: number;
  cutoff_at: string;
  cutoff_utc_offset: string;
};

/** The boarding instant minus exactly 2 hours of real time, as port-local wall clock. */
export function noticeCutoff(boardingInstant: number): NoticeCutoff {
  const instant = boardingInstant - NOTICE_HOURS * HOUR_MS;
  return {
    instant,
    cutoff_at: formatInstantSeconds(instant),
    cutoff_utc_offset: offsetLabel(instant),
  };
}

/** Exactly at the cutoff is on time. */
export function noticeState(boardingInstant: number, serverNow: number): 'on_time' | 'late' {
  return serverNow > noticeCutoff(boardingInstant).instant ? 'late' : 'on_time';
}

/** "2027-03-14 00:30 AST" on the move screen. */
export function cutoffDisplay(cutoff: NoticeCutoff): string {
  const stamp = cutoff.cutoff_at.slice(0, 16).replace('T', ' ');
  return `${stamp} ${zoneAbbreviation(cutoff.instant)}`;
}
