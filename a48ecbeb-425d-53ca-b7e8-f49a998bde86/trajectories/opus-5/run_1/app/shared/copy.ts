import { formatCents } from './money.js';

const dollars = (cents: number) => `$${formatCents(cents)}`;

export const crateCopy = {
  added: (flavour: string, count: number, stock: number, phrase: string) =>
    `Added ${flavour}. ${count} of 12 cans in your crate. ${stock} left. ${phrase}`,
  filled: (added: number, flavour: string, count: number, stock: number, phrase: string) =>
    `Added ${added} ${flavour}. ${count} of 12 cans in your crate. ${stock} left. ${phrase}`,
  removed: (flavour: string, count: number, phrase: string) =>
    `Removed ${flavour}. ${count} of 12 cans in your crate. ${phrase}`,
  soldOut: (flavour: string, count: number, stock: number, phrase: string) =>
    `Couldn't add ${flavour}: sold out. ${count} of 12 cans in your crate. ${stock} left. ${phrase}`,
  dropLimit: (flavour: string, count: number, stock: number, phrase: string) =>
    `Couldn't add ${flavour}: you can hold up to 6 cans of a limited drop. ${count} of 12 cans in your crate. ${stock} left. ${phrase}`,
  crateFull: (flavour: string, count: number, stock: number, phrase: string) =>
    `Couldn't add ${flavour}: your crate is full. ${count} of 12 cans in your crate. ${stock} left. ${phrase}`,
  holdExpired: 'Your hold ended and the cans went back on the shelf.',
  storeOutage: "The shop can't update your crate right now. Try again in a moment.",
} as const;

export const flavourCardCopy = {
  stockUnavailable: 'Stock is unavailable right now.',
  liveStockPaused: 'Live stock paused. Counts refresh when you add a can.',
} as const;

export const totalsCopy = {
  success: (totalCents: number, provinceDisplayName: string) =>
    `Total ${dollars(totalCents)} with shipping to ${provinceDisplayName}.`,
  outage: "Totals can't be calculated right now. Try again in a moment.",
} as const;

export const checkoutCopy = {
  pending: 'Processing payment. Keep this page open.',
  slow: "This is taking longer than usual. Press Pay again; you won't be charged twice.",
  declined: 'Your card was declined. No money was taken.',
  billingOutage: 'Payments are paused for a moment. Your crate is still held, so try again shortly.',
  filesOutage: "Receipts can't be saved right now, so we haven't charged you. Try again shortly.",
  storeOutage: "The shop can't take orders right now. You haven't been charged.",
  receiptLine: (email: string) => `A receipt is on its way to ${email}.`,
  fields: {
    cardNumber: 'Enter a valid card number.',
    expiry: 'Enter a future expiry date as MM/YY.',
    cvc: 'Enter the 3-digit security code.',
    postalCode: (provinceDisplayName: string) =>
      `Enter a postal code like A1A 1A1 for ${provinceDisplayName}.`,
    name: 'Enter your full name.',
    line1: 'Enter your street address.',
    city: 'Enter your city.',
  },
} as const;

export const accountCopy = {
  invalidCredentials: "That email and password don't match.",
  emailTaken: 'An account with that email already exists.',
  outage: 'Sign-in is unavailable right now. Your crate is still held.',
} as const;

