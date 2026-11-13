/**
 * Every piece of published copy lives here. Straight apostrophes, ASCII hyphens
 * and three full stops only; callers pass the values the brief marks as placeholders.
 */

export const s = {
  liveOn: "Live",
  liveOff: "Live updates are off. Your work is still saved.",
  notFound: "Not found.",
  loading: "Loading...",
  pageError: "This page could not be loaded. Reload to try again.",
  noPatterns: "No patterns yet. Start one from the sample or a blank chart.",
  useSample: "Use the sample",
  sampleName: "Sample swatch",
  allRowsOk: "All rows check out.",
  noColourWarnings: "No colour warnings.",
  noRepeats: "No repeats yet.",
  viewerYou: "(you)",
  emptyRow: "This row has no stitches.",
  signOut: "Sign out",
  settingsSaved: "Saved.",
  checkEmail: "Check your email to verify your account.",
  verified: "Your email is verified.",
  linkExpired: "This link has expired. Sign up again to get a new one.",
  inviteExpired: "This invitation has expired. Ask the designer for a new one.",
  inviteUsed: "This invitation has already been used.",
  mailFailed: "The mail could not be sent. Try again.",
  reduceMotion: "Reduce motion",
  downloadSheet: "Download sheet",
  signInLink: "Sign in",
  publishNoVersion: "Save a version before publishing.",
} as const;

/** Field errors, keyed by the API field name they belong to. */
export const fieldErrors = {
  patternNameEmpty: "Give the pattern a name.",
  patternNameLong: "A pattern name can be 120 characters at most.",
  rows: "Rows must be from 1 to <max>.",
  columns: "Columns must be from 1 to <max>.",
  castOn: "Cast on must be at least 1.",
  colourName: "Enter a colour name.",
  colourHex: "Enter a colour as # and six hex digits.",
  tooManyColours: "A pattern can have <max> colours.",
  coDesigner: "No Twinrow account has that email.",
  testerEmail: "Enter a valid email address.",
  alreadyTesting: "That person is already testing this pattern.",
  noVersionInvite: "Save a version before inviting testers.",
  versionNote: "A version note can be 200 characters at most.",
  noteEmpty: "Write a note first.",
  noteLong: "A note can be <max> characters at most.",
  nameEmpty: "Enter your name.",
  emailInvalid: "Enter a valid email address.",
  passwordShort: "A password needs at least 10 characters.",
  emailTaken: "That email already has an account.",
  signInBad: "Email or password is incorrect.",
  unverified: "Verify your email first.",
  passwordWrong: "That password is not right.",
  onlyLatestVersion: "Only the latest version can be followed.",
} as const;

