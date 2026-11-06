import type { ApiError } from "./errors.js";

/** Carries an ApiError out of async route handlers to the one error responder. */
export class DbError extends Error {
  constructor(public readonly api: ApiError) {
    super(api.message);
    this.name = "DbError";
  }
}
