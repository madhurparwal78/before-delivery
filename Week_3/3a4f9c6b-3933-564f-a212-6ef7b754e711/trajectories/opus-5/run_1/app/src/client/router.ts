let onRoute: (() => void) | null = null;

export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  onRoute?.();
}

export function startRouting(render: () => void): void {
  onRoute = render;
  window.addEventListener('popstate', () => render());
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href || !href.startsWith('/')) return;
    event.preventDefault();
    navigate(href);
  });
  render();
}
