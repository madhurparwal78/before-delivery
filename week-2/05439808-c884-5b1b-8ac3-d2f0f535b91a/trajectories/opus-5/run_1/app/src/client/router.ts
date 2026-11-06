let signedOutNotice = false;
let renderPath: (path: string) => void = () => undefined;

export function currentPath(): string {
  return window.location.pathname;
}

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  renderPath(path);
}

export function markSignedOut(): void {
  signedOutNotice = true;
}

export function takeSignedOutNotice(): boolean {
  const value = signedOutNotice;
  signedOutNotice = false;
  return value;
}

export function startRouter(render: (path: string) => void): void {
  renderPath = render;
  window.addEventListener('popstate', () => renderPath(currentPath()));
  window.addEventListener('pageshow', () => renderPath(currentPath()));
  renderPath(currentPath());
}
