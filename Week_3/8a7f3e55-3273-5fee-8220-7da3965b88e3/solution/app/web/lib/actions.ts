import { useCallback, useRef, useState } from "react";
import { ApiFailure } from "./api";
import { type ActionKind, failureCopy } from "./copy";
import { announceError, announceStatus, clearError } from "./live";
import { markActionFinished, markActionStarted, refreshNow } from "./refresh";

interface RunOptions<T> {
  kind: ActionKind;
  /** Pending copy for the Action status region; null when the action announces nothing while it waits. */
  pending: string | null;
  work: () => Promise<T>;
  /** Success copy for the Action status region. */
  success: (value: T) => string;
  onFailure?: (failure: ApiFailure) => void;
}

/** One user action at a time: pending copy, then success or error copy in the shell's live regions. */
export function useAction(): { pending: boolean; run: <T>(options: RunOptions<T>) => Promise<T | undefined> } {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = useCallback(async <T,>(options: RunOptions<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    markActionStarted();
    clearError();
    if (options.pending !== null) announceStatus(options.pending);
    try {
      const value = await options.work();
      announceStatus(options.success(value));
      clearError();
      markActionFinished();
      refreshNow();
      return value;
    } catch (error) {
      announceError(failureCopy(error, options.kind));
      announceStatus("");
      markActionFinished();
      if (error instanceof ApiFailure) {
        if (error.code === "invalid_transition") refreshNow();
        options.onFailure?.(error);
      }
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return { pending, run };
}
