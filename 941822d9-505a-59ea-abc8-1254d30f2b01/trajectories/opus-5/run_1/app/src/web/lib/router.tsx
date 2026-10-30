import { useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode, type Ref } from 'react';

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function currentPath(): string {
  return window.location.pathname;
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.scrollTo(0, 0);
  emit();
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath, currentPath);
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly to: string;
  readonly children: ReactNode;
  readonly ref?: Ref<HTMLAnchorElement>;
}

export function Link({ to, children, ref, ...rest }: LinkProps): ReactNode {
  return (
    <a
      href={to}
      ref={ref}
      {...rest}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** Matches `/learn/:enrolmentId/:moduleId` style patterns against the current path. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter((part) => part !== '');
  const pathParts = path.split('/').filter((part) => part !== '');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, patternPart] of patternParts.entries()) {
    const pathPart = pathParts[index];
    if (pathPart === undefined) return null;
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) return null;
  }
  return params;
}
