// The exact copy of the brief's Feedback states.
import { filesWord } from "./format";
import type { MoveResult, Notice } from "../shared/api";

export const STORAGE_OUTAGE = "File storage is unreachable. Uploads are paused and previews are unavailable until it returns.";
export const STORAGE_BACK = "File storage is back.";
export const UPLOADS_RESUMED = " Waiting uploads have resumed.";
export const PREVIEW_OUTAGE = "Preview unavailable while file storage is unreachable.";
export const SIGN_IN_OUTAGE = "Sign-in is unavailable while the people directory is unreachable. Anyone already signed in can keep working.";
export const PICKER_OUTAGE = "The people directory is unreachable. Existing access is unchanged. Try again in a moment.";
export const WRONG_CREDENTIALS = "Email or password is incorrect.";
export const MOVE_FAILED = "Move failed. Nothing was moved.";
export const SOMETHING_WRONG = "Something went wrong. Nothing was changed.";
export const TOO_BIG = "Files can be up to 2,000,000,000 bytes.";
export const POLICY_STARTED = "This change has already started.";
export const FOOTNOTE = "All dates and times are Phoenix time.";
export const UNAVAILABLE_FOLDER = "This folder is not available to you.";
export const EMPTY_FOLDER = "This folder is empty.";
export const NOTHING_SHARED = "Nothing is shared with you right now.";
export const BIN_EMPTY = "The bin is empty.";
export const NO_PREVIEW = "No preview for this file type.";

export function selectedCopy(n: number): string {
  return n === 0 ? "Selection cleared" : `${n} selected`;
}

function lockedStayed(k: number): string {
  return `${k} locked ${k === 1 ? "file" : "files"} stayed`;
}

export function lostSentence(name: string, folder: string, person: string): string {
  return `${name} was already moved to ${folder} by ${person}`;
}

/** The move announcement: moved count, locked files that stayed, and up to three files others moved first. */
export function moveCopy(result: MoveResult, nameOf: (fileId: string) => string): string {
  const parts = [result.moved.length ? `Moved ${filesWord(result.moved.length)} to ${result.toFolder.name}` : "No files moved"];
  if (result.stayed.length) parts.push(lockedStayed(result.stayed.length));
  for (const lost of result.lostTo.slice(0, 3)) parts.push(lostSentence(nameOf(lost.fileId), lost.folder.name, lost.by.name));
  if (result.lostTo.length > 3) parts.push(`${result.lostTo.length - 3} more were moved by others first`);
  return parts.join(". ");
}

export function binCopy(binned: number, stayed: number): string {
  return `Moved ${filesWord(binned)} to the bin${stayed ? `. ${lockedStayed(stayed)}` : ""}`;
}

export function noticeCopy(notice: Notice): string {
  switch (notice.kind) {
    case "access_ended":
      return `Your access to ${notice.item} ended at the end of ${notice.date}, Phoenix time.`;
    case "editor_ended":
      return `Your editor access to ${notice.item} ended at the end of ${notice.date}, Phoenix time. You can still view it.`;
    case "view_only":
      return `Your access to ${notice.item} is now view only.`;
    case "removed":
      return `Your access to ${notice.item} has been removed.`;
    case "handover_accepted":
      return `${notice.person} accepted ${notice.folder}.`;
    case "handover_declined":
      return `${notice.person} declined ${notice.folder}.`;
    case "handover_lapsed":
      return `Your handover of ${notice.folder} to ${notice.person} lapsed. You still own it.`;
  }
}

export const noLongerEditable = (item: string) => `You no longer have edit access to ${item}.`;
export const noLongerAvailable = (item: string) => `${item} is no longer available to you.`;
