// Published copy (brief: Feedback states), character for character.
import { formatLength, type Unit } from "../shared/units";
import type { HangEvent, View } from "./types";
import { luxText } from "./format";

export const BANNERS = {
  database: "Hangline can't reach its database. Changes are paused until it's back.",
  imageStore: "Image store unavailable. Condition photos can't be attached right now.",
  mailRelay: "Mail relay unavailable. Preview emails will be sent when it's back.",
} as const;

export const VIEW_SENTENCE: Record<View, string> = { plan: "Plan view.", wall: "Wall view.", light: "Light view." };

export const NO_WEBGL = "3D view isn't available on this device. Showing a flat drawing instead.";

export const say = {
  placed: (title: string, wall: string) => `${title} placed on ${wall}.`,
  moved: (title: string, mm: number, unit: Unit) => `${title} moved to ${formatLength(mm, unit)} from the left end.`,
  stale: (title: string) => `Someone else moved ${title}. Showing the latest position.`,
  notMovable: (title: string) => `You can't move ${title} in its current state.`,
  removed: (title: string, wall: string) => `${title} removed from ${wall}.`,
  undone: (title: string) => `Undone: ${title} is back where it was.`,
  undoExpired: "Too late to undo: the 10-second window has closed.",
  undoChanged: (title: string) => `Can't undo: ${title} has changed since.`,
  claimed: (title: string) => `You claimed ${title}.`,
  lostClaim: (winner: string, title: string) => `${winner} claimed ${title} first.`,
  released: (title: string) => `You released ${title}.`,
  hung: (title: string) => `${title} marked hung.`,
  signedOff: (title: string) => `${title} signed off.`,
  noPhoto: (title: string) => `Add a condition photo before signing off ${title}.`,
  overBudget: (title: string) => `${title} is over its light budget and can't be signed off.`,
  photoAttached: (title: string) => `Condition photo attached to ${title}.`,
  photoStoreDown: (title: string) => `Condition photo not attached to ${title}. The image store is unavailable.`,
  photoTooLarge: "That photo is over 10,000,000 bytes.",
  photoWrongType: "Use a JPEG or PNG photo.",
  objectSaved: (title: string) => `${title} saved.`,
  wallLux: (wall: string, lux: number) => `${wall} lighting set to ${luxText(lux)}.`,
  scheduled: (display: string) => `Preview scheduled for ${display}.`,
  cancelled: "Preview schedule cancelled.",
  withdrawn: "Preview withdrawn. Lender links no longer work.",
  databaseBack: "Database connection restored.",
  uploading: "Uploading condition photo...",
  summary: "Fix these to continue:",
};

/** The team-update sentence for an event made in another session. */
export function teamSentence(e: HangEvent, unit: Unit): string {
  const actor = e.actor?.name ?? "";
  const title = e.title ?? "";
  const wall = e.wallName ?? "";
  switch (e.kind) {
    case "placement.placed":
      return `${actor} placed ${title} on ${wall}.`;
    case "placement.moved":
      return `${actor} moved ${title} to ${formatLength(e.offsetMm ?? 0, unit)} from the left end.`;
    case "placement.removed":
      return `${actor} removed ${title} from ${wall}.`;
    case "placement.restored":
      return `${actor} put ${title} back on ${wall}.`;
    case "placement.claimed":
      return `${actor} claimed ${title}.`;
    case "placement.released":
      return `${actor} released ${title}.`;
    case "placement.hung":
      return `${actor} marked ${title} hung.`;
    case "placement.signed_off":
      return `${actor} signed off ${title}.`;
    case "object.created":
      return `${actor} added ${title} to the loan register.`;
    case "object.updated":
      return `${actor} updated the record for ${title}.`;
    case "photo.attached":
      return `${actor} attached a condition photo to ${title}.`;
    case "wall.lux_changed":
      return `${actor} set ${wall} lighting to ${luxText(e.plannedLux ?? 0)}.`;
    case "preview.scheduled":
      return `${actor} scheduled the lender preview for ${e.publishAtDisplay ?? ""}.`;
    case "preview.cancelled":
      return `${actor} cancelled the lender preview schedule.`;
    case "preview.published":
      return `Preview published. Lenders notified: ${e.recipientCount ?? 0}.`;
    case "preview.withdrawn":
      return `${actor} withdrew the lender preview.`;
  }
}

export const FIELD_MESSAGES = {
  wholeMm: "Enter a whole number of millimetres.",
  badDate: "Enter a date as YYYY-MM-DD.",
  luxLevel: "Enter a lux level from 1 to 1000.",
};
