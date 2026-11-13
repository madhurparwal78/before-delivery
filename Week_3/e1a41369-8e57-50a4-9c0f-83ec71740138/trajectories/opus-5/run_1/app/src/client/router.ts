import { useEffect, useState } from 'react';

const listeners = new Set<() => void>();

export function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  for (const listener of listeners) listener();
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = (): void => setPath(window.location.pathname);
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return path;
}
