/** The one error shape: every refusal becomes `{"error":{"code","message"[,"fields"]}}` with this status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "not_found", "Not found.");
export const unexpected = () => new ApiError(500, "internal", "Something went wrong.");
export const bodyTooLarge = () => new ApiError(413, "body_too_large", "The request body is too large.");
export const imageTooLarge = () => new ApiError(413, "image_too_large", "That image is over 5,000,000 bytes.");
export const invalid = (fields: Record<string, string>) => new ApiError(422, "invalid", "Some values are not valid.", fields);
