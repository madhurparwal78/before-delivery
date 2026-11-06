import { BASE_LABELS, formatDate, formatMoney, type BaseKey } from './format.js';
import { ZONES, localDate, localTime } from './zone.js';

/** `Sat 3 Jul 2027, 17:00 Split time` for an instant, in the named base's zone. */
export function formatInstant(instant: string | Date, base: BaseKey = 'split'): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const zone = ZONES[base];
  return `${formatDate(localDate(zone, date))}, ${localTime(zone, date)} ${BASE_LABELS[base]} time`;
}

export const FIELD_ERRORS = {
  required: 'This field is required.',
  maxLength: (max: number): string => `Use at most ${max} characters.`,
  email: 'Enter an email address like name@example.com.',
  password: 'Use at least 10 characters.',
  options: 'Choose one of the listed options.',
  crewYacht: 'Choose a yacht for a crew member.',
  dateFormat: 'Enter a date as YYYY-MM-DD.',
  timeFormat: 'Enter a time as HH:MM.',
  numberRange: (min: string, max: string): string => `Enter a number from ${min} to ${max}.`,
  twoDecimals: 'Use at most two decimals.',
  wholeRange: (min: number, max: number): string => `Enter a whole number from ${min} to ${max}.`,
  moneyRange: (min: string, max: string): string => `Enter an amount from ${min} to ${max}.`,
  weekStart: 'Choose a Saturday after today.',
  saturday: 'Choose a Saturday.',
  arrivalDate: 'Choose today or a later date.',
  effectiveDate: 'Choose a date after today.',
  speed: 'Choose a speed from 4.0 to 12.0 kn in 0.5 kn steps.',
  springGap: "That time doesn't exist here — the clocks go forward an hour.",
  tooManyLegs: 'Use at most 12 legs.',
  sameAnchorage: 'Choose a different anchorage.',
  slotStart: 'Choose a slot that starts on the hour or half hour.',
  rotaSlot: 'Use slot start times inside this week.',
  passportNumber: 'Enter 5 to 20 capital letters or digits.',
  dateOfBirth: 'Enter a date of birth in the past.',
  photoContent: 'Choose a JPEG or PNG photo.',
  exchangeRate: 'Enter a rate above 0 with at most six decimals.',
  logLine: (line: number): string => `Line ${line} isn't a valid log entry.`,
  emptyLog: 'The log has no entries.',
  cursor: "This cursor isn't valid.",
} as const;

