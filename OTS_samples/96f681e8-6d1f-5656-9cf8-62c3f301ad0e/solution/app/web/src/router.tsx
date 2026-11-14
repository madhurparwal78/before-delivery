import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useState } from "react";

const changed = "yardline:navigate";

interface Location {
  path: string;
  search: URLSearchParams;
}

function read(): Location {
  return { path: window.location.pathname, search: new URLSearchParams(window.location.search) };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(changed));
}

export function useLocation(): Location {
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const update = () => setLocation(read());
    window.addEventListener("popstate", update);
    window.addEventListener(changed, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(changed, update);
    };
  }, []);
  return location;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (to.includes("#")) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={follow} {...rest} />;
}
