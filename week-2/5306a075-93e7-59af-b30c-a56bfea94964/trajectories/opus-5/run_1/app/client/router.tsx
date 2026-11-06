import { useEffect, useState } from 'react';

export function navigate(path: string): void {
  if (location.pathname + location.search === path) return;
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const update = (): void => setPath(location.pathname);
    addEventListener('popstate', update);
    return () => removeEventListener('popstate', update);
  }, []);
  return path;
}

export function Link({
  to,
  children,
  className,
  ...rest
}: { to: string; children: React.ReactNode; className?: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
