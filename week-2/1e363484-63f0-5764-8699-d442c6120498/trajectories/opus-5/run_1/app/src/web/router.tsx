import { useEffect, useState } from 'react';

export interface Location {
  readonly path: string;
  readonly search: string;
}

function current(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  announce();
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}

/** Matches `/projects/:slug/figures/:id` style patterns against a path. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]!;
    const actual = pathParts[index]!;
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  ref?: React.Ref<HTMLAnchorElement>;
}

export function Link({ to, children, ref, ...rest }: LinkProps): React.ReactElement {
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
