// The published copy (Feedback states › Errors) of every error code, in one place. Server error
// bodies and the screens' alert both read it from here; no handler or screen writes its own copy
// and no message is ever built from a caught error.

/** Codes whose copy has no variant and no placeholder: an error body's `message` is always this text. */
export const COPY: Record<string, string> = {
  bad_request: "The request body is not valid JSON.",
  idempotency_key_required: "Send an Idempotency-Key header of 8 to 128 letters, digits, hyphens or underscores.",
  unauthenticated: "Sign in to continue.",
  invalid_credentials: "Email or password is incorrect.",
  forbidden: "Your role cannot do that.",
  cross_origin: "Requests from other sites are refused.",
  not_found: "That was not found.",
  read_only: "Inspector links are read-only.",
  idempotency_key_reused: "This request was already used for something else. Reload and try again.",
  billing_pending: "Some charges are still waiting for billing. Try again once they are recorded.",
  link_expired: "This link has expired.",
  link_revoked: "This link is no longer active.",
  payload_too_large: "This file is too large.",
  unsupported_media_type: "Send JSON with Content-Type application/json.",
  unsupported_file_type: "Upload a PDF, PNG or JPEG file.",
  validation_failed: "Check the highlighted fields.",
  billing_unavailable: "Billing is unavailable. The month stays open; try again when billing is back.",
  internal: "Lineboard hit an unexpected problem. Try again.",
};

/**
 * Codes whose copy has variants or placeholders: each entry names its error code and fills its
 * published sentence from the values the brief names for it.
 */
export const VARIANT_COPY = {
  rate_limited: { code: "rate_limited", copy: (minutes: number) => `Too many sign-in attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` },
  block_taken_hourly: { code: "block_taken", copy: (station: string, start: string) => `${station} ${start} block was taken.` },
  block_taken_shelf: { code: "block_taken", copy: (station: string, date: string) => `${station} ${date} was taken.` },
  invalid_transition_booking: { code: "invalid_transition", copy: (statusWord: string) => `That action is not available for a ${statusWord} block.` },
  invalid_transition_document: { code: "invalid_transition", copy: (statusWord: string) => `That action is not available for a ${statusWord} document.` },
  document_superseded: { code: "document_superseded", copy: (documentType: string, business: string) => `A newer ${documentType} from ${business} is waiting. Approve that one instead.` },
  hold_expired: { code: "hold_expired", copy: (blockLabel: string) => `Your hold on ${blockLabel} expired.` },
  month_closed: { code: "month_closed", copy: (monthName: string) => `${monthName} is closed.` },
  billing_mismatch: { code: "billing_mismatch", copy: (business: string) => `Kill Bill's draft for ${business} does not match Lineboard. The month stays open.` },
  rate_version_exists: { code: "rate_version_exists", copy: (station: string, stamp: string) => `A rate change for ${station} already starts ${stamp}.` },
  stale_version_move: { code: "stale_version", copy: () => "This block changed since you picked it up. The board now shows the latest version." },
  stale_version_rules: { code: "stale_version", copy: () => "Kitchen rules changed since you opened Settings. The latest rules are shown." },
  stale_version_document: { code: "stale_version", copy: () => "This document changed since you opened Documents. The latest version is shown." },
  storage_unavailable_upload: { code: "storage_unavailable", copy: () => "Document storage is unavailable. Your file was not saved; try again shortly." },
  storage_unavailable_download: { code: "storage_unavailable", copy: () => "Document storage is unavailable. Try again shortly." },
} as const;

export type Variant = keyof typeof VARIANT_COPY;
export type VariantArgs<V extends Variant> = Parameters<(typeof VARIANT_COPY)[V]["copy"]>;

/** The published sentence of a variant, its placeholders filled. */
export function variantCopy<V extends Variant>(variant: V, ...args: VariantArgs<V>): string {
  return (VARIANT_COPY[variant].copy as (...a: VariantArgs<V>) => string)(...args);
}

/** Copy the screens show that has no API code. */
export const NETWORK_COPY = "Lineboard could not reach the server. Check the connection and try again.";
export const MEMBER_NOT_FOUND_COPY = "That member was not found.";
export const ROLE_REFUSED_COPY = "That screen is not available for your role.";
