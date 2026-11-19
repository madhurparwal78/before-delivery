// The single feedback registry: every user-facing and API `message` copy from the brief's
// Feedback states table. Server and browser both import from here.

export const F = {
  PENDING: "Saving changes.",
  OFFLINE: "Offline. Your changes are queued.",
  SERVICE: "Service unavailable. Your changes are still here.",
  CONFLICT: "This record changed elsewhere. Your draft is still here.",
  SESSION: "Your session ended. Sign in to continue.",
  REVOKED: "Access ended. Private evidence is no longer available.",
  HIDDEN: "This item is not available.",
  FORBIDDEN: "You cannot perform this action.",
  INVALID: "Check the highlighted fields.",
  BAD_BODY: "The request could not be read.",
  TOO_LARGE: "The upload or request is too large.",
  SYNCED: "Queued changes saved.",
  INTAKE_OK: "Specimen created. Both photographs are saved.",
  INTAKE_DUP: "This specimen reference already exists. Your draft is still here.",
  ATTR_OK: "Attribution quarantined. This specimen is excluded from sets and offers.",
  IN_OFFER: "This specimen is in an open offer. Change the offer first.",
  CATALOG_WAIT: "Catalog unavailable. Your correction is kept.",
  CATALOG_RATE: "Catalog is busy. Your correction is kept for retry.",
  CATALOG_RETRYING: "Retrying catalog now.",
  CATALOG_BAD: "Catalog reply could not be read. Your correction is kept.",
  CATALOG_MISSING: "Catalog has no entry for this reference. Your correction is kept.",
  CATALOG_PENDING: "Waiting for the catalog record. This cannot complete yet.",
  CATALOG_OK: "Catalog reconciled. Your correction is saved.",
  TRAY_OK: "Holder placed.",
  TRAY_SIZE: "This holder is too large for this cell.",
  TRAY_TAKEN: "This cell is occupied. Choose another cell.",
  SET_OK: "Album placement saved. Gaps updated.",
  SET_UNCERTAIN: "Quarantined specimens cannot fill this hole.",
  SET_OUTBOUND: "Outbound specimens cannot fill this hole.",
  SET_MISMATCH: "This specimen does not match this hole.",
  CONDITION_OK: "Condition note saved on the original photograph.",
  IMAGE_WAIT: "Photograph unavailable. Your notes are kept.",
  KEEPER_OK: "Keeper order saved.",
  UNDO_OK: "Previous keeper order restored.",
  UNDO_NONE: "There is no keeper move to undo.",
  OFFER_OK: "Offer sent. Both baskets are reserved.",
  OFFER_TAKEN: "A specimen was reserved elsewhere. Both baskets remain unchanged.",
  OFFER_EXPIRED: "This offer's response window has closed.",
  COUNTER_VOID: "Offer changed. Both acceptances were cleared.",
  COUNTER_ACCEPT: "Acceptance recorded for this offer version.",
  MFA_REQUIRED: "Verify your identity before accepting this offer.",
  DISPATCH_OK: "Manifest frozen. Packing order and evidence are saved.",
  DISPATCH_FROZEN: "This manifest is already frozen. Packing order is unchanged.",
  RECEIPT_WAIT: "Receipt saved. Waiting for the counterpart.",
  RECEIPT_DONE: "Both receipts match. Ownership transferred.",
  RECEIPT_HOLD: "Receipt saved. Transfer is held by a dispute.",
  RECEIPT_MISMATCH: "Receipt saved. It does not match the manifest, so transfer is held.",
  DISPUTE_OPEN: "Dispute opened. Ownership transfer is on hold.",
  RESOLUTION_WAIT: "Resolution proposed. Waiting for the counterpart.",
  RESOLUTION_DONE: "Resolution approved. The transfer hold is released.",
  LINK_COPIED: "Private evidence link copied.",
  LINK_REVOKED: "Private evidence link revoked.",
  AUDIT_MISSING: "Missing item recorded. Audit history is kept.",
  RESUMED: "Your confirmed action resumed after sign-in.",
  SIGNIN_DOWN: "Sign-in is unavailable. Your changes are still here.",
  COMMAND_REUSED: "This action was already sent with different details.",
  PHOTO_TYPE: "Not a JPEG, PNG or WebP photograph.",
  PHOTO_SVG: "SVG drawings are not accepted as photographs.",
  PHOTO_MISSING: "Add both photographs.",
  REFERENCE_FORMAT: "Use 1 to 80 letters, digits or hyphens.",
  COORD: "Coordinates must be inside the photograph.",
  ORDER: "The order must list each specimen once.",
  BASKET_EMPTY: "Each basket needs at least one specimen.",
  ARRIVAL_MISSING: "Add an arrival photograph for each received specimen.",
  CELL_EMPTY: "This cell is empty.",
  CORNER_VERIFIED: "Identity verified",
  CORNER_VERIFY: "Verify to accept",
  CORNER_CLOSING: "Window closing",
  WINDOW_ACCEPTED: "Accepted. No response window is running.",
} as const;

export const photoBytes = (max: number) => `Photograph is larger than ${max} bytes.`;
export const photoEdge = (min: number, max: number) => `Long edge must be ${min} to ${max} pixels.`;
export const photoPixels = (max: number) => `Photograph has more than ${max} pixels.`;
export const textLong = (max: number) => `Use at most ${max} characters.`;
export const basketFull = (max: number) => `A basket holds at most ${max} specimens per side.`;
export const pageLimit = (max: number) => `At most ${max} per page.`;
export const syncLimit = (max: number) => `At most ${max} queued changes per sync.`;
export const catalogCountdown = (seconds: number) => `Retrying catalog in ${seconds} seconds.`;
export const reorderCopy = (specimen: string, position: number, count: number) =>
  `${specimen} moved to position ${position} of ${count}.`;
export const holdPlaced = (specimen: string) => `${specimen} is held while you review.`;
export const holdReleased = (specimen: string) => `Counterpart left. ${specimen} is free again.`;
export const statusLine = (n: number, m: number) => `Today: ${n} specimens taken in. ${m} catalog records pending.`;
export const cornerCount = (n: number) => `${n} open offers`;
export const stockLines = (n: number, m: number) => [`${n} specimens`, `${m} of 4 cells filled`] as const;
export const exchangeLines = (n: number, m: number) => [`${n} open offers`, `${m} awaiting receipt`] as const;

/** "<hours> h <minutes> min" from whole seconds, rounded down to minutes. */
function remainingText(seconds: number): string {
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}

/** The server's ISO timestamp as "YYYY-MM-DD HH:MM UTC". */
function expiryText(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export const windowOpen = (remaining: number, expiresAt: string) =>
  `${remainingText(remaining)} left, expires ${expiryText(expiresAt)}`;
export const windowClosed = (expiresAt: string) => `Window closed ${expiryText(expiresAt)}`;

/** Copies that the brief routes to G08 as well as to their field. */
export const ALERT_FIELD_COPIES: readonly string[] = [F.TRAY_SIZE, F.SET_MISMATCH];
