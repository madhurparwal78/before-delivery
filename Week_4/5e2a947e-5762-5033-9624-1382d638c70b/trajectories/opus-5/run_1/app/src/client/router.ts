export type Screen = (params: Record<string, string>, url: URL) => void | Promise<void>;

interface Entry {
  pattern: RegExp;
  keys: string[];
  screen: Screen;
}

const entries: Entry[] = [];
let fallback: Screen | null = null;

export function screen(path: string, build: Screen): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path
      .split('/')
      .map((part) => {
        if (!part.startsWith(':')) return part;
        keys.push(part.slice(1));
        return '([^/]+)';
      })
      .join('/')}$`,
  );
  entries.push({ pattern, keys, screen: build });
}

export function notFoundScreen(build: Screen): void {
  fallback = build;
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  void render();
}

export async function render(): Promise<void> {
  const url = new URL(window.location.href);
  for (const entry of entries) {
    const match = entry.pattern.exec(url.pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    await entry.screen(params, url);
    return;
  }
  if (fallback) await fallback({}, url);
}

export function startRouter(): void {
  window.addEventListener('popstate', () => {
    void render();
  });
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href === null || !href.startsWith('/') || link.hasAttribute('download')) return;
    if (link.getAttribute('target') === '_blank') return;
    event.preventDefault();
    navigate(href);
  });
  void render();
}
