// Loading a page's data, opening the page's socket from its seq, and reloading when the socket reports a change.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { ApiError, api, go } from "./lib";
import { Frame, live } from "./live";

interface Loaded<T> {
  data: T | null | undefined;
  failed: boolean;
  reload: () => Promise<void>;
}

/** useResource fetches `path`; every socket frame accepted by `refreshOn` fetches it again (never two at once). */
export function useResource<T extends object>(path: string, refreshOn: (f: Frame) => boolean = () => true): Loaded<T> {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const again = useRef(false);
  const started = useRef(false);
  const waiting = useRef<Array<() => void>>([]);

  const fetchOnce = (): Promise<void> => {
    const done = new Promise<void>((resolve) => waiting.current.push(resolve));
    if (busy.current) {
      again.current = true;
      return done;
    }
    busy.current = true;
    api<T>(path)
      .then(
        (res) => {
          if (!started.current) {
            started.current = true;
            live.start("seq" in res && typeof res.seq === "number" ? res.seq : null);
          }
          setFailed(false);
          setData(res);
        },
        (e) => {
          if (!started.current) {
            started.current = true;
            live.start(null);
          }
          if (e instanceof ApiError && e.status === 401) go(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
          else if (e instanceof ApiError && e.status === 404) setData(null);
          else setFailed(true);
        },
      )
      .finally(() => {
        busy.current = false;
        if (again.current) {
          again.current = false;
          void fetchOnce();
          return;
        }
        const resolved = waiting.current;
        waiting.current = [];
        resolved.forEach((resolve) => resolve());
      });
    return done;
  };

  useLayoutEffect(() => {
    void fetchOnce();
    return live.onFrame((f) => {
      if (refreshOn(f)) void fetchOnce();
    });
  }, []);

  return { data, failed, reload: fetchOnce };
}
