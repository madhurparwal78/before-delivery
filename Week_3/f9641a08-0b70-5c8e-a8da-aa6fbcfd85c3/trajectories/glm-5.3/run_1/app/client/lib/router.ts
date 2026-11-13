import { useEffect, useRef, useState } from 'preact/hooks';

/** History entries in the address drive the screens; Back and Forward restore. */
export function navigate(path: string, replace = false): void {
  if (replace) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const onChange = (): void => setPath(location.pathname + location.search);
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return path;
}

export function matchRoute(pattern: string, pathname: string): string[] | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: string[] = [];
  for (let i = 0; i < patternParts.length; i += 1) {
    if (patternParts[i].startsWith(':')) {
      params.push(decodeURIComponent(pathParts[i]));
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function usePolling(fn: () => void, ms: number, active = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

/** Counts down from a server-provided seconds_left, re-syncing on visibility. */
export function useServerCountdown(secondsLeft: number | null, onExpiry?: () => void): number | null {
  const [left, setLeft] = useState<number | null>(secondsLeft);
  useEffect(() => setLeft(secondsLeft), [secondsLeft]);
  useEffect(() => {
    if (left === null) return;
    const id = setInterval(() => {
      setLeft((current) => {
        if (current === null) return null;
        if (current <= 1) {
          if (onExpiry !== undefined) onExpiry();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [left !== null]);
  return left;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion());
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