export function bind(text: string, values: Record<string, string | number>): string {
  return text.replace(/<([a-zA-Z]+)>/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

export const apiErrors = {
  unauthenticated: "unauthenticated",
  notFound: "not_found",
  invalid: "invalid",
  tooLarge: "too_large",
  unsupportedType: "unsupported_media_type",
  rateLimited: "rate_limited",
  mailUnavailable: "mail_unavailable",
} as const;

export function rowNeeds(row: number, needed: number, used: number): string {
  return `Row ${row} needs ${needed} ${needed === 1 ? "stitch" : "stitches"}, found ${used}.`;
}

export function cableNeeds(row: number): string {
  return `Row ${row}: a 2/2 cable needs 4 cells.`;
}

export function cableWrongSide(row: number): string {
  return `Row ${row}: 2/2 LC can only be worked on a right-side row.`;
}

export function colourLimit(row: number, used: number, limit: number): string {
  return `Row ${row} uses ${used} colours, the limit is ${limit}.`;
}

export function floatTooLong(row: number, length: number, letter: string): string {
  return `Row ${row}: float of ${length} stitches in colour ${letter}.`;
}

export function textRepeatDoesNotFit(row: number, position: number, needed: number): string {
  return `Row ${row}, position ${position}: the repeat does not fit ${needed} stitches.`;
}

export function textNeedsCells(row: number, cells: number, width: number): string {
  return `Row ${row}, position 1: the text needs ${cells} cells, the chart is ${width} wide.`;
}

export function textClosingCount(row: number, position: number, says: number, made: number): string {
  return `Row ${row}, position ${position}: the closing count says ${says} ${says === 1 ? "st" : "sts"}, the row makes ${made}.`;
}

export function textRepeatBox(row: number, repeatId: string): string {
  return `Row ${row}: expand repeat ${repeatId} before editing this row as text.`;
}

export function textError(
  row: number,
  position: number | null,
  kind: "label" | "unknown" | "separator" | "wrongSide" | "rightSide" | "terms" | "colour",
  detail: string,
  terms: "US" | "UK",
): string {
  const at = position === null ? "" : `, position ${position}`;
  switch (kind) {
    case "label":
      return `Row ${row}${at}: the label says ${detail}.`;
    case "unknown":
      return `Row ${row}${at}: unknown stitch "${detail}".`;
    case "separator":
      return `Row ${row}${at}: expected a comma or a full stop.`;
    case "wrongSide":
      return `Row ${row}${at}: ${detail} is not valid on a wrong-side row.`;
    case "rightSide":
      return `Row ${row}${at}: ${detail} is not valid on a right-side row.`;
    case "terms":
      return `Row ${row}${at}: ${detail} is not valid in ${terms} terms.`;
    case "colour":
      return `Row ${row}${at}: colour ${detail} is not in the key.`;
  }
}

/** Conflict lines. */
export function conflictLine(by: string, row: number, col: number): string {
  return `${by} changed row ${row}, column ${col} first. Your change was not kept.`;
}

export function conflictMore(count: number): string {
  return `and ${count} more ${count === 1 ? "cell." : "cells."}`;
}

/** Chart sync copy. */
export const sync = {
  rowUpdated: (row: number, changed: number) =>
    `Row ${row} updated: ${changed} ${changed === 1 ? "cell" : "cells"} changed.`,
  pasted: (count: number) => `Pasted ${count} ${count === 1 ? "cell." : "cells."}`,
  pastedPartial: (pasted: number, total: number, dropped: number) =>
    `Pasted ${pasted} of ${total} cells. ${dropped === 1 ? "1 was" : `${dropped} were`} past the edge.`,
  selected: (rows: number, cols: number) =>
    `Selected ${rows === 1 ? "1 row" : `${rows} rows`} by ${cols === 1 ? "1 column" : `${cols} columns`}.`,
  overlap: "Repeat boxes cannot overlap.",
  expanded: (id: string, added: number) =>
    `Repeat ${id} expanded: ${added === 1 ? "1 column added." : `${added} columns added.`}`,
  tooWide: (max: number) => `That is wider than the ${max} column limit.`,
  timesRange: "Times must be from 2 to 20.",
  mirrorBox: "Mirror cannot cross a repeat box.",
  undoSkipped: (count: number, by: string) =>
    count === 1
      ? `1 cell left as ${by} changed it.`
      : `${count} cells left as ${by} changed them.`,
  versionSaved: (version: number) => `Version ${version} saved.`,
  restored: (from: number, next: number) => `Restored version ${from} as version ${next}.`,
  published: (version: number) => `Published version ${version}.`,
  testerInvited: (email: string) => `Invitation sent to ${email}.`,
  coDesignerAdded: (name: string) => `${name} can now edit this pattern.`,
  saveFailed: "That change was not saved. Try again.",
} as const;

export const announces = {
  placed: (name: string, row: number, col: number) => `Placed ${name} at row ${row}, column ${col}.`,
  rowCorrect: (row: number) => `Row ${row} is correct.`,
  rowChanged: (row: number) => `Row ${row} changed while you were typing.`,
  publishFix: (count: number) =>
    `Fix ${count} ${count === 1 ? "row error" : "row errors"} before publishing.`,
  publishNoVersion: "Save a version before publishing.",
  noteSaved: (row: number) => `Note saved on row ${row}.`,
  versionOut: (latest: number, following: number) =>
    `Version ${latest} is out. You are following version ${following}.`,
  versionMoved: (version: number) => `Version ${version}`,
  versionRowGone: (version: number, row: number) =>
    `Version ${version}. Row ${row} is not in this version.`,
  counter: (row: number, height: number) => `Row ${row} of ${height}`,
  restoreDialog: (next: number, from: number) =>
    `This makes version ${next} from version ${from}. Nothing is deleted.`,
} as const;

