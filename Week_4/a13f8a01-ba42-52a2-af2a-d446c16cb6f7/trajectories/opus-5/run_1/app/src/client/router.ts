type Page = (params: Record<string, string>) => void | Promise<void>;

interface Match {
  page: Page;
  params: Record<string, string>;
}

const routes: { pattern: string; page: Page }[] = [];

export const route = (pattern: string, page: Page): void => {
  routes.push({ pattern, page });
};

const match = (pathname: string): Match | null => {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  for (const candidate of routes) {
    const segments = candidate.pattern.split('/').filter((part) => part.length > 0);
    if (segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < segments.length; index += 1) {
      const expected = segments[index]!;
      if (expected.startsWith(':')) params[expected.slice(1)] = parts[index]!;
      else if (expected !== parts[index]) {
        ok = false;
        break;
      }
    }
    if (ok) return { page: candidate.page, params };
  }
  return null;
};

let leaving: (() => void)[] = [];

/** Lets a page stop its own timers and streams before another page takes over. */
export const onLeave = (stop: () => void): void => {
  leaving.push(stop);
};

export const mount = (): void => {
  for (const stop of leaving) stop();
  leaving = [];
  const found = match(window.location.pathname);
  if (found) void found.page(found.params);
};

export const goto = (path: string): void => {
  window.history.pushState({}, '', path);
  mount();
};

export const replaceAddress = (path: string): void => {
  window.history.replaceState({}, '', path);
};

window.addEventListener('popstate', () => mount());