export const subscriptionCopy = {
  pending: 'Saved. Waiting for billing to confirm.',
  applied: 'Billing confirmed your change.',
  rejected: "Billing didn't accept this change. Nothing was changed.",
  alreadyPending: 'A change is already waiting for confirmation.',
  notPossible: "That change isn't possible right now.",
  cutoff: (date: string) => `Changes made now apply to the box after next, on ${date}.`,
  billingOutage: "Billing is unreachable, so changes are paused. Your subscription hasn't changed.",
  cardSaved: 'Card updated.',
  cardSavedAndPaid: 'Card updated. Your renewal is paid and your boxes are back on.',
  cardDeclined: 'Your card was declined. No money was taken.',
  dunningCancelled: "This subscription ended because payment couldn't be taken.",
  swapFields: {
    differentCadence: 'Pick a box with the same delivery rhythm.',
    unknownPlan: 'Pick one of the listed boxes.',
  },
  state: {
    active: 'Active',
    pauseScheduled: (from: string, resumes: string) =>
      `Pause scheduled from ${from}, resumes ${resumes}`,
    paused: (until: string) => `Paused until ${until}`,
    skipped: 'Next box skipped',
    endsOn: (date: string) => `Ends on ${date}`,
    pastDue: 'Payment overdue',
    cancelled: 'Cancelled',
  },
  badge: {
    pending_provider: 'Pending confirmation',
    applied: 'Applied',
    rejected: 'Rejected',
  },
} as const;

export const dunningBannerCopy = {
  beforeHold:
    "Your renewal payment didn't go through. Update your card to keep your boxes coming.",
  held: (cancelsAtDateAndTime: string) =>
    `Your deliveries are on hold because we couldn't take payment. Update your card before ${cancelsAtDateAndTime} to restart them.`,
} as const;

export const reviewCopy = {
  success: "Thanks. Your review will appear once it's approved.",
  notBuyer: 'Only customers who bought this flavour can review it.',
  alreadyReviewed: "You've already reviewed this flavour.",
} as const;

export const stockistCopy = {
  results: (count: number, place: string) => `Showing ${count} stockists nearest ${place}.`,
  locationOff: 'Location is off. Pick a city instead.',
  yourLocation: 'your location',
} as const;

export const applicationCopy = {
  pending: 'Uploading your licence.',
  success: (email: string) =>
    `Application received. We'll reply to ${email} within 5 business days.`,
  outage: 'Uploads are unavailable right now. Nothing was submitted.',
  fields: {
    tooLarge: 'Licence files can be up to 5,000,000 bytes.',
    unsupportedType: 'Upload a PDF, PNG or JPEG.',
    businessName: 'Enter your business name.',
    contactName: 'Enter the contact name.',
    email: 'Enter a valid email.',
    province: 'Pick a province or territory.',
  },
} as const;

export const queueCopy = {
  marked: (orderNumber: string, statusLabel: string) =>
    `Order ${orderNumber} marked ${statusLabel}.`,
  illegal: (orderNumber: string, statusLabel: string) =>
    `Order ${orderNumber} can't move to ${statusLabel} from here.`,
} as const;

export const refundCopy = {
  pending: (amountCents: number) =>
    `Refund of ${dollars(amountCents)} sent to billing. Waiting for confirmation.`,
  applied: (amountCents: number) => `Refund of ${dollars(amountCents)} confirmed.`,
  overLimit: (leftCents: number) =>
    `Only ${dollars(leftCents)} is left to refund on this order.`,
  billingOutage: 'Billing is unreachable. No refund was made.',
  receiptResent: 'Receipt sent again.',
  notRefundable: 'There is nothing left to refund on this order.',
} as const;

export const settingsCopy = {
  success: 'Settings saved.',
  belowCommitted: (committed: number) =>
    `${committed} cans are already held or sold, so the release can't go below that.`,
} as const;

export type ServiceName = 'killbill' | 'postgres' | 'pocketbase' | 'minio' | 'mailpit';

export const SERVICE_LABELS: Readonly<Record<ServiceName, string>> = {
  killbill: 'Kill Bill',
  postgres: 'Postgres',
  pocketbase: 'PocketBase',
  minio: 'MinIO',
  mailpit: 'Mailpit',
};

export const SERVICE_ORDER: readonly ServiceName[] = [
  'killbill',
  'postgres',
  'pocketbase',
  'minio',
  'mailpit',
];

export const outageBannerCopy: Readonly<Record<ServiceName, string>> = {
  killbill: 'Billing is unreachable. Refunds and subscription changes are paused; packing continues.',
  minio:
    "File storage is unreachable. Packing slips and invoices can't be opened until it returns.",
  postgres: "The orders database is unreachable. The queue can't load until it returns.",
  pocketbase: 'Accounts are unreachable. Staff already signed in can keep working.',
  mailpit: 'Email is delayed. Messages are queued and will send when it returns.',
};

