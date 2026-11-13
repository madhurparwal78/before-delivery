/** Client routing, and the signed-out rule's return path. */

type Listener = () => void;

let listener: Listener | null = null;

export function onRouteChange(callback: Listener): void {
  listener = callback;
  window.addEventListener('popstate', () => callback());
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  listener?.();
}

/** Replaces the address without re-rendering, for board and review state. */
export function pushAddress(path: string): void {
  window.history.pushState({}, '', path);
}

function returnPathParameter(): string {
  return encodeURIComponent(currentPath());
}

export function signedOutRedirect(): void {
  if (window.location.pathname === '/sign-in') return;
  navigate(`/sign-in?return=${returnPathParameter()}`, { replace: true });
}
