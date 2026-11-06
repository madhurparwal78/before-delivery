import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, type ApiResult } from "./api";

const WIDE_QUERY = "(min-width: 1024px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useLayoutEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** True from 1024 px wide, where strips and two-column layouts start. */
export const useWide = (): boolean => useMedia(WIDE_QUERY);

export function prefersReducedMotion(): boolean {
  return matchMedia(REDUCED_QUERY).matches;
}

interface Loaded<T> {
  data: T | null;
  result: ApiResult<T> | null;
  loading: boolean;
  reload: () => Promise<ApiResult<T>>;
}

/** Reads a resource when the screen opens and whenever `path` changes; `reload` reads it again quietly. */
export function useLoad<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ path: string | null; result: ApiResult<T> | null }>({ path: null, result: null });
  const latest = useRef(path);
  latest.current = path;
  const reload = useCallback(async () => {
    const asked = latest.current!;
    const result = await api<T>("GET", asked);
    if (latest.current === asked) setState({ path: asked, result });
    return result;
  }, []);
  useEffect(() => {
    if (path) void reload();
  }, [path]);
  const current = state.path === path ? state.result : null;
  return { data: current && current.ok ? current.data : null, result: current, loading: Boolean(path) && !current, reload };
}

/** Runs `tick` every `ms` while the screen is open. */
export function useInterval(tick: () => void, ms: number): void {
  const saved = useRef(tick);
  saved.current = tick;
  useEffect(() => {
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
