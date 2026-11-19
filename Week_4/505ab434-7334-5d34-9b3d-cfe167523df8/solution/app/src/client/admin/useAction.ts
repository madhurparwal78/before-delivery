import { useCallback, useState } from "react";
import { messageOf } from "../lib/api.ts";

/** Runs one action at a time: tracks which key is waiting and the API message of the last failure. */
export function useAction(): {
  busy: string | null;
  error: { key: string; message: string } | null;
  run(key: string, work: () => Promise<void>): Promise<boolean>;
  clear(): void;
} {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const run = useCallback(async (key: string, work: () => Promise<void>): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      await work();
      return true;
    } catch (failure) {
      setError({ key, message: messageOf(failure) });
      return false;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, run, clear: useCallback(() => setError(null), []) };
}
