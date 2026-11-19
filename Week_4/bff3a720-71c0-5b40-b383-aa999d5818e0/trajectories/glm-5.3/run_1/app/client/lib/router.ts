interface Listener { (): void }

export class Router {
  path = '/';
  query = new URLSearchParams();
  #listeners = new Set<Listener>();

  constructor() {
    this.parse();
    window.addEventListener('popstate', () => { this.parse(); this.emit(); });
  }

  private parse(): void {
    const u = new URL(window.location.href);
    this.path = u.pathname;
    this.query = u.searchParams;
  }

  go(path: string, query?: Record<string, string | undefined>, replace = false, silent = false): void {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== '') qs.set(k, v);
    }
    const target = qs.size > 0 ? `${path}?${qs.toString()}` : path;
    if (replace) window.history.replaceState(null, '', target);
    else window.history.pushState(null, '', target);
    this.parse();
    if (!silent) this.emit();
  }

  href(path: string, query?: Record<string, string | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== '') qs.set(k, v);
    }
    return qs.size > 0 ? `${path}?${qs.toString()}` : path;
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.#listeners) fn();
  }
}

export const router = new Router();
