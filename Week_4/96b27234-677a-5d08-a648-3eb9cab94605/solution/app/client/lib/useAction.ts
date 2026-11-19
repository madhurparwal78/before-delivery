import { useCallback, useRef, useState } from "react";
import { call, type Reply } from "./api";

export interface Result {
  text: string;
  kind: "idle" | "pending" | "ok" | "refused";
}

export const idle: Result = { text: "", kind: "idle" };

/** A result message that stays until the person's next action: pending, then success or the exact refusal. */
export function useResult(): { result: Result; set: (next: Result) => void; reset: () => void } {
  const [result, setResult] = useState<Result>(idle);
  return { result, set: setResult, reset: () => setResult(idle) };
}

/**
 * Runs one request with its pending text, then writes the success text or the server's refusal in the
 * same region. Returns the reply so the caller can refresh what changed.
 */
export function useAction(pending: string): {
  result: Result;
  setResult: (next: Result) => void;
  run: <T>(method: string, path: string, body: unknown, success: (reply: Reply<T>) => string) => Promise<Reply<T>>;
  busy: boolean;
} {
  const { result, set } = useResult();
  const [busy, setBusy] = useState(false);
  const token = useRef(0);
  const run = useCallback(
    async <T,>(method: string, path: string, body: unknown, success: (reply: Reply<T>) => string): Promise<Reply<T>> => {
      const mine = (token.current += 1);
      setBusy(true);
      set({ text: pending, kind: "pending" });
      const reply = await call<T>(method, path, body);
      if (mine === token.current) {
        set(reply.ok ? { text: success(reply), kind: "ok" } : { text: reply.error || "Something went wrong.", kind: "refused" });
        setBusy(false);
      }
      return reply;
    },
    [pending, set],
  );
  return { result, setResult: set, run, busy };
}
