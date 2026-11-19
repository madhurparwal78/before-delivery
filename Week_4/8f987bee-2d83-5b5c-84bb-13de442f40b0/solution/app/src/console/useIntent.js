import { useRef } from "react";
import { freshKey } from "./api.js";

// The console's Idempotency-Key lifecycle: one key per intent, the same key again while the outcome is unknown
// (no answer, a 5xx or in flight), a fresh key after any other answer or a change to the form.
export function useIntent() {
  const key = useRef(null);
  return {
    key: () => {
      key.current ??= freshKey();
      return key.current;
    },
    settle: (result) => {
      const unknown = result.outage || result.body?.error === "idempotency_key_in_flight";
      if (!unknown) key.current = null;
    },
    reset: () => {
      key.current = null;
    },
  };
}
