// Every API error has one shape, {"error","message"}, with a code from the brief's catalogue.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const notFound = () => new ApiError(404, "not_found", "Not found");
export const forbidden = () => new ApiError(403, "forbidden", "You can't do that.");
export const seedConflict = () => new ApiError(409, "seed_conflict", "Reset before seeding.");
export const wrongState = (message: string) => new ApiError(409, "wrong_state", message);
export const invalidBody = () => new ApiError(422, "invalid_body", "Request body is not valid JSON.");
export const tooLarge = () => new ApiError(413, "too_large", "Request body is too large.");
export const storageUnavailable = (message: string) => new ApiError(503, "storage_unavailable", message);
export const STORAGE_MESSAGES = {
  proof: "Proof storage is unavailable. Your request is unchanged.",
  download: "Downloads are unavailable right now.",
  release: "Storage is unavailable. Nothing was changed.",
} as const;
