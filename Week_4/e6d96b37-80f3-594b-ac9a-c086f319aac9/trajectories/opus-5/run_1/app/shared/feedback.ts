/**
 * The single feedback registry. Every announcement, error body `message`, field
 * error, status line and chip label in the product is built from this file, on
 * the server and in the browser alike. No copy is written anywhere else.
 */

export const F = {
  PENDING: 'Saving changes.',
  OFFLINE: 'Offline. Your changes are queued.',
  SERVICE: 'Service unavailable. Your changes are still here.',
  CONFLICT: 'This record changed elsewhere. Your draft is still here.',
  SESSION: 'Your session ended. Sign in to continue.',
  REVOKED: 'Access ended. Private evidence is no longer available.',
  HIDDEN: 'This item is not available.',
  FORBIDDEN: 'You cannot perform this action.',
  INVALID: 'Check the highlighted fields.',
  BAD_BODY: 'The request could not be read.',
  TOO_LARGE: 'The upload or request is too large.',
  SYNCED: 'Queued changes saved.',
  INTAKE_OK: 'Specimen created. Both photographs are saved.',
  INTAKE_DUP: 'This specimen reference already exists. Your draft is still here.',
  ATTR_OK: 'Attribution quarantined. This specimen is excluded from sets and offers.',
  IN_OFFER: 'This specimen is in an open offer. Change the offer first.',
  CATALOG_WAIT: 'Catalog unavailable. Your correction is kept.',
  CATALOG_RATE: 'Catalog is busy. Your correction is kept for retry.',
  CATALOG_RETRYING: 'Retrying catalog now.',
  CATALOG_BAD: 'Catalog reply could not be read. Your correction is kept.',
  CATALOG_MISSING: 'Catalog has no entry for this reference. Your correction is kept.',
  CATALOG_PENDING: 'Waiting for the catalog record. This cannot complete yet.',
  CATALOG_OK: 'Catalog reconciled. Your correction is saved.',
  TRAY_OK: 'Holder placed.',
  TRAY_SIZE: 'This holder is too large for this cell.',
  TRAY_TAKEN: 'This cell is occupied. Choose another cell.',
  SET_OK: 'Album placement saved. Gaps updated.',
  SET_UNCERTAIN: 'Quarantined specimens cannot fill this hole.',
  SET_OUTBOUND: 'Outbound specimens cannot fill this hole.',
  SET_MISMATCH: 'This specimen does not match this hole.',
  CONDITION_OK: 'Condition note saved on the original photograph.',
  IMAGE_WAIT: 'Photograph unavailable. Your notes are kept.',
  KEEPER_OK: 'Keeper order saved.',
  UNDO_OK: 'Previous keeper order restored.',
  UNDO_NONE: 'There is no keeper move to undo.',
  OFFER_OK: 'Offer sent. Both baskets are reserved.',
  OFFER_TAKEN: 'A specimen was reserved elsewhere. Both baskets remain unchanged.',
  OFFER_EXPIRED: "This offer's response window has closed.",
  COUNTER_VOID: 'Offer changed. Both acceptances were cleared.',
  COUNTER_ACCEPT: 'Acceptance recorded for this offer version.',
  MFA_REQUIRED: 'Verify your identity before accepting this offer.',
  DISPATCH_OK: 'Manifest frozen. Packing order and evidence are saved.',
  DISPATCH_FROZEN: 'This manifest is already frozen. Packing order is unchanged.',
  RECEIPT_WAIT: 'Receipt saved. Waiting for the counterpart.',
  RECEIPT_DONE: 'Both receipts match. Ownership transferred.',
  RECEIPT_HOLD: 'Receipt saved. Transfer is held by a dispute.',
  RECEIPT_MISMATCH: 'Receipt saved. It does not match the manifest, so transfer is held.',
  DISPUTE_OPEN: 'Dispute opened. Ownership transfer is on hold.',
  RESOLUTION_WAIT: 'Resolution proposed. Waiting for the counterpart.',
  RESOLUTION_DONE: 'Resolution approved. The transfer hold is released.',
  LINK_COPIED: 'Private evidence link copied.',
  LINK_REVOKED: 'Private evidence link revoked.',
  AUDIT_MISSING: 'Missing item recorded. Audit history is kept.',
  RESUMED: 'Your confirmed action resumed after sign-in.',
  SIGNIN_DOWN: 'Sign-in is unavailable. Your changes are still here.',
  COMMAND_REUSED: 'This action was already sent with different details.',
  PHOTO_TYPE: 'Not a JPEG, PNG or WebP photograph.',
  PHOTO_SVG: 'SVG drawings are not accepted as photographs.',
  PHOTO_MISSING: 'Add both photographs.',
  REFERENCE_FORMAT: 'Use 1 to 80 letters, digits or hyphens.',
  COORD: 'Coordinates must be inside the photograph.',
  ORDER: 'The order must list each specimen once.',
  BASKET_EMPTY: 'Each basket needs at least one specimen.',
  ARRIVAL_MISSING: 'Add an arrival photograph for each received specimen.',
  CELL_EMPTY: 'This cell is empty.',
  CORNER_VERIFIED: 'Identity verified',
  CORNER_VERIFY: 'Verify to accept',
  CORNER_CLOSING: 'Window closing',
  WINDOW_ACCEPTED: 'Accepted. No response window is running.',
} as const;

