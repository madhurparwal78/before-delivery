import type { EventKind, RejectionReason } from './types';

export const COLLECTION_NAME = 'Ashgrove collection';

export const fieldMessages = {
  title: 'Enter a title.',
  objectNumberEmpty: 'Enter an object number.',
  objectNumberDuplicate: 'That object number is already in use.',
  lenderId: 'Choose a lender or the Ashgrove collection.',
  medium: 'Keep the medium to 120 characters or fewer.',
  width: 'Enter a width above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.',
  height: 'Enter a height above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.',
  unit: 'Choose cm or in.',
  luxLimit: 'Enter a lux limit from 1 to 1000.',
  luxHourBudget: 'Enter a lux-hour budget from 1 to 10,000,000.',
  insuranceValueGbp: 'Enter an insurance value in whole pounds.',
  registrarNote: 'Keep the note to 2000 characters or fewer.',
  plannedLux: 'Enter a lux level from 1 to 1000.',
  millimetres: 'Enter a whole number of millimetres.',
  dateFormat: 'Enter a date as YYYY-MM-DD.',
  dateTooSoon: 'Choose a later date: 09:00 museum time on that date is less than 2 hours away.',
} as const;

export const errorSummaryLine = 'Fix these to continue:';

export function offWallMessage(wallName: string): string {
  return `Runs off the wall: keep the whole work on ${wallName}.`;
}

export const offCentreLineMessage =
  'Off the 145 cm centre line: set the centre height to 145 cm or mark it as an exception.';

export function tooCloseMessage(neighbourTitle: string): string {
  return `Too close to ${neighbourTitle}: keep at least 20 cm between works.`;
}

export function tooBrightMessage(wallName: string, lux: number, limit: number): string {
  return `Too bright for this work: ${wallName} is lit at ${lux} lux and the limit is ${limit} lux.`;
}

export const rejectionField: Record<RejectionReason, 'wall' | 'offset' | 'centreHeight'> = {
  off_wall: 'offset',
  too_close: 'offset',
  off_centre_line: 'centreHeight',
  too_bright: 'wall',
};

export const banners = {
  database: "Hangline can't reach its database. Changes are paused until it's back.",
  imageStore: "Image store unavailable. Condition photos can't be attached right now.",
  mailRelay: "Mail relay unavailable. Preview emails will be sent when it's back.",
} as const;

export const noWebglNotice = "3D view isn't available on this device. Showing a flat drawing instead.";
export const noRecordsMatch = 'No records match.';
export const recordNotFound = "That record doesn't exist.";
export const previewLinkInvalid = "This preview link isn't valid.";
export const previewWithdrawnHeading = 'This preview has been withdrawn by the museum.';
export const previewUnavailableHeading = "This preview can't be shown right now. Please try again later.";

export const announce = {
  placed: (title: string, wallName: string) => `${title} placed on ${wallName}.`,
  moved: (title: string, length: string) => `${title} moved to ${length} from the left end.`,
  removed: (title: string, wallName: string) => `${title} removed from ${wallName}.`,
  undone: (title: string) => `Undone: ${title} is back where it was.`,
  undoExpired: 'Too late to undo: the 10-second window has closed.',
  undoChanged: (title: string) => `Can't undo: ${title} has changed since.`,
  claimed: (title: string) => `You claimed ${title}.`,
  claimLost: (winner: string, title: string) => `${winner} claimed ${title} first.`,
  released: (title: string) => `You released ${title}.`,
  hung: (title: string) => `${title} marked hung.`,
  signedOff: (title: string) => `${title} signed off.`,
  signOffNoPhoto: (title: string) => `Add a condition photo before signing off ${title}.`,
  signOffOverBudget: (title: string) => `${title} is over its light budget and can't be signed off.`,
  photoAttached: (title: string) => `Condition photo attached to ${title}.`,
  photoStoreDown: (title: string) =>
    `Condition photo not attached to ${title}. The image store is unavailable.`,
  photoTooLarge: 'That photo is over 10,000,000 bytes.',
  photoWrongType: 'Use a JPEG or PNG photo.',
  objectSaved: (title: string) => `${title} saved.`,
  wallLux: (wallName: string, lux: number) => `${wallName} lighting set to ${lux} lux.`,
  previewScheduled: (publishDisplay: string) => `Preview scheduled for ${publishDisplay}.`,
  previewCancelled: 'Preview schedule cancelled.',
  previewWithdrawn: 'Preview withdrawn. Lender links no longer work.',
  planView: 'Plan view.',
  wallView: 'Wall view.',
  lightView: 'Light view.',
  databaseBack: 'Database connection restored.',
  staleVersion: (title: string) => `Someone else moved ${title}. Showing the latest position.`,
  notMovable: (title: string) => `You can't move ${title} in its current state.`,
  uploadingPhoto: 'Uploading condition photo...',
} as const;

export interface TeamUpdateFields {
  actor: string;
  title: string;
  wallName: string;
  length: string;
  lux: number;
  publishAtDisplay: string;
  recipientCount: number;
}

export function teamUpdateSentence(kind: EventKind, f: TeamUpdateFields): string {
  switch (kind) {
    case 'placement.placed':
      return `${f.actor} placed ${f.title} on ${f.wallName}.`;
    case 'placement.moved':
      return `${f.actor} moved ${f.title} to ${f.length} from the left end.`;
    case 'placement.removed':
      return `${f.actor} removed ${f.title} from ${f.wallName}.`;
    case 'placement.restored':
      return `${f.actor} put ${f.title} back on ${f.wallName}.`;
    case 'placement.claimed':
      return `${f.actor} claimed ${f.title}.`;
    case 'placement.released':
      return `${f.actor} released ${f.title}.`;
    case 'placement.hung':
      return `${f.actor} marked ${f.title} hung.`;
    case 'placement.signed_off':
      return `${f.actor} signed off ${f.title}.`;
    case 'object.created':
      return `${f.actor} added ${f.title} to the loan register.`;
    case 'object.updated':
      return `${f.actor} updated the record for ${f.title}.`;
    case 'photo.attached':
      return `${f.actor} attached a condition photo to ${f.title}.`;
    case 'wall.lux_changed':
      return `${f.actor} set ${f.wallName} lighting to ${f.lux} lux.`;
    case 'preview.scheduled':
      return `${f.actor} scheduled the lender preview for ${f.publishAtDisplay}.`;
    case 'preview.cancelled':
      return `${f.actor} cancelled the lender preview schedule.`;
    case 'preview.published':
      return `Preview published. Lenders notified: ${f.recipientCount}.`;
    case 'preview.withdrawn':
      return `${f.actor} withdrew the lender preview.`;
  }
}
