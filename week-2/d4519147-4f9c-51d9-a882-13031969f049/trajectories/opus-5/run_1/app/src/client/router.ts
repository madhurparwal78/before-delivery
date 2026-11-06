type LeaveGuard = () => Promise<boolean>;

let leaveGuard: LeaveGuard | null = null;
let screenCleanup: (() => void) | null = null;
let renderer: ((path: string) => void) | null = null;
let notFoundHandler: ((kind: 'diagram' | 'page') => void) | null = null;
let currentPath = '';

export function setNotFoundHandler(handler: (kind: 'diagram' | 'page') => void): void {
  notFoundHandler = handler;
}

/** A request answered not-found takes the tab to the not-found page in place. */
export function showNotFound(kind: 'diagram' | 'page'): void {
  leaveGuard = null;
  notFoundHandler?.(kind);
}

export function setLeaveGuard(guard: LeaveGuard | null): void {
  leaveGuard = guard;
}

/** Each screen drops its timers and listeners before the next one renders. */
export function setScreenCleanup(cleanup: (() => void) | null): void {
  screenCleanup = cleanup;
}

export function startRouter(render: (path: string) => void): void {
  renderer = (path: string): void => {
    const cleanup = screenCleanup;
    screenCleanup = null;
    cleanup?.();
    render(path);
  };
  currentPath = `${window.location.pathname}${window.location.search}`;
  renderer(window.location.pathname);
  window.addEventListener('popstate', () => {
    const target = `${window.location.pathname}${window.location.search}`;
    const previous = currentPath;
    const guard = leaveGuard;
    if (!guard) {
      currentPath = target;
      renderer?.(window.location.pathname);
      return;
    }
    void guard().then((allowed) => {
      if (!allowed) {
        window.history.pushState({}, '', previous);
        return;
      }
      leaveGuard = null;
      currentPath = target;
      renderer?.(window.location.pathname);
    });
  });
}

/** Leaving the editor settles the pending save before the address changes. */
export async function navigate(path: string, options: { replace?: boolean; settle?: boolean } = {}): Promise<void> {
  if (options.settle !== false && leaveGuard) {
    const allowed = await leaveGuard();
    if (!allowed) return;
  }
  leaveGuard = null;
  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  currentPath = path;
  renderer?.(new URL(path, window.location.origin).pathname);
}

export function reRender(): void {
  renderer?.(window.location.pathname);
}
