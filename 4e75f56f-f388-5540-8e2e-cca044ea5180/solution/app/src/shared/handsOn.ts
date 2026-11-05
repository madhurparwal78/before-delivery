// The hands-on rule, decided once for the server's check and the content desk's live share.

export interface AgendaSession {
  format: string;
  minutes: number;
}

export const HANDS_ON_ERROR = "Hands-on time must stay at least 30% of the agenda.";

/** Hands-on minutes `h` and total minutes `t` over the agenda. */
export function handsOnTotals(sessions: readonly AgendaSession[]): { h: number; t: number } {
  return {
    h: sessions.filter((session) => session.format === "hands-on").reduce((sum, session) => sum + session.minutes, 0),
    t: sessions.reduce((sum, session) => sum + session.minutes, 0),
  };
}

/** The agenda keeps hands-on minutes at no less than 30% of its total minutes: h × 10 ≥ t × 3. */
export function handsOnShareHolds(sessions: readonly AgendaSession[]): boolean {
  const { h, t } = handsOnTotals(sessions);
  return h * 10 >= t * 3;
}

/** `floor(h × 1000 ÷ t) ÷ 10` with exactly one decimal, or `0.0` when t is 0. */
export function handsOnPercent(h: number, t: number): string {
  const tenths = t === 0 ? 0 : Math.floor((h * 1000) / t);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}
