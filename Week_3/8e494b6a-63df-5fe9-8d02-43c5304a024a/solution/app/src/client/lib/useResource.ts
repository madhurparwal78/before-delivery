// Loads a page's data, keeps it, and reloads on demand; a failure is kept for the Load failed alert.
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiFailure } from "./api";

interface Resource<T> {
  data: T | null;
  error: ApiFailure | null;
  reload: () => void;
  set: Dispatch<SetStateAction<T | null>>;
}

export function useResource<T>(load: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [data, set] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let live = true;
    setError(null);
    latest.current().then(
      (value) => {
        if (live) set(value);
      },
      (failure: unknown) => {
        if (live) setError(failure instanceof ApiFailure ? failure : new ApiFailure(0, "error", String(failure)));
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload, set };
}
