import { useRef } from "react";
import { RequestError } from "./api";

function freshKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `key-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/**
 * The console's idempotency key lifecycle: one key per intent, the same key while the
 * outcome is unknown, a fresh key once a request has been answered.
 */
export function useIntentKey(): {
  key: () => string;
  answered: () => void;
  keepForRetry: (error: RequestError) => void;
} {
  const held = useRef<string | null>(null);
  return {
    key: () => {
      if (held.current === null) held.current = freshKey();
      return held.current;
    },
    answered: () => {
      held.current = null;
    },
    keepForRetry: (error: RequestError) => {
      if (!error.outcomeUnknown) held.current = null;
    },
  };
}
