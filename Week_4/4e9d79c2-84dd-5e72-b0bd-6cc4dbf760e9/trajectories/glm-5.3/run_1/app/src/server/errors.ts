export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public fields?: Record<string, string>,
    public headers?: Record<string, string>
  ) {
    super(message);
  }
}

export const errors = {
  unknownRoute: () => new HttpError(404, "notFound", "We can't find that."),
  wrongMethod: (allow: string) =>
    new HttpError(405, "wrongMethod", "We can't find that.", undefined, { Allow: allow }),
  tooLarge: () => new HttpError(413, "tooLarge", "That file is too big."),
  rateLimited: (retryAfterSeconds: number, ukTime: string) =>
    new HttpError(429, "rateLimited", ukTime, undefined, {
      "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
    }),
  foreignOrigin: () => new HttpError(403, "foreignOrigin", "We can't find that."),
  notSignedIn: () => new HttpError(401, "notSignedIn", "Your session ended. Sign in again to keep going — what you typed is still here."),
  sessionEnded: () => new HttpError(401, "sessionEnded", "Your session ended. Sign in again to keep going — what you typed is still here."),
  wrongPassword: () => new HttpError(401, "wrongPassword", "That email and password do not match."),
  notFound: () => new HttpError(404, "notFound", "We can't find that."),
  ended: () => new HttpError(410, "ended", "This page has ended."),
  unsupportedType: () => new HttpError(415, "unsupportedType", "We can't find that."),
  malformedJson: () => new HttpError(400, "malformedJson", "We can't find that."),
  invalid: (fields: Record<string, string>, message?: string) =>
    new HttpError(422, "invalid", message ?? "That did not save. Try again.", fields),
  state: (code: string, message: string) => new HttpError(409, code, message),
  staleEdit: (message: string) => new HttpError(412, "staleEdit", message),
  provider: (message: string) => new HttpError(503, "provider", message),
};

/** Find the first HttpError in a plain object by status order of the ladder. */
export function earliestLadder(candidates: HttpError[]): HttpError | null {
  const order = [404, 405, 413, 429, 403, 401, 410, 415, 400, 422, 409, 412, 503];
  let best: HttpError | null = null;
  let bestIdx = 99;
  for (const c of candidates) {
    if (!c) continue;
    const i = order.indexOf(c.status);
    if (i >= 0 && i < bestIdx) {
      best = c;
      bestIdx = i;
    }
  }
  return best;
}
