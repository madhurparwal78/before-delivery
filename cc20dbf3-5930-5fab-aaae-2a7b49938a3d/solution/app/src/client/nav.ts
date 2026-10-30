// Client-side navigation between the brief's screens.

let render: () => void = () => undefined;

export function onNavigate(handler: () => void): void {
  render = handler;
  window.addEventListener("popstate", handler);
  document.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest("a");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute("href");
    if (!href?.startsWith("/") || link.target) return;
    event.preventDefault();
    navigate(href);
  });
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else if (path !== location.pathname) history.pushState(null, "", path);
  render();
}
