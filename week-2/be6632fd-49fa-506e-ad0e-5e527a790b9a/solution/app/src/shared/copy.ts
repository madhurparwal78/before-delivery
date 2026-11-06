// Published copy (brief: Feedback states). API error messages and screens read the same strings.
import { counted } from "./format";

export const COPY = {
  unreachable: "Hourline can't be reached. Nothing was saved. Check your connection and try again.",
  crossOrigin: "This request came from another site and was refused.",
  sessionEnded: "Your session ended. Sign in again to continue — your draft is kept.",
  accessRemoved: "Your access to this workspace was removed.",
  unauthenticated: "Sign in to continue.",
  draftRestored: "Your draft is restored.",
  forbidden: "Your role can't do this.",
  notFound: "Nothing was found at this address.",
  methodNotAllowed: "This address does not accept that method.",
  tooLarge: "The request is larger than this address accepts.",
  unsupportedMediaType: "Send this request as JSON.",
  invalidJson: "The request body is not valid JSON.",
  idempotencyKeyRequired: "Send an Idempotency-Key header with each claim.",
  idempotencyKeyReused: "This Idempotency-Key was already used for a different claim.",
  invalidCredentials: "That email and password don't match.",
  dropWithdrawn: "This drop was withdrawn, so its preview is closed.",
  dropWithdrawnPublic: "This drop was withdrawn.",
  linkRevoked: "This preview link was revoked by the press team.",
  linkExpired: "This preview link has expired.",
  linkReplaced: "This preview link was replaced by a newer one. Check your inbox.",
  optInUsed: "This link was already used. Your place is kept.",
  optInExpired: "This link has expired. Join the waitlist again for a new one.",
  resetDead: "This reset link is no longer valid. Ask for a new one.",
  inviteDead: "This invitation is no longer valid. Ask your launch producer for a new one.",
  waitlistPending: "Pieces are being offered to the waitlist first. Check back shortly.",
  holdClaimed: "This piece is already claimed.",
  dropClosed: "This drop is sold out, so its waitlist is closed.",
  dropNotDraft: "This drop is already scheduled.",
  dropLocked: "This drop is live, sold out or withdrawn, so its time can't change.",
  dropNotPublic: "This drop is still a draft, so it has no public page yet.",
  dropWithdrawnAlready: "This drop was already withdrawn.",
  allocationConfirmed: "This allocation is already confirmed.",
  allocationSplit: "The edition was already split, so requests are closed.",
  dropHasConfirmed: "An allocation of this drop is confirmed, so the edition can't be split again.",
  allocationExists: "This stockist already has an allocation for this drop.",
  allocationNotSplit: "Split the edition or enter this allocation before confirming.",
  alreadyConfirmed: "This allocation was already confirmed.",
  allocationEmpty: "Allocate at least one piece before confirming.",
  billingUnavailable: "Invoicing is unavailable right now. Nothing was confirmed, invoiced or emailed. Try again shortly.",
  storageUnavailable: "Image storage is unavailable right now. Nothing was uploaded. Try again shortly.",
  downloadsUnavailable: "Downloads are unavailable right now. Try again shortly.",
  previewRevoked: "This preview is revoked. Send a new preview instead.",
  stockistActive: "This stockist is not archived.",
  lastProducer: "A workspace needs at least one launch producer.",
  lineSheetTooLarge: "The file is larger than 1,000,000 bytes. Nothing was imported.",
  lineSheetWrongType: "Choose a CSV file. Nothing was imported.",
  photoTooLarge: "The photo is larger than 8,000,000 bytes. Nothing was uploaded.",
  noResults: "No drops match these filters.",
  erased: "Contact erased",
  empty: "Nothing here yet.",
} as const;

export const FIELD = {
  required: "This field is required.",
  email: "Enter an email address like name@example.com.",
  date: "Enter a date as YYYY-MM-DD.",
  time: "Enter a time as HH:MM.",
  instant: "Enter an instant like 2027-03-18T09:00:00Z.",
  notLater: "Choose a time later than now.",
  consent: "Tick the box to agree to drop emails.",
  password: "Use 12 to 128 characters.",
  imageType: "Use a JPEG, PNG or WebP photo.",
  imagePixels: "Use a photo at most 12,000 pixels on each side and 40,000,000 pixels in all.",
  pastPriceList: "Choose today or a later date.",
  market: "Choose one of the six markets.",
  stockist: "Choose a stockist.",
} as const;

export const tooLong = (n: number): string => `Use at most ${n} characters.`;
export const outOfRange = (min: number, max: number): string =>
  `Enter a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`;
export const gapMessage = (dateText: string): string => `Copenhagen skips from 02:00 to 03:00 on ${dateText}. Choose another time.`;
export const unknownStyle = (styleNumber: string): string => `No style ${styleNumber} on this drop.`;
export const staleStart = (name: string, time: string): string => `Not saved: ${name} saved a newer version at ${time}.`;
export const validationAnnouncement = (n: number): string =>
  n === 1 ? "There is 1 problem. Fix it and try again." : `There are ${n} problems. Fix them and try again.`;
export const rateLimited = (seconds: number): string => `Too many sign-ups from this connection. Try again in ${counted(seconds, "second")}.`;
export const holdExpired = (time: string): string => `This hold ended at ${time}. The piece has gone back to the drop.`;
export const lostRace = (time: string): string => `Sorry — the last piece went to another shopper at ${time}.`;
export const notLive = (city: string): string => `This drop isn't live in ${city} yet.`;
export const alreadyClaimed = (city: string): string => `You already have a piece from this drop in ${city}.`;
export const priceMissing = (styleNumber: string, currency: string): string => `No wholesale price is in force for ${styleNumber} in ${currency}.`;
export const contactMissing = (stockistName: string): string => `Add a contact email for ${stockistName} before confirming.`;
