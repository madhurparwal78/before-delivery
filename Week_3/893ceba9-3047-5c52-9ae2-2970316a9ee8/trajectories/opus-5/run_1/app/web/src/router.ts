// Client-side routing for the desk's screens.

type Render = (path: string, search: URLSearchParams) => void | Promise<void>;

let renderScreen: Render = () => {};

export function startRouter(render: Render): void {
  renderScreen = render;
  window.addEventListener('popstate', () => void paint());
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  void paint();
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  void paint();
}

// updateQuery changes the URL query without a page reload.
export function updateQuery(name: string, value: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  window.history.replaceState({}, '', url.pathname + url.search);
}

async function paint(): Promise<void> {
  const url = new URL(window.location.href);
  await renderScreen(url.pathname.replace(/\/$/, '') || '/', url.searchParams);
  window.scrollTo({ top: 0 });
}

export function pathParts(path: string): string[] {
  return path.split('/').filter((part) => part !== '');
}
