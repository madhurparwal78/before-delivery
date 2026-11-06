export interface AgendaMinutes {
  readonly handsOnMinutes: number;
  readonly totalMinutes: number;
}

export interface SessionMinutes {
  readonly format: 'lecture' | 'hands-on';
  readonly minutes: number;
}

export function agendaMinutes(sessions: readonly SessionMinutes[]): AgendaMinutes {
  let handsOnMinutes = 0;
  let totalMinutes = 0;
  for (const session of sessions) {
    totalMinutes += session.minutes;
    if (session.format === 'hands-on') handsOnMinutes += session.minutes;
  }
  return { handsOnMinutes, totalMinutes };
}

/** Hands-on minutes must stay at least 30% of the agenda. Exactly 30% is allowed. */
export function handsOnShareHolds({ handsOnMinutes, totalMinutes }: AgendaMinutes): boolean {
  return handsOnMinutes * 10 >= totalMinutes * 3;
}

/** The share printed with exactly one decimal. */
export function handsOnSharePercent({ handsOnMinutes, totalMinutes }: AgendaMinutes): string {
  if (totalMinutes === 0) return '0.0';
  const tenths = Math.floor((handsOnMinutes * 1000) / totalMinutes);
  return (tenths / 10).toFixed(1);
}
