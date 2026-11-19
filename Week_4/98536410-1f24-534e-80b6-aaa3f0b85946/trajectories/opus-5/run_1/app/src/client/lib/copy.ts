export const COPY = {
  signInWrong: 'Email or password is wrong.',
  signInPending: 'Signing in...',
  sessionEnded: 'Your session ended. Sign in to continue.',
  somethingWrong: 'Something went wrong. Try again.',
  loadingShops: 'Loading shops.',
  noShopsMatch: 'No shops match these filters.',
  saving: 'Saving...',
  searching: 'Searching...',
  rankingShops: 'Ranking shops...',
  cartEmpty: 'Your cart is empty.',
  holdingItems: 'Holding your items...',
  oneMinuteLeft: 'One minute left on your hold.',
  checkingHold: 'Checking your hold...',
  holdEnded: 'Your hold has ended. Hold again to keep these items.',
  noSlots: 'No collection times in the next 7 days.',
  noArea: 'Choose your area on a product page first.',
  slotGone: 'That collection time is no longer available. Pick another.',
  placingOrder: 'Placing your order...',
  orderInProgress: 'Your order is still being placed. Wait a moment.',
  placeOrderPaused: 'Placing orders is paused until order documents can be stored.',
  documentPending: 'Preparing document...',
  documentPaused: 'Order documents are unavailable until storage returns.',
  labelPending: 'Preparing label...',
  labelPaused: 'Return labels are paused until storage returns.',
  countSaved: 'Count saved.',
  tillSaleRecorded: 'Till sale recorded.',
  publishing: 'Publishing...',
  loadingSlots: 'Loading slots.',
  previewDateError: 'Pick a date from 2026 to 2030.',
  loadingMoreOrders: 'Loading more orders.',
  noOrders: 'No orders match.',
  verifyingHistory: 'Checking history...',
  storageNotice:
    'Order storage is unreachable. Placing orders, order documents and return labels are paused.',
  notFound: "We couldn't find that page.",
  landingSupport:
    'Every shop in your group, every tin on its shelves, every collection hour in its own local time.',
  reasonRequired: 'Give a reason.',
  quantityRange: 'Enter a whole number from 1 to 999.',
  returnTooMany: 'More than can be returned.',
  closesAfterOpens: 'Closing time must be after opening time.',
  halfHourTimes: 'Use a time on the hour or half hour.',
  effectiveFromRange: 'Pick a date from today to 60 days ahead.',
} as const;

/** Euros with a comma decimal mark, an ordinary space and the euro sign. */
export function amount(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  return `${sign}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, '0')} €`;
}

export function wholeNumber(value: number): string {
  return String(Math.round(value));
}

export function kilometres(value: number): string {
  return value.toFixed(2);
}

export function minuteSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] as string;
}

/** The weekday of an ISO date, for the collection day radio labels. */
export function weekdayOfDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_NAMES[(index + 6) % 7] as string;
}

export function lisbonClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function lisbonStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const find = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${find('year')}-${find('month')}-${find('day')} ${find('hour')}:${find('minute')}`;
}