/** Copy with placeholders the server or browser fills from real values. */
export const Ftpl = {
  /** F_CATALOG_COUNTDOWN */
  catalogCountdown: (seconds: number): string => `Retrying catalog in ${seconds} seconds.`,
  /** F_REORDER */
  reorder: (specimen: string, position: number, count: number): string =>
    `${specimen} moved to position ${position} of ${count}.`,
  /** F_HOLD_PLACED */
  holdPlaced: (specimen: string): string => `${specimen} is held while you review.`,
  /** F_HOLD_RELEASED */
  holdReleased: (specimen: string): string => `Counterpart left. ${specimen} is free again.`,
  /** F_PHOTO_BYTES */
  photoBytes: (max: number): string => `Photograph is larger than ${max} bytes.`,
  /** F_PHOTO_EDGE */
  photoEdge: (min: number, max: number): string => `Long edge must be ${min} to ${max} pixels.`,
  /** F_PHOTO_PIXELS */
  photoPixels: (max: number): string => `Photograph has more than ${max} pixels.`,
  /** F_TEXT_LONG */
  textLong: (max: number): string => `Use at most ${max} characters.`,
  /** F_BASKET_FULL */
  basketFull: (max: number): string => `A basket holds at most ${max} specimens per side.`,
  /** F_PAGE_LIMIT */
  pageLimit: (max: number): string => `At most ${max} per page.`,
  /** F_SYNC_LIMIT */
  syncLimit: (max: number): string => `At most ${max} queued changes per sync.`,
  /** F_STATUS_LINE */
  statusLine: (takenIn: number, pending: number): string =>
    `Today: ${takenIn} specimens taken in. ${pending} catalog records pending.`,
  /** F_CORNER */
  corner: (openOffers: number): string => `${openOffers} open offers`,
  /** F_WINDOW */
  window: (remaining: string, expiry: string): string => `${remaining} left, expires ${expiry}`,
  /** F_WINDOW_CLOSED */
  windowClosed: (expiry: string): string => `Window closed ${expiry}`,
  /** G19 / G20 chip label lines */
  specimenCount: (n: number): string => `${n} specimens`,
  cellsFilled: (m: number): string => `${m} of 4 cells filled`,
  openOffers: (n: number): string => `${n} open offers`,
  awaitingReceipt: (m: number): string => `${m} awaiting receipt`,
} as const;

/**
 * `<remaining>` is "<hours> h <minutes> min" from the server's remaining_seconds,
 * rounded down to whole minutes. Hours may exceed 23.
 */
export function formatRemaining(remainingSeconds: number): string {
  const total = Math.max(0, Math.floor(remainingSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours} h ${minutes} min`;
}

/** `<expiry>` is the server's expires_at as "YYYY-MM-DD HH:MM UTC". */
export function formatExpiry(expiresAtIso: string): string {
  const at = new Date(expiresAtIso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`
  );
}
