/** Every published message and piece of copy, used verbatim by the server and the browser. */
import { PRICE_MAX, PRICE_MIN } from "./figures.js";

export const ERROR_MESSAGES = {
  unauthenticated: "Sign in to continue.",
  sign_in_failed: "That email and password don't match an account.",
  cross_origin: "This request must come from the Highwater site.",
  forbidden: "Your account can't do that.",
  not_found: "We couldn't find that.",
  read_only: "Shared links are read-only.",
  unit_unavailable: "Someone else holds this home now.",
  unit_reserved: "This home is already reserved.",
  price_changed: "The price of this home changed. Check the new price and confirm again.",
  hold_limit: "You already hold a home. Release it before holding another.",
  hold_ended: "This hold has already ended.",
  idempotency_key_reused: "This request key was already used for a different request.",
  already_released: "These floors are already released.",
  not_released: "These floors aren't released yet.",
  unit_withdrawn: "This home has been withdrawn.",
  upload_in_progress: "Another photo for this home is still uploading.",
  stale_price: "Someone changed this price first. Reload and try again.",
  too_large: "That request is too large.",
  unsupported_type: "Send JSON.",
  unsupported_image: "Upload a PNG or JPEG image.",
  invalid: "Check the highlighted fields.",
  upload_unconfirmed: "The photo could not be confirmed. Upload it again.",
  search_unavailable: "Search is down for a moment. The tower still shows live availability.",
  storage_unavailable: "Photo storage is unavailable. The photo was not saved.",
  media_unavailable: "This file can't be loaded right now.",
  internal: "Something went wrong on our side. Try again.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES | "hold_cooldown" | "search_rate_limited" | "hold_attempts";

export const holdCooldownMessage = (endTime: string): string =>
  `You held this home recently. You can hold it again after ${endTime}.`;
export const searchRateLimitMessage = (seconds: number): string =>
  `Too many searches from this device. Try again in ${seconds} seconds.`;
export const holdAttemptsMessage = (seconds: number): string =>
  `Too many hold attempts. Try again in ${seconds} seconds.`;

export const ACCOUNT_CREATED_MESSAGE = "Your details are in. Sign in to continue.";

export const FIELD_MESSAGES = {
  name: "Use 1 to 80 characters.",
  email: "Enter a valid email address.",
  password: "Use 10 to 200 characters.",
  q: "Use 80 characters or fewer.",
  facetTooMany: "Choose up to 6.",
  facetUnknown: "Pick from the listed options.",
  price: "Enter a whole number of dollars.",
  priceOrder: "The lowest price can't be above the highest.",
  limit: "Use a page size from 1 to 24.",
  after: "This page link is out of date. Start again.",
  unitCode: "Choose a home.",
  priceVersion: "Reload this home's price.",
  idempotencyKey: "Use 1 to 100 visible characters.",
  holdPrice: `Enter a whole number from ${PRICE_MIN} to ${PRICE_MAX}.`,
  expectedVersion: "Enter the price version you're changing.",
  photoSmall: "Use an image at least 1024 by 512 pixels.",
  photoBroken: "Upload a readable PNG or JPEG image.",
} as const;

export const COPY = {
  confirmedHeading: "This home is held for you.",
  lostReply: "We couldn't reach Highwater. Your hold was not placed yet. Try again.",
  noPayment: "No payment is taken. You can release the hold at any time.",
  emptyHeading: "NOTHING HERE",
  emptyHint: "No homes match these filters. Clear a filter to see more.",
  withdrawnPanel: "This home has been withdrawn.",
  holdNotFound: "We couldn't find that hold.",
  deadLink: "This shared link no longer works.",
  noPhoto: "No view photograph yet.",
  photoDown: "View photograph unavailable right now.",
  modelDown: "Tower model unavailable right now. Showing the floor grid.",
  contextLost: "Tower view paused. Showing the floor grid.",
  signedIn: "Signed in.",
  signedOut: "Signed out.",
  holdReleased: "Hold released.",
  shareReady: "Share link ready.",
  linkCopied: "Link copied.",
  shareRevoked: "Share link revoked.",
  viewPhotographed: "View photographed",
  noViewPhotographed: "No view photograph yet",
  outsideFilters: "Outside your filters",
  syncing: "Syncing",
  ended: {
    buyer: "You released this hold.",
    withdrawal: "This home was withdrawn, so your hold ended.",
    conversion: "This hold became a reservation.",
    lapse: "Your hold has lapsed. This home is open to every buyer again.",
  },
} as const;

export const countText = (total: number): string => (total === 1 ? "1 home matches" : `${total} homes match`);
export const recoveryText = (total: number): string =>
  total === 1 ? "Search is back. 1 home matches." : `Search is back. ${total} homes match.`;
export const pagedText = (added: number, shown: number, total: number): string =>
  added === 1 ? `1 more home. ${shown} of ${total} shown.` : `${added} more homes. ${shown} of ${total} shown.`;
export const priceChangedText = (code: string, priceText: string): string => `Price for ${code} is now $${priceText}.`;
export const withdrawnText = (code: string): string => `${code} has been withdrawn.`;
