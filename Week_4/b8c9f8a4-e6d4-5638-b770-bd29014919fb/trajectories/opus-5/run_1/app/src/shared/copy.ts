/** Every published string, rendered character for character. */

export const LISTING_WORD = {
  draft: 'Draft',
  rendering: 'Rendering',
  live: 'Live',
  under_offer: 'Under offer',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
} as const;

export const OFFER_WORD = {
  open: 'Open',
  needs_reread: 'Needs re-read',
  accepted: 'Accepted',
  declined: 'Declined',
  lapsed: 'Lapsed',
  closed_by_acceptance: 'Closed by another acceptance',
} as const;

export const LINK_WORD = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
} as const;

export const ALERT_WORD = {
  waiting: 'Waiting',
  delivered: 'Delivered',
  failed: 'Failed',
} as const;

export const ODOMETER_FLAG = {
  unit_change: 'Unit changed, not a drop',
  drop: 'Mileage drop',
  no_odometer: 'No odometer reading',
  unreadable: 'Odometer unreadable',
} as const;

export const BLOCKER_COPY = {
  no_findings: 'Add at least one finding',
  no_record_pull: 'Pull the test record',
  record_stale: 'The test record is too old. Pull it again.',
  advisories_unanswered: 'Answer every advisory from the latest pull',
  advisory_recurred: 'Change the stance on each advisory seen again at a later test',
} as const;

export const SEVERITY_WORD = {
  cosmetic: 'Cosmetic',
  moderate: 'Moderate',
  serious: 'Serious',
} as const;

export const PENDING = {
  signIn: 'Checking passphrase',
  saveReadings: 'Saving readings',
  saveFinding: 'Saving finding',
  removeFinding: 'Removing finding',
  upload: 'Storing file',
  pullRecord: 'Pulling the test record',
  saveResponse: 'Saving response',
  publish: 'Rendering the report',
  withdraw: 'Withdrawing listing',
  createLink: 'Creating link',
  updateLink: 'Updating link',
  addSlot: 'Adding viewing slot',
  readThis: 'Saving',
  claim: 'Claiming viewing',
  release: 'Releasing viewing',
  sendOffer: 'Sending offer',
  accept: 'Accepting offer',
  decline: 'Declining offer',
  complete: 'Rendering the handover record',
  retryAlert: 'Sending alert',
  captureSend: 'Sending queued items',
} as const;

export const SUCCESS = {
  saveReadings: 'Readings saved',
  saveFinding: 'Finding saved',
  removeFinding: 'Finding removed',
  upload: 'File stored',
  locationRemoved: 'Location removed from the buyer copy',
  pullRecord: 'Test record pulled',
  saveResponse: 'Response saved',
  withdraw: 'Listing withdrawn',
  revoke: 'Link revoked',
  renew: 'Link renewed',
  replace: 'Link replaced',
  copyLink: 'Link copied',
  addSlot: 'Viewing slot added',
  release: 'Viewing released',
  sendOffer: 'Offer sent',
  accept: 'Offer accepted. Other open offers are closed.',
  decline: 'Offer declined',
  complete: 'Sale complete',
  retryAlert: 'Alert delivered',
  captureSend: 'All items synced',
} as const;

export const publishedAs = (version: number): string => `Published as version ${version}`;
export const linkReadyFor = (name: string): string => `Link ready for ${name}`;
export const viewingHeldFor = (label: string): string => `Viewing held for ${label}`;
export const seenOn = (date: string): string => `Seen ${date}`;

export const ERRORS = {
  badPassphrase: 'That passphrase is not right',
  staleFinding: 'This finding has changed. Reload it before saving.',
  unsupportedFile: 'This file type is not accepted',
  fileTooLarge: 'This file is over the size limit',
  badFileName: 'That file name is not allowed',
  maskMissing: 'Mark the plate or tick No plate in this photo',
  recordNotFound: 'No test record was found for this registration.',
  seenFailed: 'That could not be saved. Try again.',
  slotGone: 'That slot has just gone',
  alreadyHoldingSlot: 'You already hold a viewing. Release it first.',
  listingClosed: 'This car is not taking viewings or offers right now',
  materialFindingsUnseen: 'Read every material finding before making an offer',
  offerExists: 'You already have an offer on this car',
  offerAlreadyAccepted: 'Another offer has already been accepted',
  offerLapsed: 'This offer has lapsed',
  offerNeedsReread: 'This offer is waiting for the buyer to re-read the changes',
  offerNotOpen: 'This offer is no longer open',
  alertRetryInProgress: 'This alert is already being sent',
  readingRange: 'Enter whole microns from 1 to 2000',
  plasticPanel: 'Plastic panels cannot be gauged',
  timeDoesNotExist: 'That time does not exist in London on that date',
  timeInPast: 'Choose a time in the future',
  recurredFlag: 'Seen again at a later test',
} as const;