export const MESSAGES = {
  signInRefused: "The email or password isn't right.",
  sessionEnded: 'Your session has ended. Sign in again — what you typed is kept.',
  accessRemoved:
    'Your access to this workspace was removed. Ask your fleet director if this is a mistake.',
  holdPlaced: (clientName: string, yachtName: string, weekDate: string, time: string): string =>
    `Hold placed for ${clientName} on ${yachtName}, week of ${weekDate}. It lapses ${time}.`,
  joinedLine: (clientName: string, position: number, yachtName: string, weekDate: string): string =>
    `${clientName} is number ${position} in line for ${yachtName}, week of ${weekDate}.`,
  weekTaken: (taker: string, time: string): string => `Too late — ${taker} took this week at ${time}.`,
  weekBooked: 'This week is already booked.',
  holdReleased: 'Hold released.',
  holdLapsed: (time: string): string => `Too late — this hold lapsed at ${time}.`,
  holdNotLive: 'This hold is no longer live.',
  yachtWithdrawnHold: 'This yacht has been withdrawn from charter.',
  depositRecorded: (clientEmail: string): string =>
    `Deposit recorded. Charter invoiced and confirmation sent to ${clientEmail}.`,
  billingUnavailable:
    'Invoicing is unavailable right now — no charter was recorded and no mail was sent. Try again in a few minutes.',
  mailUnavailable:
    'Mail is unavailable right now — no charter was recorded. Try again in a few minutes.',
  chargeAnnouncement: (leg: number, anchorage: string, charge: number, belowReserve: boolean): string =>
    belowReserve
      ? `Leg ${leg} to ${anchorage}: arrives with ${charge}% — below reserve.`
      : `Leg ${leg} to ${anchorage}: arrives with ${charge}%.`,
  passageCreated: 'Passage created.',
  passageSaved: 'Passage saved.',
  passageSent: 'Passage sent to crew.',
  sendBelowReserve: 'A leg arrives below the 20% reserve — raise its charge before sending.',
  sendNoLegs: 'Add at least one leg before sending.',
  rotaSaved: 'Rota saved.',
  restRuleBroken: (crewName: string, ruleText: string, from: string, to: string): string =>
    `${crewName} breaks the rest rules: ${ruleText}, from ${from} to ${to}.`,
  staleRota: (memberName: string, baseTime: string): string =>
    `${memberName} saved this rota at ${baseTime}. Your changes are still here — check them and save again.`,
  berthBooked: (code: string, arrivalDate: string): string => `Berth ${code} booked from ${arrivalDate}.`,
  berthDoesNotFit: (yachtName: string, code: string): string =>
    `${yachtName} doesn't fit berth ${code}.`,
  berthTaken: (code: string): string => `Berth ${code} is already booked for one of those nights.`,
  slotBooked: (baseTime: string): string => `Shore power booked for ${baseTime}.`,
  slotTaken: (slotTaker: string, time: string): string =>
    `Too late — ${slotTaker} took this slot at ${time}.`,
  slotPast: 'That slot has already started.',
  slotAlreadyYours: 'This yacht already has that slot.',
  movementLogged: (quantity: number, unit: string, kind: string, onHand: number): string =>
    `Logged ${quantity} ${unit} ${kind} — ${onHand} ${unit} on hand.`,
  insufficientStock: (onHand: number, unit: string): string =>
    `Only ${onHand} ${unit} on hand — you can't log more than that.`,
  itemAdded: (itemName: string): string => `${itemName} added.`,
  itemExists: (itemName: string): string => `There's already an item called ${itemName}.`,
  itemRemoved: (itemName: string): string => `${itemName} removed.`,
  logUploaded: (dayCount: number): string =>
    `Log uploaded — ${dayCount} ${dayCount === 1 ? 'day' : 'days'} charted.`,
  logTooLarge: 'That log is larger than 2,000,000 bytes.',
  photoSaved: (guestName: string): string => `Passport photo saved for ${guestName}.`,
  photoTooLarge: 'That photo is larger than 5,000,000 bytes.',
  storageUnavailable: 'Uploads are unavailable right now — nothing was saved. Try again in a few minutes.',
  manifestSaved: 'Manifest saved.',
  guestAdded: (guestName: string): string => `${guestName} added.`,
  manifestFull: (maxGuests: number): string => `This yacht takes at most ${maxGuests} guests.`,
  manifestPageSent: (leadGuestEmail: string): string => `Manifest page sent to ${leadGuestEmail}.`,
  brokerPageSent: (brokerEmail: string): string => `Broker page sent to ${brokerEmail}.`,
  pageEnded: 'Page ended.',
  charterClosed: (time: string): string => `Charter closed. Passport details will be erased ${time}.`,
  charterAlreadyClosed: 'This charter is already closed.',
  profileSaved: 'Profile saved.',
  yachtWithdrawn: (yachtName: string): string => `${yachtName} withdrawn from sale.`,
  yachtBackOnSale: (yachtName: string): string => `${yachtName} is back on sale.`,
  tariffAdded: (date: string): string => `Tariff added from ${date}.`,
  exchangeTableAdded: (date: string): string => `Exchange table added from ${date}.`,
  dateExists: "There's already one from that date.",
  tooManyBrokerHolds: (seconds: number): string =>
    `Too many hold requests — try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
  unexpected: 'Something went wrong — nothing was changed. Try again.',
} as const;

export const PAGES = {
  gone: {
    heading: "This yacht isn't available",
    body: "It's been withdrawn from charter. Browse the fleet for yachts that are sailing.",
  },
  ended: {
    heading: 'This link has ended',
    body: 'Links from Tidewright stop working after a set time or when a new one is sent. Ask your charter contact for a new link.',
  },
  notFound: {
    heading: "We couldn't find that page",
    body: 'Check the address, or sign in to your workspace.',
  },
} as const;

export const REST_RULE_TEXT = {
  max_gap_14h: 'no more than 14 hours between rest periods',
  min_rest_24h: 'at least 10 hours of rest in any 24 hours',
  min_rest_168h: 'at least 77 hours of rest in any 7 days',
  rest_periods_24h: 'rest in no more than two periods, one of at least 6 hours',
} as const;

export type RestRule = keyof typeof REST_RULE_TEXT;

export const MOVEMENT_KIND_WORDS = {
  received: 'received',
  used: 'used',
  spoiled: 'spoiled',
} as const;

export function moneyRange(minMinor: number, maxMinor: number, currency: string): string {
  return FIELD_ERRORS.moneyRange(formatMoney(minMinor, currency), formatMoney(maxMinor, currency));
}
