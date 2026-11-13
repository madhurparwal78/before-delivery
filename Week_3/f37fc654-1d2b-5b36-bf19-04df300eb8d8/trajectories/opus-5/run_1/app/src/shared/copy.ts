/**
 * Every published string. Both the server and the browser read them from here
 * so a message renders character for character wherever it appears.
 */

export type ServiceName =
  | 'postgres'
  | 'keycloak'
  | 'killbill'
  | 'mailpit'
  | 'minio'
  | 'gotenberg'
  | 'svix'
  | 'ntfy'
  | 'renderProvider';

export const SERVICE_NAMES: readonly ServiceName[] = [
  'postgres', 'keycloak', 'killbill', 'mailpit', 'minio',
  'gotenberg', 'svix', 'ntfy', 'renderProvider',
];

export const OUTAGE_BANNERS: Record<ServiceName, string> = {
  killbill: 'Payments are paused — our billing system isn\'t answering. Nothing has been charged.',
  mailpit: 'Emails are delayed — receipts and notices will arrive once our mail service is back.',
  minio: 'Uploads are paused — our file store isn\'t answering. Nothing was saved.',
  gotenberg: 'Documents are delayed — PDFs will appear here once our document service is back.',
  svix: 'CRM updates are delayed — they\'ll be sent once our webhook service is back.',
  ntfy: 'Crew alerts are delayed — they\'ll be posted once our alert service is back.',
  renderProvider:
    'Concept previews are delayed — requests are queued and will start once our render partner is back.',
  keycloak:
    'Sign-in is paused — our sign-in service isn\'t answering. If you\'re already signed in, you can keep working for now.',
  postgres: 'The studio is offline — we can\'t reach our records. Try again in a minute.',
};

export const LANDING_HEADLINE = 'Light for dark rooms, made to commission.';

export const LANDING_CAPTIONS: readonly string[] = [
  'A wall that sees the room.',
  'It answers the people in front of it.',
  'Built for one venue, by hand.',
  'Up close, it\'s light.',
  'In your room, on your day.',
];

export const BRIEF_INTRO_LINE = 'Hi. Six questions, then your room.';

export const BRIEF_QUESTIONS: readonly string[] = [
  'What should stand in the room?',
  'Where will it stand?',
  'How big is the room?',
  'Which wall has the main door?',
  'How many people at once?',
  'Anything else to try?',
];

export const ROOM_READY_HEADING = 'Your room is ready.';

export const KEY_CHORD_TEXT = 'ENTER \u21b5 \u00b7 SHIFT+ENTER new line';
export const KEY_CHORD_CHIPS = 'ENTER \u21b5 to continue';
export const KEY_CHORD_ROOM = 'ARROWS move \u00b7 SHIFT+ARROWS 1 m \u00b7 R rotate \u00b7 ENTER \u21b5 drop';

export const EMPTY_STATES = {
  commissions: 'Nothing commissioned yet. Start with the room?',
  studio: 'Nothing commissioned yet. Start with the room?',
  files: 'No files yet. Add a venue photo?',
  webhooks: 'No CRM deliveries yet. Add your endpoint?',
  installDays: 'No install days yet. Check back after a booking?',
  jobs: 'No jobs waiting. All quiet?',
} as const;

export const SIGN_IN_ERROR_PAGE = {
  heading: 'Sign-in didn\'t complete',
  text: 'That sign-in link has expired, was already used or was opened in a different browser. Start again from Sign in.',
} as const;

export const INVITE_EXPIRED_PAGE = {
  heading: 'This invite has expired',
  text: 'Ask Spindrift Rooms for a new link.',
} as const;

export const INVITE_INVALID_PAGE = {
  heading: 'This invite link isn\'t valid',
  text: 'It may have been replaced or withdrawn. Ask Spindrift Rooms for a new link.',
} as const;

export const SESSION_ENDED_MESSAGE =
  'Your session ended. Sign in again — what you entered is kept.';

export const HOLD_ENDED_HEADING = 'Your hold has ended';

export const PAYMENT_TEST_MODE_NOTE = 'Test mode — no real card is charged.';

/** Brief progress announcements. */
export function briefStepSaved(nextQuestion: number): string {
  return `Answer saved. Question ${nextQuestion} of 6.`;
}
export const BRIEF_COMPLETE = 'Brief complete. Your room is ready.';

