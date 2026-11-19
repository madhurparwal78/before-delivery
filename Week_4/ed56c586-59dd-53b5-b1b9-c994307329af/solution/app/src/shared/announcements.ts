import { calloutPosition } from "./callout.js";
import { REVIEWS, type Callout, type Review, type Service } from "./catalog.js";

/** Everything `Site updates` says, and the media notice. */

export const ROTATION_PAUSED = "Role rotation paused.";
export const ROTATION_RESUMED = "Role rotation resumed.";
export const CALLOUT_CLEARED = "Callout cleared.";
export const FRAME_BACK = "The preview frame is back.";
export const FRAME_STILL_UNAVAILABLE = "The preview frame is still unavailable.";
export const IMAGES_BACK = "Project images are back.";
export const MEDIA_NOTICE = "Project images are unavailable right now. Every page still works.";

export function reviewSlideLabel(position: number): string {
  return `Review ${position} of ${REVIEWS.length}`;
}

export function reviewPosition(position: number): string {
  return `${position} / ${REVIEWS.length}`;
}

export function reviewAnnouncement(position: number, review: Review): string {
  return `${reviewSlideLabel(position)}: ${review.name}, ${review.role}, ${review.company}.`;
}

export function serviceAnnouncement(service: Service): string {
  return `Project type set to ${service.name}.`;
}

export function calloutAnnouncement(number: number, callout: Callout): string {
  return `${calloutPosition(number)}: ${callout.label}.`;
}
