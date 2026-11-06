/**
 * Effective-dated station settings. A booking stores the values in force on
 * the kitchen date it was created, and a later row never reaches back.
 */

export interface SettingsRow {
  station_id: string;
  effective_from: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  buffer_minutes: number;
}

/** The row with the latest `effective_from` on or before `onDate`. */
export function settingsInForce(
  rows: readonly SettingsRow[],
  onDate: string,
): SettingsRow | null {
  return (
    [...rows]
      .filter((row) => row.effective_from <= onDate)
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null
  );
}

export function upcomingSettings(
  rows: readonly SettingsRow[],
  onDate: string,
): SettingsRow[] {
  return [...rows]
    .filter((row) => row.effective_from > onDate)
    .sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
}
