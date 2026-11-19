export interface FeedbackEntry {
  key: string;
  params: Record<string, string | number>;
}

const FEEDBACK_COPY: Record<string, string> = {
  F_PENDING: "Saving changes.",
  F_OFFLINE: "Offline. Your changes are queued.",
  F_SERVICE: "Service unavailable. Your changes are still here.",
  F_CONFLICT: "This record changed elsewhere. Your draft is still here.",
  F_SESSION: "Your session ended. Sign in to continue.",
  F_REVOKED: "Access ended. Private evidence is no longer available.",
  F_HIDDEN: "This item is not available.",
  F_FORBIDDEN: "You cannot perform this action.",
  F_INVALID: "Check the highlighted fields.",
  F_BAD_BODY: "The request could not be read.",
  F_TOO_LARGE: "The upload or request is too large.",
  F_SYNCED: "Queued changes saved.",
  F_INTAKE_OK: "Specimen created. Both photographs are saved.",
  F_INTAKE_DUP: "This specimen reference already exists. Your draft is still here.",
  F_ATTR_OK: "Attribution quarantined. This specimen is excluded from sets and offers.",
  F_IN_OFFER: "This specimen is in an open offer. Change the offer first.",
  F_CATALOG_WAIT: "Catalog unavailable. Your correction is kept.",
  F_CATALOG_RATE: "Catalog is busy. Your correction is kept for retry.",
  F_CATALOG_COUNTDOWN: "Retrying catalog in {seconds} seconds.",
  F_CATALOG_RETRYING: "Retrying catalog now.",
  F_CATALOG_BAD: "Catalog reply could not be read. Your correction is kept.",
  F_CATALOG_MISSING: "Catalog has no entry for this reference. Your correction is kept.",
  F_CATALOG_PENDING: "Waiting for the catalog record. This cannot complete yet.",
  F_CATALOG_OK: "Catalog reconciled. Your correction is saved.",
  F_TRAY_OK: "Holder placed.",
  F_TRAY_SIZE: "This holder is too large for this cell.",
  F_TRAY_TAKEN: "This cell is occupied. Choose another cell.",
  F_SET_OK: "Album placement saved. Gaps updated.",
  F_SET_UNCERTAIN: "Quarantined specimens cannot fill this hole.",
  F_SET_OUTBOUND: "Outbound specimens cannot fill this hole.",
  F_SET_MISMATCH: "This specimen does not match this hole.",
  F_CONDITION_OK: "Condition note saved on the original photograph.",
  F_IMAGE_WAIT: "Photograph unavailable. Your notes are kept.",
  F_REORDER: "{specimen} moved to position {position} of {count}.",
  F_KEEPER_OK: "Keeper order saved.",
  F_UNDO_OK: "Previous keeper order restored.",
  F_UNDO_NONE: "There is no keeper move to undo.",
  F_OFFER_OK: "Offer sent. Both baskets are reserved.",
  F_OFFER_TAKEN: "A specimen was reserved elsewhere. Both baskets remain unchanged.",
  F_OFFER_EXPIRED: "This offer's response window has closed.",
  F_HOLD_PLACED: "{specimen} is held while you review.",
  F_HOLD_RELEASED: "Counterpart left. {specimen} is free again.",
  F_COUNTER_VOID: "Offer changed. Both acceptances were cleared.",
  F_COUNTER_ACCEPT: "Acceptance recorded for this offer version.",
  F_MFA_REQUIRED: "Verify your identity before accepting this offer.",
  F_DISPATCH_OK: "Manifest frozen. Packing order and evidence are saved.",
  F_DISPATCH_FROZEN: "This manifest is already frozen. Packing order is unchanged.",
  F_RECEIPT_WAIT: "Receipt saved. Waiting for the counterpart.",
  F_RECEIPT_DONE: "Both receipts match. Ownership transferred.",
  F_RECEIPT_HOLD: "Receipt saved. Transfer is held by a dispute.",
  F_RECEIPT_MISMATCH: "Receipt saved. It does not match the manifest, so transfer is held.",
  F_DISPUTE_OPEN: "Dispute opened. Ownership transfer is on hold.",
  F_RESOLUTION_WAIT: "Resolution proposed. Waiting for the counterpart.",
  F_RESOLUTION_DONE: "Resolution approved. The transfer hold is released.",
  F_LINK_COPIED: "Private evidence link copied.",
  F_LINK_REVOKED: "Private evidence link revoked.",
  F_AUDIT_MISSING: "Missing item recorded. Audit history is kept.",
  F_RESUMED: "Your confirmed action resumed after sign-in.",
  F_SIGNIN_DOWN: "Sign-in is unavailable. Your changes are still here.",
  F_COMMAND_REUSED: "This action was already sent with different details.",
  F_PHOTO_TYPE: "Not a JPEG, PNG or WebP photograph.",
  F_PHOTO_SVG: "SVG drawings are not accepted as photographs.",
  F_PHOTO_BYTES: "Photograph is larger than {max} bytes.",
  F_PHOTO_EDGE: "Long edge must be {min} to {max} pixels.",
  F_PHOTO_PIXELS: "Photograph has more than {max} pixels.",
  F_PHOTO_MISSING: "Add both photographs.",
  F_REFERENCE_FORMAT: "Use 1 to 80 letters, digits or hyphens.",
  F_TEXT_LONG: "Use at most {max} characters.",
  F_COORD: "Coordinates must be inside the photograph.",
  F_ORDER: "The order must list each specimen once.",
  F_BASKET_FULL: "A basket holds at most {max} specimens per side.",
  F_BASKET_EMPTY: "Each basket needs at least one specimen.",
  F_ARRIVAL_MISSING: "Add an arrival photograph for each received specimen.",
  F_CELL_EMPTY: "This cell is empty.",
  F_PAGE_LIMIT: "At most {max} per page.",
  F_SYNC_LIMIT: "At most {max} queued changes per sync.",
  F_STATUS_LINE: "Today: {n} specimens taken in. {m} catalog records pending.",
  F_CORNER: "{n} open offers",
  F_CORNER_VERIFIED: "Identity verified",
  F_CORNER_VERIFY: "Verify to accept",
  F_CORNER_CLOSING: "Window closing",
  F_WINDOW: "{remaining} left, expires {expiry}",
  F_WINDOW_ACCEPTED: "Accepted. No response window is running.",
  F_WINDOW_CLOSED: "Window closed {expiry}",
};

export function feedback(key: string, params: Record<string, string | number> = {}): string {
  const template = FEEDBACK_COPY[key] ?? key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), template);
}

export function remainingText(remaining: number): string {
  const total = Math.max(0, Math.floor(remaining));
  const minutes = Math.floor(total / 60);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function expiryText(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function windowText(remaining: number | null, expiresIso: string | null): string {
  if (remaining === null || expiresIso === null) return "";
  return `${remainingText(remaining)} left, expires ${expiryText(expiresIso)}`;
}
