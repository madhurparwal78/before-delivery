// Every user-facing sentence the brief pins (Feedback states), in one place.
import { stationTimeLabel } from "../shared/time.js";
import { type Limits, type Role, type SeasonState } from "./types.js";

const digits = (n: number): string => n.toLocaleString("en-US");

/** "1 edit", "2 edits": the singular is used for one. */
export function count(n: number, noun: "edit" | "cell" | "sheet"): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export const SEASON_CHIP: Record<SeasonState, string> = { draft: "Draft", in_season: "In season", locked: "Locked", archived: "Archived" };
export const SEASON_WORD: Record<SeasonState, string> = { draft: "draft", in_season: "in season", locked: "locked", archived: "archived" };

export const ROLE_LABEL: Record<Role, string> = { viewer: "Viewer", technician: "Technician", lead: "Trial lead", data_manager: "Data manager" };

export const REASON_TEXT: Record<string, string> = {
  season_locked: "the season is closed",
  season_archived: "the workbook is archived",
  role_cannot_edit: "your role can't make this edit right now",
  sheet_missing: "that sheet no longer exists",
  invalid_op: "the edit was not valid",
  conflict_resolved: "that conflict was already resolved",
};

export const localTime = (iso: string, zone: string): string => stationTimeLabel(Date.parse(iso), zone);

export function importLimitLines(l: Limits): string[] {
  return [
    `Files up to ${digits(l.maxImportBytes)} bytes`,
    `Up to ${digits(l.maxImportExpandedBytes)} bytes once unzipped`,
    `Compressed no more than ${digits(l.maxCompressionRatio)} to 1`,
    `Up to ${digits(l.maxSheets)} sheets`,
    `Up to ${digits(l.maxImportCells)} filled cells`,
    `Columns A–Z and rows 1–${digits(l.maxRows)}`,
  ];
}

export function importError(code: string, status: number, limit: number | null): string {
  const l = limit === null ? "" : digits(limit);
  if (status === 413) return `That file is larger than ${l} bytes.`;
  if (status === 415) return "That file isn't a real .xlsx or .csv workbook.";
  if (status === 503) return "File storage is unavailable, so nothing was imported. Try again when the banner clears.";
  switch (code) {
    case "archive_too_large":
      return `That file expands past ${l} bytes, so it wasn't opened.`;
    case "archive_too_compressed":
      return `That file is compressed more than ${l} to 1, so it wasn't opened.`;
    case "unsafe_archive":
      return "That file contains unsafe paths and was rejected.";
    case "too_many_sheets":
      return `That file has more than ${l} sheets.`;
    default:
      return `That file has more than ${l} filled cells or goes past column Z or row 500.`;
  }
}

export const COPY = {
  wrongCredentials: "Email or password is wrong.",
  workbookName: "Give the workbook a name of 1 to 80 characters.",
  readOnly: "This workbook is read-only for you right now.",
  sheetName: "Use 1 to 31 characters, none of ' ! [ ] : * ? / \\, and a name no other sheet has.",
  chartRange: "Enter a range on this sheet of at least 2 rows and 2 columns, like A1:B4.",
  chartTitle: "Give the chart a title of 1 to 60 characters.",
  cutoffFormat: "Enter a date and time as YYYY-MM-DD HH:MM.",
  versionLabel: "Give the version a label of 1 to 60 characters.",
  storageVersions: "File storage is unavailable, so versions can't be saved or restored right now.",
  exportQueued: "Export queued. We'll email you when it's ready.",
  linkLength: "Pick how long the link should last.",
  pickZone: "Pick a time zone from the list.",
  shortPassword: "Use at least 10 characters.",
  usedInvite: "This invite has already been used or does not exist.",
  emptyTray: "No conflicts. Every edit you made is saved.",
  storageBanner: "File storage is unavailable. Editing and sync still work; imports, exports and versions will resume when it returns.",
  mailBanner: "Email is delayed. Invites, export notices and season-close notices are queued and will send when mail returns.",
  notFoundHeading: "Workbook not found",
  notFoundLine: "It may have been removed, or it belongs to another station.",
  shareGone: "This link has expired or was turned off.",
};

export function recalcAnnouncement(ref: string, cells: number, sheets: number): string {
  return cells === 0 ? `Edit to ${ref} changed no other cells.` : `Edit to ${ref} updated ${count(cells, "cell")} on ${count(sheets, "sheet")}.`;
}

export function rolledBack(target: string, reason: string): string {
  return `Edit to ${target} was rolled back: ${REASON_TEXT[reason] ?? REASON_TEXT.invalid_op}.`;
}
