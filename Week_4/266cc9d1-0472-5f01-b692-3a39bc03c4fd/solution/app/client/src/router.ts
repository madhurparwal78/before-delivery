// Client-side navigation between the four screens.
const listeners = new Set<() => void>();

export function navigate(path: string): void {
  history.pushState(null, "", path);
  for (const listener of listeners) listener();
}

export function onNavigate(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}
