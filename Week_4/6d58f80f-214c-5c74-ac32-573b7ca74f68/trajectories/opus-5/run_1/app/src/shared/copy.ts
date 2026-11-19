import type { Role } from './types.js';

export const STORAGE_OUTAGE =
  'File storage is unreachable. Uploads are paused and previews are unavailable until it returns.';
export const STORAGE_BACK = 'File storage is back.';
export const STORAGE_BACK_RESUMED = 'File storage is back. Waiting uploads have resumed.';
export const DIRECTORY_SIGN_IN_OUTAGE =
  'Sign-in is unavailable while the people directory is unreachable. Anyone already signed in can keep working.';
export const DIRECTORY_PICKER_OUTAGE =
  'The people directory is unreachable. Existing access is unchanged. Try again in a moment.';
export const PREVIEW_OUTAGE = 'Preview unavailable while file storage is unreachable.';
export const PREVIEW_UNSUPPORTED = 'No preview for this file type.';
export const SIGN_IN_REJECTED = 'Email or password is incorrect.';
export const GENERIC_FAILURE = 'Something went wrong. Nothing was changed.';
export const MOVE_FAILED = 'Move failed. Nothing was moved.';
export const EMPTY_FOLDER = 'This folder is empty.';
export const SHARED_EMPTY = 'Nothing is shared with you right now.';
export const BIN_EMPTY = 'The bin is empty.';
export const FOLDER_UNAVAILABLE = 'This folder is not available to you.';
export const HIDDEN_FOLDER_NAME = 'another folder';
export const PHOENIX_FOOTNOTE = 'All dates and times are Phoenix time.';
export const SELECTION_CLEARED = 'Selection cleared';
export const POLICY_ALREADY_STARTED = 'This change has already started.';

export const NAME_REQUIRED = 'Enter a name.';
export const NAME_TOO_LONG = 'Names can be up to 120 characters.';
export const NAME_BAD_CHARS = 'Names cannot contain / or \\.';
export const SIZE_LIMIT = 'Files can be up to 2,000,000,000 bytes.';
export const GRANTS_STAFF_ONLY = 'Only outside partners get timed access.';
export const HANDOVER_PERSON = 'Choose a staff member other than the current owner.';
export const HANDOVER_DAYS = 'Enter whole days from 1 to 14.';
export const BIN_DAYS = 'Enter whole days from 1 to 90.';
export const GRANT_DAYS = 'Enter whole days from 1 to 365.';
export const POLICY_DATE = 'Choose a date after today.';

export const files = (n: number): string => (n === 1 ? '1 file' : `${n} files`);
export const lockedFiles = (k: number): string => (k === 1 ? '1 locked file' : `${k} locked files`);
export const daysLeftText = (n: number): string =>
  n === 0 ? 'Last day' : n === 1 ? '1 day left' : `${n} days left`;
export const binDaysLeftText = (n: number, retention: number, pending: boolean): string =>
  pending
    ? `Purge pending · ${retention}-day rule`
    : `${n === 1 ? '1 day left' : `${n} days left`} · ${retention}-day rule`;

export const dateRangeError = (today: string, max: string): string =>
  `Choose a date from ${today} to ${max}.`;
export const grantExists = (person: string, item: string): string =>
  `${person} already has access to ${item}. Change it in the list below.`;
export const policyExists = (date: string): string => `A change is already scheduled for ${date}.`;
export const handoverOpen = (folder: string): string => `${folder} already has an open handover.`;
export const handoverLapsed = (date: string): string =>
  `This handover lapsed at the end of ${date}.`;
export const handoverDecided = (status: 'accepted' | 'declined'): string =>
  `This handover was already ${status}.`;
export const lockedNotRenamed = (name: string): string =>
  `${name} is locked and was not renamed.`;

export const noticeGrantEnded = (item: string, date: string): string =>
  `Your access to ${item} ended at the end of ${date}, Phoenix time.`;
export const noticeGrantEndedFallback = (item: string, date: string): string =>
  `Your editor access to ${item} ended at the end of ${date}, Phoenix time. You can still view it.`;
export const noticeLowered = (item: string): string => `Your access to ${item} is now view only.`;
export const noticeRemoved = (item: string): string => `Your access to ${item} has been removed.`;
export const noticeWriteForbidden = (item: string): string =>
  `You no longer have edit access to ${item}.`;
export const noticeGone = (item: string): string => `${item} is no longer available to you.`;
export const noticeHandoverAccepted = (person: string, folder: string): string =>
  `${person} accepted ${folder}.`;
export const noticeHandoverDeclined = (person: string, folder: string): string =>
  `${person} declined ${folder}.`;
export const noticeHandoverLapsed = (person: string, folder: string): string =>
  `Your handover of ${folder} to ${person} lapsed. You still own it.`;

export const sharedWith = (item: string, person: string, date: string): string =>
  `Shared ${item} with ${person} until ${date}`;
export const accessChanged = (person: string, role: Role, item: string): string =>
  `${person} is now ${role} on ${item}`;
export const accessRemoved = (person: string, item: string): string =>
  `Removed ${person} from ${item}`;
