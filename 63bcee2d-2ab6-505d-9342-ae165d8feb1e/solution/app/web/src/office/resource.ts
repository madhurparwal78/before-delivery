import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { get, type ErrorBody } from "../api";
import { useOffice } from "./context";

// Office data: fetched when the page loads, when the window regains focus, and on `reload()` after each
// action. `reload()` commits the new data synchronously, so focus can move to a re-rendered control at once.

interface Resource<T> {
  data: T | null;
  /** The refusal when loading failed with an error the screen shows (404 and the like). */
  failure: ErrorBody | null;
  reload: () => Promise<T | null>;
}

export function useResource<T>(path: string | null): Resource<T> {
  const office = useOffice();
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<ErrorBody | null>(null);
  const latest = useRef(path);
  latest.current = path;
  const refused = useRef(office.refused);
  refused.current = office.refused;

  const reload = useCallback(async (): Promise<T | null> => {
    const target = latest.current;
    if (!target) return null;
    const result = await get<T>(target);
    if (latest.current !== target) return null;
    if (result.ok) {
      flushSync(() => {
        setData(result.data);
        setFailure(null);
      });
      return result.data;
    }
    if (result.status === 401 || result.body.error === "access_removed") refused.current(result);
    else flushSync(() => setFailure(result.body));
    return null;
  }, []);

  useEffect(() => {
    setData(null);
    setFailure(null);
    void reload();
  }, [path, reload]);

  useEffect(() => {
    const onFocus = (): void => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  return { data, failure, reload };
}
