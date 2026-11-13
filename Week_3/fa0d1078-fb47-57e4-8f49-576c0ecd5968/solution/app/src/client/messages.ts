import { ApiFailure } from "./api";

export const M40 = "Live duels are unavailable right now. Solo games and the daily challenge still work.";
export const M56 = "Something went wrong at the atelier. Try again.";
const M61 = "The atelier's records are out of reach. Try again in a minute.";

/** The sentence for a failure no screen handles itself: the unexpected failure, or the records being out of reach. */
export function failureSentence(error: ApiFailure): string {
  return error.code === "STORAGE_UNAVAILABLE" ? M61 : M56;
}
