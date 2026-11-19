/** The published announcement and notice texts. */

import type { Review } from './seed.js';

export const reviewAnnouncement = (index: number, review: Review): string =>
  `Review ${index} of 5: ${review.name}, ${review.role}, ${review.company}.`;

export const projectTypeAnnouncement = (serviceName: string): string =>
  `Project type set to ${serviceName}.`;

export const ROLES_PAUSED = 'Role rotation paused.';
export const ROLES_RESUMED = 'Role rotation resumed.';

export const calloutAnnouncement = (n: number, label: string): string =>
  `Callout ${n} of 3: ${label}.`;

export const CALLOUT_CLEARED = 'Callout cleared.';

export const FRAME_BACK = 'The preview frame is back.';
export const FRAME_STILL_UNAVAILABLE = 'The preview frame is still unavailable.';
export const MEDIA_BACK = 'Project images are back.';

export const MEDIA_NOTICE =
  'Project images are unavailable right now. Every page still works.';

export const COVER_UNAVAILABLE = 'Cover unavailable';
export const FRAME_UNAVAILABLE = 'Preview frame unavailable';

export const coverAltText = (title: string): string => `${title} cover`;

export const frameAltText = (title: string, frame: number): string =>
  `${title}, frame ${frame} of 6`;

export const NEW_TAB_SUFFIX = '(opens in a new tab)';