/** Upload announcements. */
export function uploadPending(fileName: string): string {
  return `Uploading ${fileName}...`;
}
export function uploadStored(fileName: string, sizeBytes: number, sha256: string): string {
  return `Stored ${fileName} — ${sizeBytes} bytes, SHA-256 ${sha256}.`;
}
export function uploadTooLarge(fileName: string, limitBytes: number, kindLabel: string): string {
  return `${fileName} is over the ${limitBytes}-byte limit for a ${kindLabel}.`;
}
export function uploadWrongType(fileName: string, kindLabel: string): string {
  return `${fileName} isn\'t a ${kindLabel}.`;
}

/** Preview announcements. */
export const PREVIEW_QUEUED = 'Preview queued.';
export function previewProgress(progress: number): string {
  return `Preview rendering — ${progress}% done.`;
}
export const PREVIEW_READY = 'Preview ready.';
export const PREVIEW_FAILED = 'The preview didn\'t render. Try again with another photo.';
export const REFERENCE_REFUSED = 'That address can\'t be used for a reference image.';
export const REFERENCE_FETCH_FAILED = 'We couldn\'t fetch an image from that address.';

/** Placement announcements. */
export function piecePlaced(label: string, x: string, y: string, rotationDeg: number): string {
  return `Placed ${label} at ${x} m, ${y} m, turned ${rotationDeg}°.`;
}
export const LAYOUT_VERSION_CONFLICT =
  'This layout changed in another window. Showing the latest version.';

/** Quote announcements. */
export function quoteUpdated(amount: string): string {
  return `Quote updated: ${amount} including tax.`;
}

/** Hold announcements. */
export function holdPlaced(date: string): string {
  return `Held ${date}. Finish checkout before the timer runs out.`;
}
export function dayTaken(nextFreeDays: readonly string[]): string {
  if (nextFreeDays.length === 0) {
    return 'That day was just taken. There are no free days in the next year.';
  }
  const names =
    nextFreeDays.length === 1
      ? nextFreeDays[0]
      : `${nextFreeDays.slice(0, -1).join(', ')} and ${nextFreeDays[nextFreeDays.length - 1]}`;
  return `That day was just taken. The next free days are ${names}.`;
}
export function holdEnded(date: string): string {
  return `Your hold on ${date} has ended. Pick a day again to finish — your details are still here.`;
}

/** Agreement and payment announcements. */
export const AGREEMENT_SIGNED = 'Agreement signed. Your contract PDF is being prepared.';
export const QUOTE_EXPIRED = 'This quote has expired. Refresh the quote to continue.';
export const PAYMENT_PENDING = 'Confirming payment with the billing system...';
export function paymentPaid(amount: string): string {
  return `Paid ${amount}. Your receipt is on its way.`;
}
export const PAYMENT_FAILED = 'The payment didn\'t go through. Nothing has been charged.';
export const PAYMENT_KEY_REUSED =
  'This payment key was already used for a different payment. Close this sheet and try again.';
export const ALREADY_PAID = 'This is already paid.';

/** Funder announcements. */
export const FUNDERS_SAVED = 'Funders saved. Invites are on their way.';
export const FUNDERS_SHARE_SUM = 'Shares must add up to 100.00%.';
export const FUNDERS_LOCKED = 'Funders are locked once a sponsor accepts or the deposit is paid.';
export const FUNDERS_TOO_MANY = 'Up to three sponsors per commission.';
export const FUNDER_SHARE_MINIMUM = 'Each share must be at least 0.01%.';
export const FUNDER_EMAIL_INVALID = 'Enter a valid email.';

/** Invite announcements. */
export const INVITE_ACCEPTED = 'You\'re in. Here\'s your share.';
export const INVITE_TAKEN = 'This invite was already accepted by another account.';

/** Transition announcements. */
export const TRANSITION_MESSAGES = {
  concept_approved: 'Concept approved.',
  fabricating: 'Fabrication started.',
  installed: 'Installation confirmed.',
  accepted: 'Acceptance signed.',
  cancelled: 'Commission cancelled.',
} as const;
export const TRANSITION_UNAVAILABLE = 'That step isn\'t available yet.';

