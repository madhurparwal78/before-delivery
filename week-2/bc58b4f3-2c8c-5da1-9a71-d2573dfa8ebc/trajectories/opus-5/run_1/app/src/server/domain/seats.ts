export const TEAM_LANGUAGE_CODE = 'asl';
export const TEAM_THRESHOLD_MINUTES = 60;

/** An ASL assignment longer than an hour needs a team of two; everything else is a single seat. */
export function seatCountFor(languageCode: string, durationMinutes: number): number {
  return languageCode === TEAM_LANGUAGE_CODE && durationMinutes > TEAM_THRESHOLD_MINUTES ? 2 : 1;
}
