import type { Response } from "express";

// Every error response is built through this one shape, and the frontend reads
// this shape alone.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, fields?: Record<string, string>) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const errors = {
  unauthenticated: () => new ApiError(401, "unauthenticated"),
  notFound: () => new ApiError(404, "not_found"),
  tooLarge: () => new ApiError(413, "too_large"),
  badJson: () => new ApiError(400, "bad_json"),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type"),
  ownCampaign: () => new ApiError(403, "own_campaign"),
  campaignClosed: () => new ApiError(409, "campaign_closed"),
  alreadyPledged: () => new ApiError(409, "already_pledged"),
  tierSoldOut: () => new ApiError(409, "tier_sold_out"),
  pledgeNotActive: () => new ApiError(409, "pledge_not_active"),
  wouldUnfund: () => new ApiError(409, "would_unfund"),
  campaignNotDraft: () => new ApiError(409, "campaign_not_draft"),
  notLive: () => new ApiError(409, "not_live"),
  mediaNotStored: () => new ApiError(409, "media_not_stored"),
  idempotencyConflict: () => new ApiError(409, "idempotency_conflict"),
  idempotencyInProgress: () => new ApiError(409, "idempotency_in_progress"),
  fixWindowClosed: () => new ApiError(409, "fix_window_closed"),
  notReady: () => new ApiError(409, "not_ready"),
  notFunded: () => new ApiError(409, "not_funded"),
  cardDeclined: () => new ApiError(402, "card_declined"),
  paymentUnavailable: () => new ApiError(503, "payment_unavailable"),
  storageUnavailable: () => new ApiError(503, "storage_unavailable"),
  validation: (fields: Record<string, string>) => new ApiError(422, "validation_failed", fields),
};

// Field message copy shared by API and screens.
export const fieldMessages = {
  useOneOfTheTestCards: "Use one of the test cards.",
  enterName: "Enter your name.",
  enterEmail: "Enter an email address.",
  enterAddOnRange: "Enter an add-on from 0.00 to 500.00.",
  enterAmountInPounds: "Enter an amount in pounds, for example 2400.00.",
} as const;

export function sendError(res: Response, error: ApiError): void {
  const body: Record<string, unknown> = { error: error.code };
  if (error.status === 422 && error.fields !== undefined) {
    body.fields = error.fields;
  }
  res.status(error.status).json(body);
}
