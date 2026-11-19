import type { Category, EnrollmentStatus, RosterRow, SharedEntry } from "../../shared/api.js";
import { tallies } from "./signs.js";
import { NIGHTS } from "./time.js";

export interface RosterEntry {
  id: string;
  nightKey: string;
  nightNumber: number;
  title: string;
  text: string;
  dreamsRecalled: number;
  wbtb: boolean;
  techniqueMinutes: number;
  shared: boolean;
  hasMemo: boolean;
}

interface RosterDreamer {
  enrollmentId: string;
  displayName: string;
  status: EnrollmentStatus;
  currentNight: number;
  entries: readonly RosterEntry[];
  signCategories: readonly Category[];
  realityChecks: number;
}

/** count / total rounded to two decimals with halves up, using integers only. */
function rateHalfUp(count: number, total: number): number {
  return Math.floor((200 * count + total) / (2 * total)) / 100;
}

/** One dreamer's aggregates. Only nights 1 to 28 count, by their stored night keys. */
export function rosterRow(dreamer: RosterDreamer): RosterRow {
  const counted = dreamer.entries.filter((entry) => entry.nightNumber >= 1 && entry.nightNumber <= NIGHTS);
  const nightsElapsed = Math.max(0, Math.min(dreamer.currentNight, NIGHTS));
  const nightsWhere = (keep: (entry: RosterEntry) => boolean): number =>
    new Set(counted.filter(keep).map((entry) => entry.nightKey)).size;
  const recalledNights = nightsWhere((entry) => entry.dreamsRecalled >= 1);
  // Sharing ends with the seat: a refunded dreamer's entries never reach the coach.
  const sharedEntries: SharedEntry[] = counted
    .filter((entry) => entry.shared && dreamer.status === "active")
    .map((entry) => ({
      entry_id: entry.id,
      night_key: entry.nightKey,
      title: entry.title,
      text: entry.text,
      has_memo: entry.hasMemo,
    }));
  return {
    enrollment_id: dreamer.enrollmentId,
    display_name: dreamer.displayName,
    status: dreamer.status,
    night_number: Math.max(0, dreamer.currentNight),
    nights_logged: nightsWhere(() => true),
    recall_rate: nightsElapsed === 0 ? 0 : rateHalfUp(recalledNights, nightsElapsed),
    technique_minutes: counted.reduce((sum, entry) => sum + entry.techniqueMinutes, 0),
    wbtb_nights: nightsWhere((entry) => entry.wbtb),
    reality_checks: dreamer.realityChecks,
    sign_tallies: tallies(dreamer.signCategories.map((category) => ({ category }))),
    shared_entries: sharedEntries,
  };
}

/** The digest line of one roster row, in the brief's words. */
export function digestLine(row: RosterRow): string {
  const t = row.sign_tallies;
  return (
    `${row.display_name}: recall ${Math.round(row.recall_rate * 100)}%, technique ${row.technique_minutes} min, ` +
    `WBTB nights ${row.wbtb_nights}, reality checks ${row.reality_checks}, ` +
    `signs inner awareness ${t.inner_awareness} / action ${t.action} / form ${t.form} / context ${t.context}`
  );
}

/** The digest's closing line: the cohort-wide sign tallies over the given rows. */
export function cohortSignsLine(rows: readonly RosterRow[]): string {
  const sum = (category: Category): number => rows.reduce((total, row) => total + row.sign_tallies[category], 0);
  return (
    `Cohort signs: inner awareness ${sum("inner_awareness")} / action ${sum("action")} / ` +
    `form ${sum("form")} / context ${sum("context")}`
  );
}
