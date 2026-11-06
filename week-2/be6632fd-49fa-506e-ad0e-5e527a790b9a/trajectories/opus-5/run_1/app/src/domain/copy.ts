export const SHARED_COPY = {
  unreachable: "Hourline can't be reached. Nothing was saved. Check your connection and try again.",
  crossOrigin: 'This request came from another site and was refused.',
  sessionEnded: 'Your session ended. Sign in again to continue — your draft is kept.',
  accessRemoved: 'Your access to this workspace was removed.',
  unauthenticated: 'Sign in to continue.',
  draftRestored: 'Your draft is restored.',
  forbidden: "Your role can't do this.",
  notFound: 'Page not found',
} as const;

export function validationAnnouncement(count: number): string {
  return count === 1
    ? 'There is 1 problem. Fix it and try again.'
    : `There are ${count} problems. Fix them and try again.`;
}

export function staleStart(name: string, time: string): string {
  return `Not saved: ${name} saved a newer version at ${time}.`;
}

export const FIELD_COPY = {
  required: 'This field is required.',
  email: 'Enter an email address like name@example.com.',
  tooLong: (limit: number): string => `Use at most ${limit} characters.`,
  range: (min: number, max: number): string => `Enter a whole number from ${min} to ${max}.`,
  date: 'Enter a date as YYYY-MM-DD.',
  time: 'Enter a time as HH:MM.',
  instant: 'Enter an instant like 2027-03-18T09:00:00Z.',
  notLater: 'Choose a time later than now.',
  gap: (date: string): string =>
    `Copenhagen skips from 02:00 to 03:00 on ${date}. Choose another time.`,
  consent: 'Tick the box to agree to drop emails.',
  password: 'Use 12 to 128 characters.',
  imageType: 'Use a JPEG, PNG or WebP photo.',
  imagePixels:
    'Use a photo at most 12,000 pixels on each side and 40,000,000 pixels in all.',
  priceListPast: 'Choose today or a later date.',
  unknownStyle: (styleNumber: string): string => `No style ${styleNumber} on this drop.`,
  unknownMarket: 'Choose one of the six markets.',
  unknownStockist: 'Choose a stockist.',
} as const;

/** The `message` of each API error code, shared with the screens' status regions. */
export const ERROR_COPY: Record<string, string> = {
  not_found: SHARED_COPY.notFound,
  method_not_allowed: 'This method is not allowed on this path.',
  cross_origin: SHARED_COPY.crossOrigin,
  rate_limited: 'Too many sign-ups from this connection. Try again shortly.',
  unauthenticated: SHARED_COPY.unauthenticated,
  session_ended: SHARED_COPY.sessionEnded,
  access_removed: SHARED_COPY.accessRemoved,
  forbidden: SHARED_COPY.forbidden,
  too_large: 'The upload is larger than its limit. Nothing was saved.',
  unsupported_media_type: 'Send this request as JSON.',
  invalid_json: 'This request body could not be read.',
  idempotency_key_required: 'A claim needs an Idempotency-Key header.',
  idempotency_key_reused: 'This Idempotency-Key was used with a different request.',
  validation_failed: 'There is a problem with this request. Fix it and try again.',
  stale_version: 'Not saved: someone saved a newer version.',
  invalid_credentials: "That email and password don't match.",
  link_used: 'This link was already used. Your place is kept.',
  link_expired: 'This link has expired. Join the waitlist again for a new one.',
  link_revoked: 'This preview link was revoked by the press team.',
  link_replaced: 'This preview link was replaced by a newer one. Check your inbox.',
  drop_withdrawn: 'This drop was withdrawn.',
  drop_withdrawn_already: 'This drop is already withdrawn.',
  drop_not_public: 'This drop is not public yet.',
  drop_not_draft: 'This drop is already scheduled.',
  drop_locked: "This drop is live, sold out or withdrawn, so its time can't change.",
  drop_closed: 'This drop is sold out.',
  hold_expired: 'This hold ended. The piece has gone back to the drop.',
  hold_claimed: 'This piece is already claimed.',
  sold_out: 'Sorry — the last piece went to another shopper.',
  waitlist_pending: 'Pieces are being offered to the waitlist first. Check back shortly.',
  market_not_live: "This drop isn't live yet.",
  already_claimed: 'You already have a piece from this drop in this market.',
  allocation_split: 'The edition was already split, so requests are closed.',
  allocation_exists: 'This stockist already has an allocation for this drop.',
  allocation_confirmed: 'This allocation is already confirmed.',
  allocation_not_split: 'This allocation is not ready to confirm.',
  allocation_empty: 'Allocate at least one piece before confirming.',
  price_missing: 'No wholesale price is in force for this line.',
  contact_missing: 'Add a contact email for this stockist before confirming.',
  drop_has_confirmed:
    "An allocation of this drop is confirmed, so the edition can't be split again.",
  preview_revoked: 'This preview is revoked. Send a new preview instead.',
  stockist_active: 'This stockist is not archived.',
  last_producer: 'A workspace needs at least one launch producer.',
  billing_unavailable:
    'Invoicing is unavailable right now. Nothing was confirmed, invoiced or emailed. Try again shortly.',
  storage_unavailable:
    'Image storage is unavailable right now. Nothing was uploaded. Try again shortly.',
};