/** CRM announcements. */
export const CRM_SAVED = 'Endpoint saved.';
export const CRM_URL_INVALID = 'Enter a full http or https address.';
export const CRM_SVIX_DOWN =
  'Couldn\'t save the endpoint — our webhook service isn\'t answering. Try again in a minute.';

/** Maintenance announcements. */
export function maintenanceStarted(planLabel: string): string {
  return `Maintenance started on the ${planLabel} plan.`;
}
export function maintenanceSwitched(planLabel: string): string {
  return `Switched to the ${planLabel} plan. Kill Bill\'s proration is below.`;
}
export const MAINTENANCE_SAME_PLAN = 'You\'re already on that plan.';

/** Board announcements. */
export function boardPayment(payerName: string, amount: string, commissionTitle: string): string {
  return `${payerName} paid ${amount} toward ${commissionTitle}.`;
}

/** Field errors from the API. */
export const FIELD_ERRORS = {
  installationType: 'Pick what should stand in the room.',
  title: 'Give the piece a name of 2 to 80 characters.',
  venueId: 'Pick a venue from the list.',
  widthM: 'Enter a width from 4 to 60 metres in half-metre steps.',
  depthM: 'Enter a depth from 4 to 60 metres in half-metre steps.',
  doorWall: 'Pick the wall with the main door.',
  audience: 'Pick how many people will be there at once.',
  addOns: 'Pick from the listed extras.',
  notes: 'Keep notes to 2,000 characters or fewer.',
  size: 'Pick Compact, Standard or Grand.',
  uploadKind: 'Pick brief_pdf, venue_photo or installation_glb.',
  signatureName: 'Type your full name, 2 to 80 characters.',
  acceptTerms: 'Tick the box to agree.',
  idempotencyKey: 'Send an Idempotency-Key of 1 to 64 letters, digits, - or _.',
  nameOnCard: 'Enter the name on the card.',
  cardNumber: 'Check the card number.',
  holdDate: 'Pick a day from 21 days to one year ahead.',
  daysSpan: 'Ask for at most 62 days.',
} as const;

/** Crew alert titles. */
export function slotConfirmedTitle(venueName: string, date: string): string {
  return `Slot confirmed — ${venueName} — ${date}`;
}
export function loadInTomorrowTitle(venueName: string, date: string): string {
  return `Load-in tomorrow — ${venueName} — ${date}`;
}
export function placementChangedTitle(commissionTitle: string): string {
  return `Placement changed — ${commissionTitle}`;
}
export function crewAlertBody(
  commissionTitle: string,
  venueName: string,
  date: string,
  jobId: string,
): string {
  return `${commissionTitle} at ${venueName} on ${date}. Ref ${jobId}.`;
}

/** Email subjects and bodies. */
export function receiptSubject(commissionTitle: string, label: string): string {
  return `Receipt — ${commissionTitle} — ${label}`;
}
export function receiptBody(
  amount: string,
  work: string,
  tax: string,
  invoiceNumber: string,
  paymentId: string,
): string {
  return [
    `Amount paid: ${amount}`,
    `Work: ${work}`,
    `Sales tax: ${tax}`,
    `Kill Bill invoice: ${invoiceNumber}`,
    `Payment reference: ${paymentId}`,
  ].join('\n');
}
export function sponsorInviteSubject(commissionTitle: string): string {
  return `You\'re invited to co-fund ${commissionTitle}`;
}
export function sponsorInviteBody(link: string, amount: string, percent: string, expiry: string): string {
  return [
    link,
    `Your share: ${amount} (${percent}%)`,
    `This link works until ${expiry}`,
  ].join('\n');
}
export function milestoneDueSubject(label: string, commissionTitle: string): string {
  return `${label} is due — ${commissionTitle}`;
}
export function milestoneDueBody(amount: string, due: string): string {
  return [`Amount due: ${amount}`, `Due by: ${due}`].join('\n');
}
export function milestonePaidSubject(label: string, commissionTitle: string): string {
  return `${label} is paid — ${commissionTitle}`;
}
export function milestonePaidBody(commissionTitle: string, label: string, amount: string): string {
  return `${label} on ${commissionTitle} is paid. Amount: ${amount}`;
}
export function holdEndedSubject(date: string): string {
  return `Your hold on ${date} has ended`;
}
export function holdEndedBody(commissionTitle: string, date: string): string {
  return `Your hold on ${date} for ${commissionTitle} has ended. Pick a day again to finish.`;
}
