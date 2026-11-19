// Every published string, written once. Nothing in the interface spells one of these out again.

export const LISTING_WORD: Record<string, string> = {
  draft: 'Draft',
  rendering: 'Rendering',
  live: 'Live',
  under_offer: 'Under offer',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
};

export const OFFER_WORD: Record<string, string> = {
  open: 'Open',
  needs_reread: 'Needs re-read',
  accepted: 'Accepted',
  declined: 'Declined',
  lapsed: 'Lapsed',
  closed_by_acceptance: 'Closed by another acceptance',
};

export const LINK_WORD: Record<string, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
};

export const ALERT_WORD: Record<string, string> = {
  waiting: 'Waiting',
  delivered: 'Delivered',
  failed: 'Failed',
};

export const ODOMETER_FLAG: Record<string, string> = {
  unit_change: 'Unit changed, not a drop',
  drop: 'Mileage drop',
  no_odometer: 'No odometer reading',
  unreadable: 'Odometer unreadable',
};

export const BLOCKER_COPY: Record<string, string> = {
  no_findings: 'Add at least one finding',
  no_record_pull: 'Pull the test record',
  record_stale: 'The test record is too old. Pull it again.',
  advisories_unanswered: 'Answer every advisory from the latest pull',
  advisory_recurred: 'Change the stance on each advisory seen again at a later test',
};

export const RECURRED_FLAG = 'Seen again at a later test';

export const SECTIONS = [
  { heading: 'Panels and readings', fragment: 'panels' },
  { heading: 'Findings', fragment: 'findings' },
  { heading: 'Evidence', fragment: 'evidence' },
  { heading: 'Test record', fragment: 'record' },
  { heading: 'Publish', fragment: 'publish' },
  { heading: 'People', fragment: 'people' },
  { heading: 'Viewings', fragment: 'viewings' },
  { heading: 'Offers', fragment: 'offers' },
  { heading: 'Alerts', fragment: 'alerts' },
] as const;

export const MESSAGE = {
  microns: 'Enter whole microns from 1 to 2000',
  plastic: 'Plastic panels cannot be gauged',
  slotMissing: 'That time does not exist in London on that date',
  slotPast: 'Choose a time in the future',
  passphraseWrong: 'That passphrase is not right',
  staleFinding: 'This finding has changed. Reload it before saving.',
  storageDown: 'Photo storage is not answering. Nothing was saved. Try again shortly.',
  recordNotFound: 'No test record was found for this registration.',
  recordDown: 'The roadworthiness record service is not answering. Your last pull is still shown.',
  renderFailed: 'The report could not be rendered, so nothing was published.',
  storeFailed: 'The report could not be stored, so nothing was published.',
  handoverFailed: 'The handover record could not be made, so the sale is not complete.',
  alertFailed: 'Phone alert failed. It stays in your alert list.',
  captureOffline: 'No signal. Items stay queued on this device.',
  photosDown: 'Photos are unavailable right now. The written findings are still here.',
  seenFailed: 'That could not be saved. Try again.',
  sendFailed: 'That could not be sent. Try again.',
  linkEndedHeading: 'This link has ended',
  linkEndedBody: 'Ask the owner for a new link.',
  linkUnknown: 'We could not find that link',
  carUnknown: 'We could not find that car file',
  replayEnded: 'This link has ended, so these items were not saved.',
  changedCard: 'Changed. Read it again.',
  offerNeedsReread: 'Your offer needs a re-read',
  lapsedHeading: 'This offer has lapsed',
  lapsedBody: 'You can make a new offer while the car is still live.',
  rereadHeading: "The owner has changed this car's file",
  nothingBlocking: 'Nothing is blocking publish',
  sessionEnded: 'Your session has ended. Sign in to carry on.',
  noFindings: 'No findings yet',
  noViewings: 'No viewings offered yet',
  noOffers: 'No offers yet',
  noAlerts: 'No alerts yet',
  nothingQueued: 'Nothing queued',
  maskRequired: 'Mark the plate or tick No plate in this photo',
  materialUnseen: 'Read every material finding before making an offer',
  offerExists: 'You already have an offer on this car',
  listingClosed: 'This car is not taking viewings or offers right now',
  slotTaken: 'That slot has just gone',
  alreadyHolding: 'You already hold a viewing. Release it first.',
  offerAlreadyAccepted: 'Another offer has already been accepted',
  offerLapsed: 'This offer has lapsed',
  offerNeedsRereadRefusal: 'This offer is waiting for the buyer to re-read the changes',
  offerNotOpen: 'This offer is no longer open',
  alertInProgress: 'This alert is already being sent',
} as const;

export const CAPTURE_WORD: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  synced: 'Synced',
  rejected: 'Rejected',
  conflict: 'Conflict',
};
