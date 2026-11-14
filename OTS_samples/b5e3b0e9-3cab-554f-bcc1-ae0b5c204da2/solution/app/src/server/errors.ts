/** The one error shape of the API. Every refusal is thrown as an ApiError and written by `errorBody`. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.message === "string" ? body.message : String(body.error ?? status));
    this.status = status;
    this.body = body;
  }
}

const fail = (status: number, error: string, message?: string): ApiError =>
  new ApiError(status, message === undefined ? { error } : { error, message });

export const unauthenticated = (): ApiError => fail(401, "unauthenticated");
export const notFound = (): ApiError => fail(404, "not_found");
export const invalidCredentials = (): ApiError => fail(401, "invalid_credentials", "Email or password is incorrect.");
export const unverified = (): ApiError => fail(401, "unverified", "Verify your email first.");
export const schoolExists = (): ApiError => fail(409, "school_exists", "You already have a school.");
export const inviteExpired = (): ApiError =>
  fail(410, "invite_expired", "This invitation is out of date. Please request a fresh one from your instructor.");
export const inviteUsed = (): ApiError => fail(410, "invite_used", "This invitation has already been used.");
export const formErrors = (errors: Record<string, string>): ApiError => new ApiError(422, { errors });
export const parseRefusal = (message: string): ApiError => fail(422, "parse", message);
export const notFinal = (callsign: string): ApiError => fail(422, "not_final", `${callsign} is not on final.`);
export const verifyExpired = (): ApiError => fail(410, "verify_expired", "This verification link has expired.");
export const serverError = (): ApiError => fail(500, "server_error", "Something went wrong. Try again shortly.");
export const scenarioInvalid = (message: string): ApiError => fail(422, "scenario_invalid", message);
export const rateLimited = (): ApiError => fail(429, "rate_limited", "Too many commands. Wait a moment.");
export const paused = (): ApiError => fail(409, "paused", "The exercise is paused.");
export const ended = (): ApiError => fail(409, "ended", "The exercise has ended.");
export const running = (): ApiError => fail(409, "running", "Debrief is ready when the exercise ends.");
export const seatTaken = (): ApiError => fail(409, "seat_taken", "This seat is taken.");
export const seatHeld = (): ApiError => fail(409, "seat_held", "You already hold a seat in this exercise.");
export const seatInUse = (): ApiError => fail(409, "seat_in_use", "This seat is still in use.");
export const versionConflict = (callsign: string): ApiError =>
  fail(409, "version_conflict", `${callsign} was changed by another seat first. Your action was not applied.`);
export const tooLarge = (): ApiError => fail(413, "too_large");
export const layoutTooLarge = (limit: number): ApiError =>
  fail(413, "layout_too_large", `Layout file is over the limit of ${limit} bytes.`);
export const layoutInvalid = (lines: string[]): ApiError => new ApiError(422, { error: "layout_invalid", lines });
export const mailUnavailable = (): ApiError =>
  fail(503, "mail_unavailable", "Mail cannot be sent right now. Try again shortly.");
export const databaseUnavailable = (): ApiError =>
  fail(503, "database_unavailable", "Runup Bay cannot reach its database. Try again shortly.");
export const storageUnavailable = (action: "reports" | "layouts" | "layout-files"): ApiError =>
  fail(
    503,
    "storage_unavailable",
    {
      reports: "Reports cannot be saved right now. Try again shortly.",
      layouts: "Layouts cannot be saved right now. Try again shortly.",
      "layout-files": "Layout files cannot be read right now. Try again shortly.",
    }[action],
  );
