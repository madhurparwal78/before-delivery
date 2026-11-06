// The two page-level live regions: status "Updates" (polite) and alert "Problems" (assertive),
// and the one pattern every async action follows: pending, then success or refusal.

import { useLayoutEffect, useState } from "preact/hooks";
import { ApiFailure, Unreachable } from "./api.js";

interface Feedback {
  update: string;
  problem: string;
}

let current: Feedback = { update: "", problem: "" };
const listeners = new Set<(next: Feedback) => void>();

function publish(next: Feedback): void {
  current = next;
  for (const listener of listeners) listener(next);
}

export function announce(update: string): void {
  publish({ update, problem: "" });
}

export function complain(problem: string): void {
  publish({ update: "", problem });
}

export function useFeedback(): Feedback {
  const [state, setState] = useState(current);
  useLayoutEffect(() => {
    listeners.add(setState);
    setState(current);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

export const NO_RESPONSE = "Passboard could not reach the server. Nothing changed; try again.";
const NOT_DONE = "That did not go through. Nothing changed; try again.";

/** How a refusal reads: in Problems by default, or in Updates for news that is not an error. */
export interface Refusal {
  text: string;
  polite?: boolean;
}

/** Pending copy at once, then the success copy, or the refusal in its region. Returns null when refused. */
export async function perform<T>(pending: string, run: () => Promise<T>, success: (value: T) => string, refusal: (failure: ApiFailure) => Refusal | null): Promise<T | null> {
  announce(pending);
  try {
    const value = await run();
    announce(success(value));
    return value;
  } catch (error) {
    // A session that ended has already returned to sign in with its own notice.
    if (error instanceof ApiFailure && error.body.error === "unauthenticated") return null;
    if (error instanceof ApiFailure) {
      const refused = refusal(error);
      if (refused?.polite) announce(refused.text);
      else complain(refused?.text ?? NOT_DONE);
    } else if (error instanceof Unreachable) {
      complain(NO_RESPONSE);
    } else {
      complain(NOT_DONE);
    }
    return null;
  }
}
