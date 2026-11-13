import { TimeZoneId, zoneLabel } from './time';
import { Cadence } from './money';

export const cadenceLabel: Record<Cadence, string> = {
  sixMonths: 'Every 6 months',
  yearly: 'Yearly',
};

export const sexLabel: Record<string, string> = { female: 'Female', male: 'Male' };

export const flagLabel: Record<string, string> = {
  belowRange: 'Below range',
  inRange: 'In range',
  optimal: 'Optimal',
  aboveRange: 'Above range',
};

export const drawStateLabel: Record<string, string> = {
  booked: 'Booked',
  collected: 'Collected',
  ready: 'Ready',
  released: 'Released',
  cancelled: 'Cancelled',
};

export const packetTimeLabel: Record<string, string> = {
  morning: 'Morning',
  evening: 'Evening',
  split: 'Split',
};

export const accountStateLabel: Record<string, string> = {
  active: 'Active',
  closing: 'Closing',
  erasing: 'Erasing',
  erased: 'Erased',
};

export const membershipStateLabel: Record<string, string> = {
  free: 'Free',
  pending: 'Plus · Pending',
  active: 'Plus · Active',
  cancelled: 'Plus · Ending',
};

export const roleLabel: Record<string, string> = {
  owner: 'Practice owner',
  specialist: 'Longevity specialist',
  coordinator: 'Care coordinator',
  billingLead: 'Billing lead',
  member: 'Member',
};

export const ageBandLabel: Record<string, string> = {
  age18To39: '18–39',
  age40To59: '40–59',
  age60Plus: '60 and over',
};

export const visitPageStateLabel: Record<string, string> = {
  live: 'Live',
  ended: 'Ended',
  none: 'None',
};

export const planStateLabel: Record<string, string> = { draft: 'Draft', published: 'Published' };

export const threadStateLabel: Record<string, string> = { open: 'Open', handled: 'Handled' };

/** `<date>, <HH:MM> Phoenix time · <HH:MM> <city> time`, the Phoenix time once for a Phoenix member. */
export function twoTimeForm(
  date: string,
  phoenixTime: string,
  memberTime: string,
  memberZone: TimeZoneId,
): string {
  if (memberZone === 'phoenix') return `${date}, ${phoenixTime} Phoenix time`;
  return `${date}, ${phoenixTime} Phoenix time · ${memberTime} ${zoneLabel(memberZone)}`;
}

export function oneTimeForm(date: string, time: string, zone: TimeZoneId): string {
  return `${date}, ${time} ${zoneLabel(zone)}`;
}

