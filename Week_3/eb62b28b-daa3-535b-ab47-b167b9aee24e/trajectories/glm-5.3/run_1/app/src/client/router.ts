type RouteHandler = (params: Record<string, string>) => HTMLElement | Promise<HTMLElement>;

const routes: { pattern: RegExp; keys: string[]; handler: RouteHandler }[] = [];

export function route(path: string, handler: RouteHandler): void {
  const keys: string[] = [];
  const isWildcard = path === "(.*)";
  const pattern = isWildcard
    ? /^.*$/
    : new RegExp(
        "^" +
          path
            .replace(/\/$/, "")
            .replace(/:[A-Za-z]+/g, (match) => {
              keys.push(match.slice(1));
              return "([^/]+)";
            }) +
          "$"
      );
  routes.push({ pattern, keys, handler });
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  void render();
}

export async function render(): Promise<void> {
  const path = window.location.pathname;
  for (const entry of routes) {
    const match = entry.pattern.exec(path);
    if (match) {
      const params: Record<string, string> = {};
      entry.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? "");
      });
      const view = await entry.handler(params);
      const root = document.getElementById("root");
      if (root) {
        root.replaceChildren(view);
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  const fallback = routes[routes.length - 1];
  if (fallback && fallback.pattern.source === ".*") {
    const view = await fallback.handler({});
    const root = document.getElementById("root");
    if (root) root.replaceChildren(view);
    window.scrollTo(0, 0);
  }
}

window.addEventListener("popstate", () => {
  void render();
});
