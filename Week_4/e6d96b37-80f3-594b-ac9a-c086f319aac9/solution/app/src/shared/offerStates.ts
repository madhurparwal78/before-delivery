// Offer status groups from the brief's Offers rules; every rule that asks "which statuses" reads one here.

import type { OfferStatus } from "./types.js";

/** Sent or countered: items are reserved, a response window runs and the current version can be accepted. */
export const RESPONDING: readonly OfferStatus[] = ["sent", "countered"];
/** Open offers: counted in the corner block and G20, open to replacement, and their review holds reserve. */
export const OPEN: readonly OfferStatus[] = ["sent", "countered", "accepted"];
/** Statuses whose items are outbound. */
export const OUTBOUND: readonly OfferStatus[] = ["accepted", "dispatched", "received", "disputed"];
/** Both manifests frozen and not yet settled: arrivals and receipts are recorded. */
export const IN_TRANSIT: readonly OfferStatus[] = ["dispatched", "received", "disputed"];
/** Offers awaiting receipt (G20's second line). */
export const AWAITING_RECEIPT: readonly OfferStatus[] = ["dispatched", "received"];
