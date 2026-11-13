import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFail, api } from "./api";

interface Data<T> {
  data: T | null;
  error: ApiFail | null;
  loading: boolean;
  /** Fetches again and keeps the current data on screen meanwhile. */
  reload: () => Promise<void>;
  set: (value: T) => void;
}

/** GET `path` (null waits). Reloads when the path changes; only the newest reply is kept. */
export function useData<T>(path: string | null): Data<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFail | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    latest.current += 1;
    const mine = latest.current;
    try {
      const value = await api.get<T>(path);
      if (mine !== latest.current) return;
      setData(value);
      setError(null);
    } catch (failure) {
      if (mine !== latest.current) return;
      setError(failure instanceof ApiFail ? failure : new ApiFail(500, { error: "server_error", message: "Something went wrong on our side. Try again." }));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(path !== null);
    void load();
  }, [path, load]);

  return { data, error, loading, reload: load, set: setData };
}
