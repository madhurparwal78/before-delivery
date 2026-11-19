type Renderer = (path: string) => void;

let renderer: Renderer = () => undefined;

export function setRenderer(fn: Renderer): void {
  renderer = fn;
}

export function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  renderer(currentPath());
}

window.addEventListener('popstate', () => renderer(currentPath()));