export const copy = {
  working: 'Working on it.',
  signInFailed: "That email and password don't match.",
  sessionEnded: 'Your session ended. Sign in again to keep going — what you typed is still here.',
  stateServed: (name: string) => `Yes — we serve members in ${name}.`,
  stateNotServed: (name: string) => `Not yet — we can't serve members in ${name}.`,
  accountCreated: 'Your free account is ready.',
  joinActive: 'Welcome to Plus. Your membership is active.',
  joinPending: 'Your payment is being confirmed. Plus shows Active once it is.',
  cadenceSaved: 'Your cadence changes at your next renewal.',
  cancelSaved: 'Plus stays until the end of your paid period.',
  renewsLine: (date: string) => `Renews ${date}`,
  pendingCadenceLine: (cadence: Cadence, date: string) =>
    `${cadenceLabel[cadence]} from ${date}`,
  plusUntilLine: (date: string) => `Plus until ${date}`,
  paymentsUnavailable: 'Payments are unavailable right now. Nothing was charged.',
  drawBookedStaff: (twoTime: string) => `Draw booked for ${twoTime}.`,
  drawBookedMember: (date: string, time: string, zone: TimeZoneId) =>
    `Draw booked for ${date}, ${time} ${zoneLabel(zone)}.`,
  drawMovedStaff: (twoTime: string) => `Draw moved to ${twoTime}.`,
  drawMovedMember: (date: string, time: string, zone: TimeZoneId) =>
    `Draw moved to ${date}, ${time} ${zoneLabel(zone)}.`,
  drawCancelled: 'Draw cancelled.',
  slotLostStaff: (winner: string, date: string, time: string, zone: TimeZoneId) =>
    `That slot was just taken by ${winner}. The next free slot is ${date}, ${time} ${zoneLabel(zone)}.`,
  slotLostMember: (date: string, time: string, zone: TimeZoneId) =>
    `That slot was just taken. The next free slot is ${date}, ${time} ${zoneLabel(zone)}.`,
  plusRequired: 'Draws are part of Plus.',
  changesClosed: (date: string, zone: TimeZoneId) =>
    `Changes closed at ${date}, 18:00 ${zoneLabel(zone)}. Message your care team to change this draw.`,
  addressRequired: 'Add your home address before booking a draw.',
  visitPageEndedByStaff: 'Visit page ended.',
  visitPageSent: (phlebotomist: string) => `A new visit page is on its way to ${phlebotomist}.`,
  visitPageEnded: 'This visit page has ended.',
  addressLater: 'Address shown on the visit day.',
  kitCodeAdded: (kitCode: string) => `Kit code ${kitCode} added.`,
  kitCodeCheck: "That kit code isn't valid. Check the last character.",
  kitCodeShape: 'Enter a kit code like KT-1000042-7.',
  kitCodeRequired: 'Enter at least one kit code before marking collected.',
  notDrawDay: 'You can mark this draw collected on the visit day.',
  markedCollected: (time: string, zone: TimeZoneId) =>
    `Marked collected at ${time} ${zoneLabel(zone)}.`,
  previewSummary: (matched: number, unknown: number, refused: number) =>
    `${matched} matched, ${unknown} unknown, ${refused} refused. Nothing is saved yet.`,
  resultsSaved: 'Results saved and the report is stored.',
  reportStoreUnavailable: 'The report store is unavailable right now. Nothing was saved.',
  attachmentStoreUnavailable: "Attachments can't be stored right now. Nothing was sent.",
  resultsReleased: (firstName: string) =>
    `Results released. A notice is on its way to ${firstName}.`,
  notReady: 'Results can be released once the report is stored.',
  rangesSaved: (marker: string, date: string) =>
    `New ranges for ${marker} take effect on ${date}.`,
  rangesAlreadyChange: (marker: string, date: string) =>
    `Ranges for ${marker} already change on ${date}.`,
  correctionSaved: (marker: string) => `${marker} corrected.`,
  correctionArrived: (name: string, marker: string, time: string, zone: TimeZoneId) =>
    `${name} corrected ${marker} at ${time} ${zoneLabel(zone)}. The band shows the corrected value.`,
  draftSaved: 'Draft saved.',
  planPublished: 'Plan published.',
  planByline: (date: string, name: string) => `Published ${date} by ${name}`,
  newerPlan: (name: string, time: string) =>
    `${name} published a newer plan at ${time} Phoenix time. Your changes are still here.`,
  blendSaved: 'Blend saved.',
  packetFull: (packet: 'morning' | 'evening') =>
    packet === 'morning'
      ? 'The morning packet holds at most 4 capsules.'
      : 'The evening packet holds at most 4 capsules.',
  messageSent: 'Message sent.',
  replySent: 'Reply sent.',
  threadHandled: 'Thread marked handled.',
  messageLimit: (time: string, zone: TimeZoneId) =>
    `Too many messages for now. You can send another at ${time} ${zoneLabel(zone)}.`,
  downloadLimit: (time: string, zone: TimeZoneId) =>
    `Too many downloads for now. You can download again at ${time} ${zoneLabel(zone)}.`,
  downloadStarted: 'Your results history is downloading.',
  accountClosing: (date: string, time: string, zone: TimeZoneId) =>
    `Your account is closing. It will be erased at ${date}, ${time} ${zoneLabel(zone)} unless the practice brings it back.`,
  writeToClosing: 'This account is closing.',
  accountRestored: (name: string) => `${name}'s account is back.`,
  restoreAfterWait: 'This account is already being erased.',
  erasedMember: 'Erased member',
  profileSaved: 'Profile saved.',
  passwordChanged: 'Password changed. Your other sessions have ended.',
  notFound: "We can't find that page.",

  // Field and state errors
  fieldName: 'Enter your full name.',
  fieldEmail: 'Enter a valid email address.',
  fieldPassword: 'Use at least 12 characters.',
  fieldDateOfBirth: 'Members must be 18 or older.',
  fieldChooseOption: 'Choose one of the options.',
  fieldDateForm: 'Enter the date as YYYY-MM-DD.',
  fieldMonthForm: 'Choose a month as YYYY-MM.',
  fieldPostalCode: 'Enter a 5-digit ZIP code.',
  fieldCurrentPassword: "That password isn't right.",
  emailTaken: 'An account with this email already exists.',
  ownerStays: 'The practice owner stays the owner.',
  alreadyPlus: 'You already have Plus.',
  notPlus: "You don't have Plus.",
  alreadyEnding: 'Plus is already set to end.',
  sameCadence: "You're already on that cadence.",
  requestKeyReused: 'This request key was already used for a different request.',
  staffDateWindow: 'Choose a date within 400 days of today.',
  memberDateWindow: 'Choose a date from tomorrow up to 28 days ahead.',
  slotNotPublished: 'Choose a slot from the published times.',
  phlebotomistState: (state: string) => `This phlebotomist doesn't serve ${state}.`,
  collectedAtRequired: 'Give the collected time for a past draw.',
  notBooked: 'Only a booked draw can change.',
  notUpcoming: 'This draw has no visit page to send.',
  alreadyCollected: 'This draw is already collected.',
  resultsHeaderRow: 'The first row must be kitCode,marker,value,unit.',
  resultsFileEncoding: 'The results file must be UTF-8 text.',
  reportRequired: "Attach the lab's report PDF.",
  reportNotPdf: 'The report must be a PDF file.',
  notCollected: 'Results can be brought in for a collected draw.',
  reportExists: 'This draw already has a different report.',
  markerChoice: 'Choose a marker from the catalog.',
  valueNotNumber: "Value isn't a number.",
  rangeEffectiveFrom: 'Choose today or a later date.',
  rangeAllRows: 'Give all six rows.',
  rangeBounds: 'Bounds must run low ≤ optimal low ≤ optimal high ≤ high.',
  planSectionLength: 'Keep each section to 20,000 characters.',
  planAlreadyPublished: 'This plan is already published.',
  capsulesWhole: 'Use a whole number of capsules, 1 or more.',
  ingredientChoice: 'Choose an ingredient from the catalog.',
  ingredientOnce: 'Each ingredient appears once.',
  messageBodyRequired: 'Write a message first.',
  messageBodyLength: 'Keep your message to 2,000 characters.',
  attachmentKind: 'Attach a PDF, JPEG or PNG file.',
  drawQueryChoice: 'Choose a date range, a state or a member.',
  cursorInvalid: 'That page link is no longer valid.',
  notClosing: "This account isn't closing.",
  rowNeedsFields: 'Row needs kitCode, marker, value and unit.',
  noMarkerMatch: (written: string) => `No marker matches "${written}".`,
  kitCodeNotOnDraw: "Kit code isn't on this draw.",
  unitNotAccepted: (marker: string) => `Unit isn't accepted for ${marker}.`,
  alreadySavedDifferent:
    'Already saved with a different value; correct it on the result instead.',
  tooLargeRequest: 'That request is too large.',
  tooLargeResultsFile: 'The results file must be at most 1,000,000 bytes.',
  tooLargeReport: 'The report must be at most 10,000,000 bytes.',
  tooLargeAttachment: 'Attachments must be at most 5,000,000 bytes.',
};