export const apiMessages = {
  storeUnavailable: "The shop can't update right now. Try again in a moment.",
  accountsUnavailable: accountCopy.outage,
  filesUnavailable: outageBannerCopy.minio,
  forbidden: "Your role can't do that.",
  unauthenticated: 'Sign in to continue.',
  notFound: "We couldn't find that.",
  crossOrigin: 'This request came from another origin.',
  tooLarge: 'That request body is too large.',
  unsupportedType: 'Send this request as application/json.',
  validation: 'Check the highlighted fields.',
  unknownProvince: "We don't ship to that province yet.",
  unknownFlavour: 'Pick cans from the list of flavours.',
  badQuantity: 'A crate holds 1 to 12 cans.',
  limitedNotSubscribable: "Limited drops can't be added to a subscription.",
  crateNotFull: 'Your crate needs 12 cans before checkout.',
  holdExpired: crateCopy.holdExpired,
  notSubscribable: 'Subscriptions come as 12 of one flavour or 4 of each.',
  idempotencyMismatch: 'That checkout key was already used with different details.',
  idempotencyKeyRequired: 'Send an Idempotency-Key header of 8 to 128 characters.',
  cardDeclined: checkoutCopy.declined,
  illegalChange: subscriptionCopy.notPossible,
  changePending: subscriptionCopy.alreadyPending,
  alreadyDecided: 'That has already been decided.',
  belowCommitted: 'The release cannot go below the cans already held or sold.',
  emptySlot: 'That slot is empty.',
} as const;

export const SUBSCRIBE_SWITCH_HINT = 'Subscriptions come as 12 of one flavour or 4 of each.';

export const NOT_FOUND_HEADING = "We couldn't find that page.";
export const NO_BACK_OFFICE_HEADING = "You don't have access to the back office.";

export const HOME_SCENES = [
  {
    id: 'canopy',
    name: 'Canopy',
    heading: 'Grown under the canopy',
    message:
      'Organic yerba mate, shade-grown and cold-brewed, then sparkled in small batches.',
    flavour: 'guava-lime',
  },
  {
    id: 'river',
    name: 'River',
    heading: 'Lightly sparkling, lightly sweet',
    message: 'Every can carries about 80 mg of caffeine from mate leaves and 30 calories or fewer.',
    flavour: 'yuzu-ginger',
  },
  {
    id: 'orchard',
    name: 'Orchard',
    heading: 'Build your crate',
    message: 'Mix any 12 cans. Your crate holds them while you shop.',
    flavour: 'passionfruit-basil',
  },
  {
    id: 'night-sky',
    name: 'Night sky',
    heading: 'Every province, exact to the cent',
    message: 'Tax, deposit and shipping are shown before you pay.',
    flavour: 'cacao-orange',
  },
] as const;

export const FAQ_ITEMS = [
  {
    question: 'How does the can deposit work?',
    answer:
      'Every province except Ontario charges a refundable deposit of 10 cents a can. The deposit is never discounted and never taxed, and it does not count towards free shipping. Return your empties to any depot in your province to get it back.',
  },
  {
    question: 'When is my card charged for a subscription?',
    answer:
      'Your first box is charged when you check out. After that, your card is charged on each renewal date, either monthly or every two months, at the subscribe-and-save price. We email you before each renewal.',
  },
  {
    question: 'How long are limited-drop cans held?',
    answer:
      'Adding a can reserves it for fifteen minutes. Every can in a crate shares one hold that starts when you add the first can, and later cans do not extend it. When the hold ends, the cans go back on the shelf for everyone else.',
  },
  {
    question: 'Can I change my box before it ships?',
    answer:
      'Yes. Pause for one to three boxes, skip the next one, swap flavours or cancel at the end of the term from your subscription page. Changes made before the cutoff apply to your next box; later ones apply to the box after that.',
  },
] as const;
