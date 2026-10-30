import { useCallback, useEffect, useRef, useState } from "react";
import { describeFailure } from "./feedback";

interface Loaded<T> {
  data: T | null;
  failure: string | null;
  reload: () => Promise<T | null>;
}

/** Fetches a screen's data on load; `reload` fetches it again after an action on that screen. */
export function useLoad<T>(load: () => Promise<T>, failures: Record<string, string> = {}): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const loader = useRef(load);
  loader.current = load;
  const copies = useRef(failures);

  const reload = useCallback(async () => {
    try {
      const next = await loader.current();
      setData(next);
      setFailure(null);
      return next;
    } catch (error) {
      setFailure(describeFailure(error, copies.current).alert);
      return null;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, failure, reload };
}