export const throttledCopy = (seconds: number): string => `The record service is busy. Try again in ${seconds} seconds.`;

export const OUTAGE = {
  storage: 'Photo storage is not answering. Nothing was saved. Try again shortly.',
  record: 'The roadworthiness record service is not answering. Your last pull is still shown.',
  reportRender: 'The report could not be rendered, so nothing was published.',
  reportStore: 'The report could not be stored, so nothing was published.',
  sendFailed: 'That could not be sent. Try again.',
  handover: 'The handover record could not be made, so the sale is not complete.',
  alert: 'Phone alert failed. It stays in your alert list.',
  capture: 'No signal. Items stay queued on this device.',
  buyerPhotos: 'Photos are unavailable right now. The written findings are still here.',
} as const;

export const NOTHING_BLOCKING = 'Nothing is blocking publish';

export const EMPTY = {
  findings: 'No findings yet',
  viewings: 'No viewings offered yet',
  offers: 'No offers yet',
  alerts: 'No alerts yet',
  queue: 'Nothing queued',
} as const;

export const LAPSED_OFFER = {
  heading: 'This offer has lapsed',
  body: 'You can make a new offer while the car is still live.',
} as const;

export const REREAD = {
  heading: "The owner has changed this car's file",
  line: (count: number): string => `Findings changed since you read them: ${count}`,
  changedCard: 'Changed. Read it again.',
  offerWaiting: 'Your offer needs a re-read',
} as const;

export const removedPlaceholder = (version: number): string => `Removed by the owner in version ${version}`;

export const LINK_PAGE = {
  endedHeading: 'This link has ended',
  endedBody: 'Ask the owner for a new link.',
  unknownHeading: 'We could not find that link',
  unknownCarHeading: 'We could not find that car file',
  endedDuringReplay: 'This link has ended, so these items were not saved.',
} as const;

export const findingAnnouncement = (position: number, total: number): string => `Finding ${position} of ${total}`;

export const SIGN_IN_AGAIN_LINE = 'Your session has ended. Sign in to carry on.';

export const acceptDialogLines = (amount: string, buyerName: string, closedCount: number): readonly [string, string] => [
  `Accept ${amount} from ${buyerName}?`,
  `Other open offers closed: ${closedCount}`,
];

export const STANDING_LABEL = {
  panels: (read: number, gaugeable: number) => `Read: ${read} of ${gaugeable}`,
  findings: (n: number) => `Findings: ${n}`,
  evidence: (n: number) => `Files: ${n}`,
  record: (n: number) => `Open advisories: ${n}`,
  publish: (n: number) => `Blockers: ${n}`,
  people: (n: number) => `Active links: ${n}`,
  viewings: (held: number, slots: number) => `Slots held: ${held} of ${slots}`,
  offers: (n: number) => `Live offers: ${n}`,
  alerts: (n: number) => `Failed alerts: ${n}`,
} as const;

export const BUYER_POLL_LINES = {
  published: (version: number) => `The owner has published version ${version}`,
  listing: (word: string) => `This car is now ${word}`,
  offer: (word: string) => `Your offer is now ${word}`,
  slotsFree: (count: number) => `Viewing slots free: ${count}`,
} as const;

export const SECTIONS = [
  { id: 'panels', heading: 'Panels and readings' },
  { id: 'findings', heading: 'Findings' },
  { id: 'evidence', heading: 'Evidence' },
  { id: 'record', heading: 'Test record' },
  { id: 'publish', heading: 'Publish' },
  { id: 'people', heading: 'People' },
  { id: 'viewings', heading: 'Viewings' },
  { id: 'offers', heading: 'Offers' },
  { id: 'alerts', heading: 'Alerts' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
