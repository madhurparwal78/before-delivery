import { copy } from "../../shared/copy";
import { ApiError } from "../lib/api";

/** The copy to announce for a failed request: the API's own message, or the generic one. */
export function failureMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : copy.serverError;
}
