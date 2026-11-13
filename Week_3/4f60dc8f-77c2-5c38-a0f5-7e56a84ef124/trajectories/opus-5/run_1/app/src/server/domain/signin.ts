export const SIGNIN_CODE_LIMIT = 3;

/** A code dies after this many wrong tries. */
export const SIGNIN_CODE_MAX_TRIES = 5;

export type WindowDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * The sign-in code window: at most three requests count per email inside a rolling
 * window, and a request stops counting once it is exactly the window's age.
 */
export const judgeCodeWindow = (
  requestAges: readonly number[],
  windowSeconds: number,
): WindowDecision => {
  const counted = requestAges.filter((age) => age < windowSeconds).sort((a, b) => b - a);
  if (counted.length < SIGNIN_CODE_LIMIT) return { allowed: true };
  const oldest = counted[0];
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - oldest)),
  };
};
