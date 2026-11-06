/**
 * The only source of published copy. Literal strings render exactly as printed,
 * character for character, including the thousands separators some of them carry.
 * Figures the app fills in from its own data are plain digits with no separator.
 */

import { formatAmount } from "./money.js";

/** Counts, millimetres, lumens, candela and lux: plain digits, no separator. */
const n = (value: number): string => String(Math.round(value));

export const BRAND = {
  wordmark: "Lightfall",
  footerLine: "Southerly Light Works \u00b7 \u014ctautahi Christchurch",
} as const;

export const FAMILY_LINKS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "downlights", label: "Downlights" },
  { slug: "track-spots", label: "Track spots" },
  { slug: "pendants", label: "Pendants" },
  { slug: "surface", label: "Surface mounted" },
  { slug: "clearance", label: "Clearance" },
];

export const CATALOGUE = {
  resultsCount: (count: number): string => (count === 1 ? "1 fitting" : `${n(count)} fittings`),
  stockBadgeLeft: (left: number): string => `Only ${n(left)} left`,
  stockBadgeSoldOut: "Sold out",
  priceLine: (cents: number): string => `$${formatAmount(cents)} + GST`,
  tradePriceLine: (cents: number): string => `Trade $${formatAmount(cents)} + GST`,
  rrpLine: (cents: number): string => `RRP $${formatAmount(cents)} + GST`,
} as const;

export const PRODUCT = {
  /** `<product name>, <finish name>, <beam>deg beam, <cct>K: <lumens> lumens, $<price> + GST.` */
  variantChanged: (args: {
    productName: string;
    finishName: string;
    beamDeg: number;
    cctK: number;
    lumens: number;
    priceCents: number;
  }): string =>
    `${args.productName}, ${args.finishName}, ${n(args.beamDeg)}\u00b0 beam, ${n(args.cctK)}K: ` +
    `${n(args.lumens)} lumens, $${formatAmount(args.priceCents)} + GST.`,
  addingToCart: "Adding",
  addedToCart: (quantity: number, cartSubtotalCents: number): string =>
    `Added ${n(quantity)} to cart. Cart total $${formatAmount(cartSubtotalCents)} + GST.`,
  onlyNLeft: (left: number): string => `Only ${n(left)} left.`,
  addedToComparison: "Added to comparison.",
  comparisonFull: "You can compare up to four fittings.",
  savedToFavourites: "Saved to favourites.",
  removedFromFavourites: "Removed from favourites.",
  signInToSave: "Sign in to save favourites.",
  preparingSpecSheet: "Preparing spec sheet",
  specSheetUnavailable: "Spec sheet unavailable right now. Try again shortly.",
} as const;

export const CHECKOUT = {
  payButton: (totalCents: number): string => `Pay $${formatAmount(totalCents)}`,
  authorising: "Authorising payment",
  placingOrder: "Placing order",
  orderConfirmedHeading: "Order confirmed",
  orderConfirmedBody: (orderKey: string, email: string): string =>
    `Order ${orderKey} is confirmed. A receipt is on its way to ${email}.`,
  orderPlacedHeading: "Order placed",
  orderPlacedBody: (orderKey: string, email: string): string =>
    `Order ${orderKey} is on your monthly account. A confirmation is on its way to ${email}.`,
  cardDeclinedHeading: "Card declined",
  cardDeclinedBody: "Your bank declined this card. No money has been taken. Try another card or contact your bank.",
  paymentUnavailableHeading: "Payment service unavailable",
  paymentUnavailableBody:
    "We couldn't reach our payment service. Your order is saved and you will only be charged once. Try again in a few minutes.",
  soldOutHeading: "Sold out while you were checking out",
  soldOutBody: (productName: string): string =>
    `Someone else bought the last units of ${productName}. Your card has not been charged.`,
  fieldCardNumber: "Enter a valid card number.",
  fieldExpiry: "Enter an expiry date in the future.",
  fieldCvc: "Enter the 3-digit security code.",
  fieldRequired: "This field is required.",
} as const;

export const AUTH = {
  signingIn: "Signing in",
  signInFailed: "Email or password is incorrect.",
  creatingAccount: "Creating account",
  emailTaken: "An account with this email already exists.",
  nzbnInvalid: "Enter a 13-digit NZBN starting with 94.",
  passwordTooShort: "Use at least 10 characters.",
  tradePending: "Your trade application is with our team. You'll see trade prices once it's approved.",
  tradeDeclined: "Your trade application was declined. You can still shop at retail prices.",
} as const;