export const STATUS_COPY = {
  calendarNoMatch: 'No drops match these filters.',
  waitlistJoined:
    'Check your inbox. If this address can join, a confirmation link is on its way.',
  waitlistRateLimited: (seconds: number): string =>
    `Too many sign-ups from this connection. Try again in ${seconds} seconds.`,
  waitlistConfirmed: (dropName: string, city: string): string =>
    `You're on the waitlist for ${dropName} in ${city}.`,
  waitlistLinkUsed: 'This link was already used. Your place is kept.',
  waitlistLinkExpired: 'This link has expired. Join the waitlist again for a new one.',
  claimed: (reference: string): string => `Claimed. Your reference is ${reference}.`,
  holdExpired: (time: string): string =>
    `This hold ended at ${time}. The piece has gone back to the drop.`,
  lostRace: (time: string): string =>
    `Sorry — the last piece went to another shopper at ${time}.`,
  waitlistFirst: 'Pieces are being offered to the waitlist first. Check back shortly.',
  notLive: (city: string): string => `This drop isn't live in ${city} yet.`,
  alreadyClaimed: (city: string): string =>
    `You already have a piece from this drop in ${city}.`,
  holdAlreadyClaimed: 'This piece is already claimed.',
  goLiveSaved: (time: string): string => `Go-live saved: ${time}.`,
  dropScheduled: 'Drop scheduled.',
  dropWithdrawn: 'Drop withdrawn. Its public page now shows it as withdrawn.',
  vipAdded: (count: number, city: string): string =>
    `${count} VIP ${count === 1 ? 'member' : 'members'} added to the ${city} waitlist.`,
  restockSaved: (weekday: string, time: string): string =>
    `Weekly restock saved: every ${weekday} at ${time} Copenhagen time.`,
  dropCreated: 'Drop created.',
  allocationSaved: 'Allocation saved.',
  requestSaved: 'Request saved.',
  splitApplied: (count: number): string =>
    `Split applied to ${count} ${count === 1 ? 'stockist' : 'stockists'}.`,
  staleTheirVersion: 'Showing their version.',
  allocationConfirmedCopy: (invoiceNumber: string): string =>
    `Allocation confirmed. Invoice ${invoiceNumber} created; the confirmation email is on its way.`,
  priceListSaved: (date: string): string => `Price list saved. It applies from ${date}.`,
  importFinished: (matched: number, updated: number, unchanged: number, orphans: number): string =>
    `Import finished: ${matched} matched, ${updated} updated, ${unchanged} unchanged, ${orphans} orphan ${orphans === 1 ? 'row' : 'rows'}.`,
  importTooLarge: 'The file is larger than 1,000,000 bytes. Nothing was imported.',
  importWrongType: 'Choose a CSV file. Nothing was imported.',
  lookAdded: 'Look added.',
  lookOrderSaved: 'Look order saved.',
  lookTooLarge: 'The photo is larger than 8,000,000 bytes. Nothing was uploaded.',
  lookStorageDown:
    'Image storage is unavailable right now. Nothing was uploaded. Try again shortly.',
  lookLift: (title: string, position: string): string => `Picked up ${title}. Position ${position}.`,
  lookMove: (title: string, position: string): string => `${title} moved to position ${position}.`,
  lookDrop: (title: string, position: string): string => `${title} dropped at position ${position}.`,
  lookCancel: (title: string, position: string): string =>
    `Move cancelled. ${title} is back at position ${position}.`,
  lookStaleTail: 'The saved order is back.',
  storySaved: (time: string): string => `Story saved at ${time}.`,
  storyPublished: 'Story published.',
  storyStaleTail: 'Your text is still in the editor.',
  previewCreated: (editorName: string): string =>
    `Preview link created. The email to ${editorName} is on its way.`,
  previewRevoked: 'Link revoked.',
  previewRegenerated: (editorName: string): string =>
    `New link created. The old link no longer works, and the email to ${editorName} is on its way.`,
  downloadReady: 'Download ready.',
  downloadUnavailable: 'Downloads are unavailable right now. Try again shortly.',
  stockistAdded: 'Stockist added.',
  stockistArchived: 'Stockist archived.',
  stockistRestored: 'Stockist restored.',
  contactErased: 'Contact erased.',
  invitationSent: (email: string): string => `If ${email} can be invited, an invitation is on its way.`,
  roleUpdated: 'Role updated.',
  memberRemoved: 'Member removed.',
  resetRequested: 'If that address belongs to a member, a reset link is on its way.',
  passwordSaved: 'Password saved.',
  resetDeadLink: 'This reset link is no longer valid. Ask for a new one.',
  inviteDeadLink: 'This invitation is no longer valid. Ask your launch producer for a new one.',
  signInRefused: "That email and password don't match.",
  rollingShift: (city: string, time: string): string =>
    `${city} skips an hour that night, so it opens at ${time}.`,
  noPriceInForce: (styleNumber: string, currency: string): string =>
    `No wholesale price is in force for ${styleNumber} in ${currency}.`,
  noContact: (stockistName: string): string =>
    `Add a contact email for ${stockistName} before confirming.`,
  allocationEmpty: 'Allocate at least one piece before confirming.',
  alreadyConfirmed: 'This allocation was already confirmed.',
  billingDown:
    'Invoicing is unavailable right now. Nothing was confirmed, invoiced or emailed. Try again shortly.',
  splitExists: 'The edition was already split, so requests are closed.',
  confirmedExists:
    "An allocation of this drop is confirmed, so the edition can't be split again.",
  allocationExists: 'This stockist already has an allocation for this drop.',
  notDraft: 'This drop is already scheduled.',
  dropLocked: "This drop is live, sold out or withdrawn, so its time can't change.",
  lastProducer: 'A workspace needs at least one launch producer.',
  erasedContact: 'Contact erased',
  emptyTable: 'Nothing here yet.',
} as const;
