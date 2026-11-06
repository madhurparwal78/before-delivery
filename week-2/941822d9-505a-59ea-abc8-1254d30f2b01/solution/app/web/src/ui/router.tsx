import { useEffect, useRef, useState, type AnchorHTMLAttributes, type ReactNode, type Ref } from "react";

// A tiny history router: client navigation moves focus to the new page's heading.

const CHANGE = "credwell:navigate";
let focusHeadingOnArrival = false;

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  focusHeadingOnArrival = true;
  window.scrollTo({ top: 0, behavior: "instant" });
  window.dispatchEvent(new Event(CHANGE));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener(CHANGE, update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener(CHANGE, update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> };

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** The page's level-1 heading; it takes focus when the user arrives by client navigation. */
export function PageHeading({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeadingOnArrival) {
      focusHeadingOnArrival = false;
      ref.current?.focus();
    }
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}