export const PROJECTS = {
  saving: "Saving",
  projectCreated: "Project created.",
  /** `Added <qty> x <code> to <project name>.` with the multiplication sign. */
  addedToProject: (quantity: number, code: string, projectName: string): string =>
    `Added ${n(quantity)} \u00d7 ${code} to ${projectName}.`,
  ceilingOutOfRange: "Ceiling height must be between 2400 and 4000 mm.",
  uploadingCover: "Uploading cover",
  coverReady: "Cover ready.",
  coverRejected: "Choose a JPEG, PNG or WebP image up to 5,000,000 bytes.",
  coverStorageDown: "File storage is unavailable. Your cover was not saved; try again shortly.",
  placed: (code: string, xMm: number, yMm: number, diameterMm: number, lux: number): string =>
    `${code} placed at ${n(xMm)} mm, ${n(yMm)} mm. Pool ${n(diameterMm)} mm, ${n(lux)} lux.`,
  moved: (code: string, xMm: number, yMm: number): string => `${code} moved to ${n(xMm)} mm, ${n(yMm)} mm.`,
  removed: (code: string): string => `${code} removed.`,
  allPlaced: (code: string): string => `All ${code} fittings are already placed.`,
  liveBack: "Live collaboration is back.",
  livePaused: "Live collaboration paused. Your changes are saved and will sync when it reconnects.",
  posting: "Posting",
  commentPosted: "Comment posted.",
  commentTooLong: "Comments can be up to 2,000 characters.",
  commentsUnavailable: "Comments are unavailable while live collaboration is paused.",
  inviting: "Inviting",
  collaboratorAdded: (name: string): string => `${name} can now work on this project.`,
  notTradeAccount: "That email is not an approved trade account.",
  sending: "Sending",
  quoteQueued: (recipients: number): string =>
    `Quote queued for ${n(recipients)} recipients. Emails go out as soon as the PDF is ready.`,
  recipientsInvalid: "Add between 1 and 10 valid email addresses.",
  sharePending: "Preparing PDF",
  shareReady: "Ready",
  shareWaitingForStorage: "Waiting for file storage",
} as const;

export const ADMIN = {
  saving: "Saving",
  approved: (businessName: string): string => `Approved ${businessName}.`,
  declined: (businessName: string): string => `Declined ${businessName}.`,
  alreadyDecided: "This application has already been decided.",
  capturing: "Capturing",
  invoicing: "Invoicing",
  paymentCaptured: (orderKey: string): string => `Payment captured. Order ${orderKey} is Paid.`,
  invoiceRaised: (invoiceNumber: string, orderKey: string): string =>
    `Invoice ${invoiceNumber} raised for ${orderKey}.`,
  cannotDispatch: "This order can't be dispatched in its current state.",
  killbillUnavailable: (orderKey: string): string =>
    `Kill Bill is unavailable. Order ${orderKey} is unchanged; try again shortly.`,
  refunding: "Refunding",
  refunded: (amountCents: number, orderKey: string): string =>
    `Refunded $${formatAmount(amountCents)} on ${orderKey}.`,
  exceedsRefundable: (refundableCents: number): string =>
    `More than the $${formatAmount(refundableCents)} still refundable.`,
  recording: "Recording",
  paymentRecorded: (orderKey: string): string => `Payment recorded. Order ${orderKey} is Paid.`,
  amountMustEqualTotal: "The amount must equal the invoice total.",
  stockNow: (code: string, onHand: number): string => `Stock for ${code} is now ${n(onHand)}.`,
  stockBelowZero: "Stock can't go below zero.",
} as const;

export const NEWSLETTER = {
  consentLabel: "Send me the Lightfall newsletter",
  subscribing: "Subscribing",
  pending: (email: string): string => `Check your inbox. We've sent a confirmation link to ${email}.`,
  consentRequired: "Tick the box to agree to the newsletter.",
  emailInvalid: "Enter a valid email address.",
  confirmedHeading: "You're subscribed",
  invalidTokenHeading: "That confirmation link isn't valid.",
} as const;

export const MAIL_SUBJECTS = {
  orderConfirmation: (orderKey: string): string => `Your Lightfall order ${orderKey}`,
  tradeApproved: "Your Lightfall trade account is approved",
  tradeDeclined: "About your Lightfall trade application",
  quoteShare: (senderName: string, projectName: string): string =>
    `${senderName} shared a Lightfall quote: ${projectName}`,
  newsletterConfirm: "Confirm your Lightfall newsletter",
} as const;

export const LIGHTING_STATES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "morning", label: "Morning" },
  { value: "day", label: "Day" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
  { value: "gallery", label: "Gallery" },
];

export const OCCUPATION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "electrician", label: "Electrician" },
  { value: "architect", label: "Architect" },
  { value: "lighting_designer", label: "Lighting designer" },
  { value: "wholesaler", label: "Wholesaler" },
];

export const NEWSLETTER_OCCUPATION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "architect", label: "Architect" },
  { value: "trade", label: "Trade" },
  { value: "wholesaler", label: "Wholesaler" },
  { value: "other", label: "Other" },
];
